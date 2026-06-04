/**
 * One-off: copy the old Vercel Blob JSON-doc store into Redis.
 *
 * Run after provisioning Redis, with these env vars available
 * (`vercel env pull .env.migrate`):
 *   BLOB_READ_WRITE_TOKEN
 *   REDIS_URL
 *
 *   node --env-file=.env.migrate scripts/migrate-blob-to-redis.mjs
 */
import { list } from "@vercel/blob";
import IORedis from "ioredis";

const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
const url = process.env.REDIS_URL ?? process.env.KV_URL;
if (!blobToken || !url) {
  console.error("Missing env: need BLOB_READ_WRITE_TOKEN + REDIS_URL");
  process.exit(1);
}
const redis = new IORedis(url, { maxRetriesPerRequest: 3 });
const S = (v) => JSON.stringify(v);

const { blobs } = await list({ prefix: "daily-chess/store.json", token: blobToken });
if (!blobs.length) {
  console.log("No blob store.json found — nothing to migrate.");
  process.exit(0);
}
const doc = await (await fetch(`${blobs[0].url}?t=${Date.now()}`, { cache: "no-store" })).json();

let entries = 0, attempts = 0, puzzles = 0, paid = 0, tx = 0;
for (const [day, dd] of Object.entries(doc.days ?? {})) {
  for (const [addr, e] of Object.entries(dd.entries ?? {})) {
    await redis.hset(`dcp:entries:${day}`, addr, S(e));
    entries++;
  }
  for (const [addr, a] of Object.entries(dd.attempts ?? {})) {
    await redis.hset(`dcp:attempts:${day}`, addr, S(a));
    attempts++;
  }
  await redis.sadd("dcp:days", day);
}
for (const [day, p] of Object.entries(doc.puzzles ?? {})) {
  await redis.set(`dcp:puzzle:${day}`, S(p));
  await redis.sadd("dcp:days", day);
  puzzles++;
}
for (const [day, info] of Object.entries(doc.paidOut ?? {})) {
  await redis.set(`dcp:paid:${day}`, S(info));
  paid++;
}
for (const t of doc.usedTx ?? []) {
  await redis.sadd("dcp:usedtx", t);
  tx++;
}

console.log(`Migrated: ${entries} entries, ${attempts} attempts, ${puzzles} puzzles, ${paid} paid, ${tx} usedTx`);
console.log("days:", await redis.smembers("dcp:days"));
await redis.quit();
