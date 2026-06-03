/**
 * Tiny persistence layer for the daily competition.
 *
 * The whole competition state is one small JSON document. Three backends,
 * chosen at runtime by `getStore()`:
 *
 *   - **Vercel Blob** (prod) — the JSON doc lives in durable object storage
 *     that every serverless instance AND the daily payout cron share. Enabled
 *     when `BLOB_READ_WRITE_TOKEN` is present (auto-set when you add a Blob
 *     store to the Vercel project).
 *   - **Local file** (dev) — the same JSON doc on disk at `.data/store.json`,
 *     so `pnpm dev` behaves like a normal file-backed app.
 *   - **In-memory** — last-resort fallback (single instance, lost on restart).
 *
 * Writes are read-modify-write on the whole doc. Volume here is tiny (a handful
 * of entries/attempts per day), so that's fine; simultaneous writes could in
 * theory drop one update, which is acceptable for a daily puzzle.
 *
 * Keys are namespaced by UTC day so each day is an isolated competition.
 */
import type { DailyPuzzle } from "@/lib/puzzle";

export interface Entry {
  /** Player Safe / avatar address (lowercased). */
  address: string;
  /** Tx hash of the verified entry-fee payment. */
  txHash: string;
  /** ms epoch when the entry was recorded. */
  enteredAt: number;
}

/**
 * A player's single attempt for the day. Created when they start the clock and
 * finalized exactly once (solve or fail). The official `timeMs` is computed
 * server-side (`finishedAt - startedAt`) so it can't be gamed by the client and
 * survives reloads.
 */
export interface Attempt {
  address: string;
  startedAt: number;
  status: "started" | "solved" | "failed";
  /** Solve time in ms (server-authoritative), set only when status==="solved". */
  timeMs?: number;
  /** Lives remaining at finish. */
  lives?: number;
  finishedAt?: number;
}

export interface StoreBackend {
  addEntry(day: string, entry: Entry): Promise<void>;
  getEntry(day: string, address: string): Promise<Entry | null>;
  listEntries(day: string): Promise<Entry[]>;
  isTxUsed(txHash: string): Promise<boolean>;
  markTxUsed(txHash: string): Promise<void>;
  /** Start (or resume) the player's one attempt. Idempotent — returns the
   *  existing attempt if they already have one, so the clock never resets. */
  startAttempt(day: string, address: string, startedAt: number): Promise<Attempt>;
  getAttempt(day: string, address: string): Promise<Attempt | null>;
  /** Finalize the attempt exactly once. No-op if already finished. */
  finishAttempt(
    day: string,
    address: string,
    outcome: { solved: boolean; lives: number; finishedAt: number }
  ): Promise<Attempt | null>;
  listAttempts(day: string): Promise<Attempt[]>;
  /** The puzzle locked in for a day (so it's stable for everyone), or null. */
  getPuzzle(day: string): Promise<DailyPuzzle | null>;
  setPuzzle(day: string, puzzle: DailyPuzzle): Promise<void>;
  /** All day keys present in the store (for catch-up settlement). */
  listDays(): Promise<string[]>;
  isPaidOut(day: string): Promise<boolean>;
  /** Atomically reserve a day for settlement. Returns false if it's already
   *  claimed/paid — the guard against double-paying a winner. */
  claimDay(day: string, now: number): Promise<boolean>;
  /** Release a claimed day (on settlement failure) so it can be retried. */
  unclaimDay(day: string): Promise<void>;
  markPaidOut(day: string, info: Record<string, unknown>): Promise<void>;
}

/** The shape of the single JSON document that holds all competition state. */
interface StoreDoc {
  days: Record<
    string,
    { entries: Record<string, Entry>; attempts: Record<string, Attempt> }
  >;
  usedTx: string[];
  paidOut: Record<string, Record<string, unknown>>;
  puzzles: Record<string, DailyPuzzle>;
}

const emptyDoc = (): StoreDoc => ({ days: {}, usedTx: [], paidOut: {}, puzzles: {} });

function dayBucket(doc: StoreDoc, day: string) {
  if (!doc.days[day]) doc.days[day] = { entries: {}, attempts: {} };
  return doc.days[day];
}

/**
 * A document store reads/writes the whole JSON doc. The day-level logic is
 * shared; only load/save differ between Blob and local-file.
 */
abstract class JsonDocBackend implements StoreBackend {
  protected abstract load(): Promise<StoreDoc>;
  protected abstract save(doc: StoreDoc): Promise<void>;

  /** Serialize read-modify-write so concurrent calls in one instance queue. */
  private chain: Promise<unknown> = Promise.resolve();
  private mutate<T>(fn: (doc: StoreDoc) => T | Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const doc = await this.load();
      const result = await fn(doc);
      await this.save(doc);
      return result;
    });
    // Keep the chain alive even if this op throws.
    this.chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async addEntry(day: string, entry: Entry) {
    await this.mutate((doc) => {
      dayBucket(doc, day).entries[entry.address] = entry;
    });
  }
  async getEntry(day: string, address: string) {
    const doc = await this.load();
    return doc.days[day]?.entries[address] ?? null;
  }
  async listEntries(day: string) {
    const doc = await this.load();
    return Object.values(doc.days[day]?.entries ?? {});
  }
  async isTxUsed(txHash: string) {
    const doc = await this.load();
    return doc.usedTx.includes(txHash.toLowerCase());
  }
  async markTxUsed(txHash: string) {
    await this.mutate((doc) => {
      const t = txHash.toLowerCase();
      if (!doc.usedTx.includes(t)) doc.usedTx.push(t);
    });
  }
  async startAttempt(day: string, address: string, startedAt: number) {
    return this.mutate((doc) => {
      const bucket = dayBucket(doc, day);
      if (!bucket.attempts[address]) {
        bucket.attempts[address] = { address, startedAt, status: "started" };
      }
      return bucket.attempts[address];
    });
  }
  async getAttempt(day: string, address: string) {
    const doc = await this.load();
    return doc.days[day]?.attempts[address] ?? null;
  }
  async finishAttempt(
    day: string,
    address: string,
    outcome: { solved: boolean; lives: number; finishedAt: number }
  ) {
    // Don't write at all unless there's a live attempt to finalize — a blind
    // read-modify-write here could clobber a concurrent start that just wrote
    // the 'started' attempt (leaving the player stuck as "playing").
    const pre = (await this.load()).days[day]?.attempts[address];
    if (!pre) return null;
    if (pre.status !== "started") return pre;
    return this.mutate((doc) => {
      const a = doc.days[day]?.attempts[address];
      if (!a || a.status !== "started") return a ?? null;
      a.status = outcome.solved ? "solved" : "failed";
      a.finishedAt = outcome.finishedAt;
      a.lives = outcome.lives;
      if (outcome.solved) a.timeMs = outcome.finishedAt - a.startedAt;
      return a;
    });
  }
  async listAttempts(day: string) {
    const doc = await this.load();
    return Object.values(doc.days[day]?.attempts ?? {});
  }
  async getPuzzle(day: string) {
    const doc = await this.load();
    return doc.puzzles[day] ?? null;
  }
  async setPuzzle(day: string, puzzle: DailyPuzzle) {
    await this.mutate((doc) => {
      if (!doc.puzzles[day]) doc.puzzles[day] = puzzle; // lock once per day
    });
  }
  async listDays() {
    const doc = await this.load();
    return Object.keys(doc.days);
  }
  async isPaidOut(day: string) {
    const doc = await this.load();
    return Boolean(doc.paidOut[day]);
  }
  async claimDay(day: string, now: number) {
    return this.mutate((doc) => {
      if (doc.paidOut[day]) return false; // already paid or being settled
      doc.paidOut[day] = { settling: true, at: now };
      return true;
    });
  }
  async unclaimDay(day: string) {
    await this.mutate((doc) => {
      delete doc.paidOut[day];
    });
  }
  async markPaidOut(day: string, info: Record<string, unknown>) {
    await this.mutate((doc) => {
      doc.paidOut[day] = info;
    });
  }
}

// --------------------------- Vercel Blob backend ---------------------------

const BLOB_PATH = "daily-chess/store.json";

class BlobBackend extends JsonDocBackend {
  private urlCache: string | null = null;

  protected async load(): Promise<StoreDoc> {
    const { list } = await import("@vercel/blob");
    try {
      const { blobs } = await list({ prefix: BLOB_PATH, limit: 1 });
      const url = blobs[0]?.url ?? this.urlCache;
      if (!url) return emptyDoc();
      this.urlCache = url;
      // Cache-bust so we always read the latest write.
      const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return emptyDoc();
      return normalize((await res.json()) as Partial<StoreDoc>);
    } catch (err) {
      console.warn("[store/blob] load failed:", err);
      return emptyDoc();
    }
  }

  protected async save(doc: StoreDoc): Promise<void> {
    const { put } = await import("@vercel/blob");
    const { url } = await put(BLOB_PATH, JSON.stringify(doc), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    this.urlCache = url;
  }
}

// --------------------------- Local file backend ---------------------------

class FileBackend extends JsonDocBackend {
  private file: string;
  constructor(file: string) {
    super();
    this.file = file;
  }
  protected async load(): Promise<StoreDoc> {
    const { readFile } = await import("node:fs/promises");
    try {
      const raw = await readFile(this.file, "utf8");
      return normalize(JSON.parse(raw) as Partial<StoreDoc>);
    } catch {
      return emptyDoc();
    }
  }
  protected async save(doc: StoreDoc): Promise<void> {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(doc, null, 2), "utf8");
  }
}

// --------------------------- In-memory backend ---------------------------

class MemoryBackend extends JsonDocBackend {
  private doc = emptyDoc();
  protected async load() {
    return this.doc;
  }
  protected async save(doc: StoreDoc) {
    this.doc = doc;
  }
}

function normalize(d: Partial<StoreDoc>): StoreDoc {
  return {
    days: d.days ?? {},
    usedTx: d.usedTx ?? [],
    paidOut: d.paidOut ?? {},
    puzzles: d.puzzles ?? {},
  };
}

// --------------------------- Singleton ---------------------------

let backend: StoreBackend | null = null;

export function getStore(): StoreBackend {
  if (backend) return backend;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    backend = new BlobBackend();
  } else if (process.env.NODE_ENV !== "production") {
    backend = new FileBackend(process.env.STORE_FILE ?? ".data/store.json");
  } else {
    // Production without Blob configured — works, but state is per-instance
    // and lost on cold start. Add a Blob store to fix.
    console.warn(
      "[store] No BLOB_READ_WRITE_TOKEN in production — using in-memory store; state will not persist."
    );
    backend = new MemoryBackend();
  }
  return backend;
}
