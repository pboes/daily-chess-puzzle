/**
 * Competition store.
 *
 * The data model is deliberately simple — a few namespaced keys per UTC day:
 *
 *   entries:{day}    hash  address -> Entry
 *   attempts:{day}   hash  address -> Attempt
 *   puzzle:{day}     str   the locked-in DailyPuzzle (set once)
 *   paid:{day}       str   payout result, or a "settling" claim sentinel
 *   usedtx           set   entry-payment tx hashes already consumed
 *   days             set   every day key we've touched
 *
 * In production this is **Upstash Redis**, so every write is an atomic per-key
 * operation (`HSET`, `HSETNX`, `SET NX`, `SADD`) — writes never read-modify-write
 * the whole world, so they can't clobber each other across serverless instances,
 * and `claimDay` (`SET NX`) makes settlement exactly-once.
 *
 * For local `pnpm dev` (single process, no concurrency) a JSON file backend is
 * used instead; an in-memory one is the last resort.
 */
import type { DailyPuzzle } from "@/lib/puzzle";

export interface Entry {
  address: string; // lowercased
  txHash: string;
  enteredAt: number;
}

export interface Attempt {
  address: string;
  startedAt: number;
  status: "started" | "solved" | "failed";
  /** Solve time in ms (server-authoritative); set only when status==="solved". */
  timeMs?: number;
  lives?: number;
  finishedAt?: number;
}

export interface StoreBackend {
  addEntry(day: string, entry: Entry): Promise<void>;
  getEntry(day: string, address: string): Promise<Entry | null>;
  listEntries(day: string): Promise<Entry[]>;

  isTxUsed(txHash: string): Promise<boolean>;
  markTxUsed(txHash: string): Promise<void>;

  /** Create the player's attempt if absent; always returns the current one.
   *  Idempotent, so a resumed/replayed start never resets the clock. */
  startAttempt(day: string, address: string, startedAt: number): Promise<Attempt>;
  getAttempt(day: string, address: string): Promise<Attempt | null>;
  /** Finalize a "started" attempt once; a no-op if already finished/absent. */
  finishAttempt(
    day: string,
    address: string,
    outcome: { solved: boolean; lives: number; finishedAt: number }
  ): Promise<Attempt | null>;
  listAttempts(day: string): Promise<Attempt[]>;

  /** The day's puzzle, locked once so it's identical for everyone. */
  getPuzzle(day: string): Promise<DailyPuzzle | null>;
  /** Lock the puzzle for a day; first writer wins, later writes are ignored. */
  setPuzzle(day: string, puzzle: DailyPuzzle): Promise<DailyPuzzle>;

  listDays(): Promise<string[]>;
  isPaidOut(day: string): Promise<boolean>;
  /** Atomically reserve a day for settlement. False if already claimed/paid —
   *  the guarantee that a winner is paid at most once. */
  claimDay(day: string, now: number): Promise<boolean>;
  /** Release a claim (settlement failed) so it can be retried. */
  unclaimDay(day: string): Promise<void>;
  markPaidOut(day: string, info: Record<string, unknown>): Promise<void>;
}

// ─────────────────────────────── Redis ───────────────────────────────

import { Redis } from "@upstash/redis";

const K = {
  entries: (d: string) => `dcp:entries:${d}`,
  attempts: (d: string) => `dcp:attempts:${d}`,
  puzzle: (d: string) => `dcp:puzzle:${d}`,
  paid: (d: string) => `dcp:paid:${d}`,
  usedtx: "dcp:usedtx",
  days: "dcp:days",
};

/** Upstash auto-(de)serializes JSON; normalize whatever comes back to T|null. */
function asObj<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  return v as T;
}

class RedisBackend implements StoreBackend {
  private redis: Redis;
  constructor(redis: Redis) {
    this.redis = redis;
  }

  async addEntry(day: string, entry: Entry) {
    await Promise.all([
      this.redis.hset(K.entries(day), { [entry.address]: entry }),
      this.redis.sadd(K.days, day),
    ]);
  }
  async getEntry(day: string, address: string) {
    return asObj<Entry>(await this.redis.hget(K.entries(day), address));
  }
  async listEntries(day: string) {
    const all = (await this.redis.hgetall<Record<string, unknown>>(K.entries(day))) ?? {};
    return Object.values(all).map((v) => asObj<Entry>(v)).filter((v): v is Entry => !!v);
  }

  async isTxUsed(txHash: string) {
    return (await this.redis.sismember(K.usedtx, txHash.toLowerCase())) === 1;
  }
  async markTxUsed(txHash: string) {
    await this.redis.sadd(K.usedtx, txHash.toLowerCase());
  }

  async startAttempt(day: string, address: string, startedAt: number) {
    const attempt: Attempt = { address, startedAt, status: "started" };
    // HSETNX → only creates when absent, so concurrent/replayed starts are safe.
    await this.redis.hsetnx(K.attempts(day), address, attempt);
    await this.redis.sadd(K.days, day);
    return (await this.getAttempt(day, address)) ?? attempt;
  }
  async getAttempt(day: string, address: string) {
    return asObj<Attempt>(await this.redis.hget(K.attempts(day), address));
  }
  async finishAttempt(
    day: string,
    address: string,
    outcome: { solved: boolean; lives: number; finishedAt: number }
  ) {
    const a = await this.getAttempt(day, address);
    if (!a) return null;
    if (a.status !== "started") return a; // already finalized — leave as-is
    const finished: Attempt = {
      ...a,
      status: outcome.solved ? "solved" : "failed",
      finishedAt: outcome.finishedAt,
      lives: outcome.lives,
      ...(outcome.solved ? { timeMs: outcome.finishedAt - a.startedAt } : {}),
    };
    await this.redis.hset(K.attempts(day), { [address]: finished });
    return finished;
  }
  async listAttempts(day: string) {
    const all = (await this.redis.hgetall<Record<string, unknown>>(K.attempts(day))) ?? {};
    return Object.values(all).map((v) => asObj<Attempt>(v)).filter((v): v is Attempt => !!v);
  }

  async getPuzzle(day: string) {
    return asObj<DailyPuzzle>(await this.redis.get(K.puzzle(day)));
  }
  async setPuzzle(day: string, puzzle: DailyPuzzle) {
    await this.redis.set(K.puzzle(day), puzzle, { nx: true });
    await this.redis.sadd(K.days, day);
    return (await this.getPuzzle(day)) ?? puzzle;
  }

  async listDays() {
    return (await this.redis.smembers(K.days)) ?? [];
  }
  async isPaidOut(day: string) {
    return (await this.redis.exists(K.paid(day))) === 1;
  }
  async claimDay(day: string, now: number) {
    const res = await this.redis.set(K.paid(day), { settling: true, at: now }, { nx: true });
    return res === "OK";
  }
  async unclaimDay(day: string) {
    await this.redis.del(K.paid(day));
  }
  async markPaidOut(day: string, info: Record<string, unknown>) {
    await this.redis.set(K.paid(day), info);
  }
}

// ──────────────────────── File / memory (dev) ────────────────────────
// Single-process backends for local dev. Not concurrency-safe, but dev runs one
// process, so it's fine. Shared logic lives in JsonDocBackend.

interface Doc {
  entries: Record<string, Record<string, Entry>>;
  attempts: Record<string, Record<string, Attempt>>;
  puzzles: Record<string, DailyPuzzle>;
  paid: Record<string, Record<string, unknown>>;
  usedtx: string[];
}
const emptyDoc = (): Doc => ({ entries: {}, attempts: {}, puzzles: {}, paid: {}, usedtx: [] });

abstract class JsonDocBackend implements StoreBackend {
  protected abstract load(): Promise<Doc>;
  protected abstract save(doc: Doc): Promise<void>;
  private chain: Promise<unknown> = Promise.resolve();
  private mutate<T>(fn: (doc: Doc) => T): Promise<T> {
    const run = this.chain.then(async () => {
      const doc = await this.load();
      const r = fn(doc);
      await this.save(doc);
      return r;
    });
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  async addEntry(day: string, e: Entry) {
    await this.mutate((d) => ((d.entries[day] ??= {})[e.address] = e));
  }
  async getEntry(day: string, a: string) {
    return (await this.load()).entries[day]?.[a] ?? null;
  }
  async listEntries(day: string) {
    return Object.values((await this.load()).entries[day] ?? {});
  }
  async isTxUsed(t: string) {
    return (await this.load()).usedtx.includes(t.toLowerCase());
  }
  async markTxUsed(t: string) {
    await this.mutate((d) => {
      if (!d.usedtx.includes(t.toLowerCase())) d.usedtx.push(t.toLowerCase());
    });
  }
  async startAttempt(day: string, address: string, startedAt: number) {
    return this.mutate((d) => {
      const m = (d.attempts[day] ??= {});
      if (!m[address]) m[address] = { address, startedAt, status: "started" };
      return m[address];
    });
  }
  async getAttempt(day: string, a: string) {
    return (await this.load()).attempts[day]?.[a] ?? null;
  }
  async finishAttempt(
    day: string,
    address: string,
    o: { solved: boolean; lives: number; finishedAt: number }
  ) {
    return this.mutate((d) => {
      const a = d.attempts[day]?.[address];
      if (!a) return null;
      if (a.status === "started") {
        a.status = o.solved ? "solved" : "failed";
        a.finishedAt = o.finishedAt;
        a.lives = o.lives;
        if (o.solved) a.timeMs = o.finishedAt - a.startedAt;
      }
      return a;
    });
  }
  async listAttempts(day: string) {
    return Object.values((await this.load()).attempts[day] ?? {});
  }
  async getPuzzle(day: string) {
    return (await this.load()).puzzles[day] ?? null;
  }
  async setPuzzle(day: string, p: DailyPuzzle) {
    return this.mutate((d) => (d.puzzles[day] ??= p));
  }
  async listDays() {
    const d = await this.load();
    return [...new Set([...Object.keys(d.entries), ...Object.keys(d.attempts), ...Object.keys(d.puzzles)])];
  }
  async isPaidOut(day: string) {
    return Boolean((await this.load()).paid[day]);
  }
  async claimDay(day: string, now: number) {
    return this.mutate((d) => {
      if (d.paid[day]) return false;
      d.paid[day] = { settling: true, at: now };
      return true;
    });
  }
  async unclaimDay(day: string) {
    await this.mutate((d) => {
      delete d.paid[day];
    });
  }
  async markPaidOut(day: string, info: Record<string, unknown>) {
    await this.mutate((d) => {
      d.paid[day] = info;
    });
  }
}

class FileBackend extends JsonDocBackend {
  private file: string;
  constructor(file: string) {
    super();
    this.file = file;
  }
  protected async load(): Promise<Doc> {
    try {
      const { readFile } = await import("node:fs/promises");
      return { ...emptyDoc(), ...JSON.parse(await readFile(this.file, "utf8")) };
    } catch {
      return emptyDoc();
    }
  }
  protected async save(doc: Doc): Promise<void> {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(doc, null, 2));
  }
}

class MemoryBackend extends JsonDocBackend {
  private doc = emptyDoc();
  protected async load() {
    return this.doc;
  }
  protected async save(d: Doc) {
    this.doc = d;
  }
}

// ─────────────────────────── selection ───────────────────────────

let backend: StoreBackend | null = null;

function redisFromEnv(): Redis | null {
  // Works with the Vercel "Upstash for Redis" integration (KV_REST_API_*) and
  // a manual Upstash setup (UPSTASH_REDIS_REST_*).
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export function getStore(): StoreBackend {
  if (backend) return backend;
  const redis = redisFromEnv();
  if (redis) {
    backend = new RedisBackend(redis);
  } else if (process.env.NODE_ENV !== "production") {
    backend = new FileBackend(process.env.STORE_FILE ?? ".data/store.json");
  } else {
    console.warn("[store] No Redis env in production — using in-memory (NOT durable).");
    backend = new MemoryBackend();
  }
  return backend;
}
