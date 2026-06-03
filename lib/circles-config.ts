/**
 * Shared Circles / competition configuration.
 *
 * All addresses are on Gnosis Chain (chainId 100). The score-groups stack
 * (pathfinder + indexer used by the permissionless-groups package) lives on
 * the staging RPC; the on-chain contracts (Hub V2, Lift) are production.
 */
import type { Address } from "viem";

/**
 * The Circles **organisation Safe** that collects entry fees, holds the pot,
 * and pays out — a registered Circles org ("Daily Chess Puzzle"). All funds are
 * sent to, held by, and paid from this address.
 */
export const ORG_ADDRESS = "0xc4B41fEBAD9Fbe7Ec6fa3D3385871bFeE3e57c12" as Address;

/**
 * The EOA that signs on behalf of the org Safe (a Safe owner, threshold 1).
 * It only signs — it never holds or receives funds. Derived from
 * `ORG_PRIVATE_KEY`; asserted at payout time.
 */
export const ORG_SIGNER_ADDRESS =
  "0x4Fb303cBDfe086311a875944Fd401DA6A92cDe2C" as Address;

/** Score-gated permissionless group whose CRC is used as the entry currency. */
export const SCORE_GROUP_ADDRESS =
  "0x93eD5A96347927ff6fF6b790F8Cf5258240c321f" as Address;

/** Hub V2 (production). */
export const HUB_V2_ADDRESS =
  "0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8" as Address;

/** LiftERC20 (production) — resolves the group's ERC20 wrapper addresses. */
export const LIFT_ERC20_ADDRESS =
  "0x5F99a795dD2743C36D63511f0D4bc667e6d3cDB5" as Address;

export const CIRCLES_RPC_URL = "https://rpc.aboutcircles.com/";
export const SCORE_GROUPS_RPC_URL = "https://rpc.staging.aboutcircles.com/";
export const SCORE_GROUPS_BACKEND_URL =
  "https://rpc.staging.aboutcircles.com/score-groups";

/** Entry fee, in whole group-CRC. Converted to atto-CRC (1e18) when used. */
export const ENTRY_FEE_CRC = Number(process.env.NEXT_PUBLIC_ENTRY_FEE_CRC ?? "1");

/** Entry fee in demurraged atto-CRC — the unit transferGroupCrc expects. */
export const ENTRY_FEE_ATTO = BigInt(Math.round(ENTRY_FEE_CRC * 1e6)) * 10n ** 12n;
