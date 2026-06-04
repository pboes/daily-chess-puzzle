/**
 * One-off: copy the old Vercel Blob JSON-doc store into Upstash Redis.
 *
 * Run after provisioning Upstash, with these env vars available (pull them from
 * Vercel: `vercel env pull .env.migrate`):
 *   BLOB_READ_WRITE_TOKEN
 *   KV_REST_API_URL + KV_REST_API_TOKEN   (or UPSTASH_REDIS_REST_URL/TOKEN)
 *
 *   node --env-file=.env.migrate scripts/migrate-blob-to-redis.mjs
 */
import { list } from "@vercel/blob";
import { Redis } from "@upstash/redis";

const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
if (!blobToken || !url || !token) {
  console.error("Missing env: need BLOB_READ_WRITE_TOKEN + KV_REST_API_URL/TOKEN");
  process.exit(1);
}
const redis = new Redis({ url, token });

const { blobs } = await list({ prefix: "daily-chess/store.json", token: blobToken });
if (!blobs.length) {
  console.log("No blob store.json found — nothing to migrate.");
  process.exit(0);
}
const doc = await (await fetch(`${blobs[0].url}?t=${Date.now()}`, { cache: "no-store" })).json();

let entries = 0, attempts = 0, puzzles = 0, paid = 0, tx = 0;
for (const [day, dd] of Object.entries(doc.days ?? {})) {
  for (const [addr, e] of Object.entries(dd.entries ?? {})) {
    await redis.hset(`dcp:entries:${day}`, { [addr]: e });
    entries++;
  }
  for (const [addr, a] of Object.entries(dd.attempts ?? {})) {
    await redis.hset(`dcp:attempts:${day}`, { [addr]: a });
    attempts++;
  }
  await redis.sadd("dcp:days", day);
}
for (const [day, p] of Object.entries(doc.puzzles ?? {})) {
  await redis.set(`dcp:puzzle:${day}`, p);
  await redis.sadd("dcp:days", day);
  puzzles++;
}
for (const [day, info] of Object.entries(doc.paidOut ?? {})) {
  await redis.set(`dcp:paid:${day}`, info);
  paid++;
}
for (const t of doc.usedTx ?? []) {
  await redis.sadd("dcp:usedtx", t);
  tx++;
}

console.log(`Migrated: ${entries} entries, ${attempts} attempts, ${puzzles} puzzles, ${paid} paid, ${tx} usedTx`);
console.log("days:", await redis.smembers("dcp:days"));
