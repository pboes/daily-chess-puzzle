# ♞ Daily Chess Duel — a Circles Mini-App

**Live:** https://dailychess-five.vercel.app

A daily speed-chess competition built as an **embedded Circles mini-app**.

> Open the app → the timer starts → solve today's puzzle as fast as you can.
> You get **one attempt per day** with **3 lives** — every wrong move costs a
> life and resets the board to the start, **but the clock keeps running**.
> Players pay an entry fee in Circles up front; at the end of the UTC day the
> **fastest solver takes the whole pot**.

> **One attempt, server-authoritative.** The moment you press *Start*, the
> server stamps your start time; the official solve time is computed server-side
> (`finishedAt − startedAt`). Reloading or closing the app doesn't reset the
> clock — it resumes the same running attempt — so there's no way to get a fresh
> timer. Out of lives = done for the day.

Built for [circles/garage](https://garage.aboutcircles.com) following
[`SKILL.md`](https://garage.aboutcircles.com/SKILL.md).

---

## How it works

| Piece | What it does |
| --- | --- |
| **Puzzle** | [Lichess daily puzzle](https://lichess.org/api/puzzle/daily) — a fresh, rated puzzle every UTC day, rendered with [`react-chessboard`](https://www.npmjs.com/package/react-chessboard) + validated with [`chess.js`](https://www.npmjs.com/package/chess.js). |
| **Wallet** | `@aboutcircles/miniapp-sdk` — the Circles host injects the player's Safe address and signs transactions (`onWalletChange`, `sendTransactions`). |
| **Entry payment** | `@aboutcircles/sdk-permissionless-groups` — `balance(avatar)` checks the player's group-CRC, `transferGroupCrc({ avatar, to: org, amount })` builds the entry-fee transfer, submitted via the host. |
| **Verification** | The backend reads the transaction receipt straight from the Circles RPC and confirms a group-CRC transfer of ≥ the entry fee landed on the org address — no indexer needed. |
| **Payout** | A daily Vercel Cron settles the previous day: it picks the fastest solver and pays them the pot from the org, again via `transferGroupCrc` (org → winner), signed with the org's key. |

### The pot, carry-over & seeding

The **org's on-chain group-CRC balance _is_ the pot** — there is no separate
ledger. Every entry fee adds to it; the daily payout withdraws most of it.

- **pot = org balance** = prior carry-over **+** today's entries (shown live on
  the leaderboard).
- At settlement the winner receives **90% of the pot**; the remaining **10% is
  left in the org**, so it automatically becomes **the next day's seed**.
- **No entries** ⇒ nobody could have solved (you must pay to play) ⇒ no payout
  ⇒ the **entire balance carries over** to the next day.

**Rounds & settlement timing.** A round is a UTC calendar day (starts 00:00 UTC).
The previous day is settled shortly after midnight. Settlement is triggered
three ways and is idempotent + claim-guarded (it can't double-pay):
  1. **Lazy** — any app request settles unsettled past days after the response
     (`after()` → `maybeSettleStaleDays`). This is the reliable path.
  2. **Vercel Cron** (`5 0 * * *`) — a backup; Hobby-plan crons are best-effort.
  3. **Manual** — `POST /api/payout` with the `ADMIN_SECRET` (optionally `?day=`).

**Seeding the initial pot — in-app (no script):** there's a hidden organiser
panel. Unlock it by **tapping the ♞ logo 5× within 3 seconds**, or by opening
the app with **`?fund`** in the URL. Enter an amount and it sends group-CRC from
your connected wallet to the org using the same `transferGroupCrc → host`
flow as paid entries. Whatever lands on the org
(`0x4Fb303cBDfe086311a875944Fd401DA6A92cDe2C`) shows up as the live pot and is
paid to the first winner (minus the reserve). You can of course also just send
group-CRC to that address by any other means. xDAI on the address is only used
for gas, not the pot.

### The competition flow

```
connect (host) ─▶ pay entry fee (transferGroupCrc → org) ─▶ verified on-chain
   ─▶ Start the clock ─▶ solve (3 lives, wrong move = -1 life + board reset)
   ─▶ time submitted to leaderboard ─▶ 00:05 UTC cron pays the day's fastest
```

---

## Circles integration detail

The entry currency is the **score-gated permissionless group**
`0x93eD5A…321f`'s CRC. The flow uses exactly the two functions the brief asked
for, from `@aboutcircles/sdk-permissionless-groups`:

```ts
const group = getPermissionlessGroup();           // lib/permissionless-group.ts

// 1) gate on funds
const bal = await group.balance(avatarAddress);    // GroupCrcBalance (demurraged atto-CRC)

// 2) build the entry transfer to the org (org recipient → ERC1155 path)
const { txs } = await group.transferGroupCrc({
  avatar: avatarAddress,
  to: ORG_ADDRESS,
  amount: ENTRY_FEE_ATTO,
});

// 3) host signs through the user's Safe
const hashes = await sendTransactions(txs);
```

**Org Safe** (collects fees, holds the pot, pays out):
`0xc4B41fEBAD9Fbe7Ec6fa3D3385871bFeE3e57c12` — a **registered Circles
organisation** ("Daily Chess Puzzle"). Everything is **native** group-CRC
(ERC1155): entries land on the Safe natively, the pot is the Safe's native
balance, and payouts are `Hub.safeTransferFrom(safe → winner)` executed by the
Safe via `SafeContractRunner` and signed by an owner EOA
(`0x4Fb303…`, threshold 1). The EOA only signs — it never holds funds. This
renders in the Circles app as a transfer from the organisation, and the Safe
multisend makes payout batches atomic.

> ⚠️ **Note on test funds:** entries are paid in the *staging score-group's*
> CRC. A wallet must hold some of that group's CRC to enter. The integration is
> fully wired and verified against the live network (`balance()` /
> `transferGroupCrc()` both work) — see the validation in the project notes. To
> demo end-to-end you need group-CRC in the playing wallet; adjust
> `SCORE_GROUP_ADDRESS` in `lib/circles-config.ts` to a group you hold if needed.

---

## Run locally

```bash
pnpm install
cp .env.example .env.local   # fill in ORG_PRIVATE_KEY for payouts (optional for play)
pnpm dev                     # http://localhost:3000
```

Outside the Circles host the board shows an **"Open in the Circles app"** gate —
that's by design, the host is the wallet. To test inside the host, deploy a
public HTTPS URL and load it from the Circles playground
(`https://circles.gnosis.io/playground`).

### Environment variables

See [`.env.example`](./.env.example). Summary:

- `NEXT_PUBLIC_ENTRY_FEE_CRC` — entry fee in whole group-CRC (default `1`).
- `ORG_PRIVATE_KEY` — **server-only**; signs daily payouts. Must control the org
  address and be funded with xDAI for gas.
- `ADMIN_SECRET` — Bearer token to manually trigger `/api/payout`.
- `BLOB_READ_WRITE_TOKEN` — durable storage. The whole competition is one JSON
  document; in prod it lives in **Vercel Blob** (auto-injected when a Blob store
  is linked to the project), shared across all serverless instances and the
  daily cron. Locally (no token) it falls back to a real file at
  `.data/store.json`, so `pnpm dev` behaves like a normal file-backed app.
  > ⚠️ A raw local file (SQLite/JSON on disk) does **not** persist on Vercel —
  > serverless filesystems are ephemeral and per-instance. Vercel Blob is the
  > "it's just a JSON file" approach that actually survives across instances.

---

## Deploy (Vercel)

```bash
vercel              # preview
vercel --prod       # production
```

1. Add the env vars above in the Vercel project and link a **Vercel Blob** store
   (`vercel blob create-store <name> --access public --yes`) for durable
   leaderboards — it auto-injects `BLOB_READ_WRITE_TOKEN`.
2. `vercel.json` registers a daily cron (`5 0 * * *` UTC) that hits `/api/payout`
   to settle the previous day and pay the winner.
3. Register the live URL at <https://garage.aboutcircles.com/register>.

---

## API

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/puzzle/today` | GET | Today's puzzle (proxies + normalizes Lichess, cached 1h). |
| `/api/enter` | POST `{address, txHash}` | Verify the entry payment on-chain & register. |
| `/api/enter?address=` | GET | Has this address entered today? |
| `/api/attempt/start` | POST `{address}` | Stamp the start of the player's one attempt (idempotent — resumes, never resets). |
| `/api/attempt/finish` | POST `{address, solved, lives}` | Finalize the attempt once; the time is computed server-side. |
| `/api/attempt?address=` | GET | The caller's attempt state today (started / solved / failed). |
| `/api/leaderboard?address=` | GET | Today's ranking, pot size, your standing. |
| `/api/payout` | GET/POST | Settle a day and pay the fastest solver (cron / `ADMIN_SECRET`). |

---

## Project layout

```
app/
  layout.tsx · page.tsx          shell + WalletProvider
  api/puzzle/today               daily Lichess puzzle (normalized)
  api/enter · api/score          entry verification + score submission
  api/leaderboard · api/payout   ranking + daily settlement (cron)
components/
  game.tsx                       orchestrates puzzle + entry gate + leaderboard
  chess/chess-board.tsx          react-chessboard v5 wrapper
  chess/puzzle-hud.tsx           timer · lives · progress
  leaderboard.tsx · header.tsx · wallet/ · ui/
hooks/
  use-chess-puzzle.ts            timer, 3-lives logic, solve detection
  use-entry.ts                   balance() + transferGroupCrc() + verify
lib/
  circles-config.ts              addresses, RPCs, entry fee
  permissionless-group.ts        configured PermissionlessGroup factory
  puzzle.ts · utils.ts
  server/store.ts                in-memory / Upstash storage
  server/verify-payment.ts       on-chain entry verification
  server/payout.ts               org-signed winner payout
```

## Notes & honest caveats

- **Server-authoritative single attempt.** Start time is stamped server-side and
  the solve time is computed there, so reloads can't reset the clock and the
  client can't report a fake time. (The in-browser timer is just a live display.)
- **EOA payout isn't atomic.** The org is an EOA, so the payout batch (wrap →
  transfer) is submitted sequentially rather than as one Safe multisend.
- **Staging score-group.** Entry uses the staging permissionless group's CRC as
  instructed; swap `SCORE_GROUP_ADDRESS` for production use.
