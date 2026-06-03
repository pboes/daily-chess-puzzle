/**
 * Verify that a transaction is a genuine group-CRC transfer of at least the
 * entry fee into the org address. Two delivery shapes are accepted, matching
 * what `transferGroupCrc()` emits:
 *
 *   - ERC1155 `TransferSingle` from the Hub with `to == ORG` (org recipient
 *     path: the SDK unwraps and `safeTransferFrom`s the group token id).
 *   - ERC20 `Transfer` with `to == ORG` (non-org path: inflationary wrapper).
 *
 * We read the receipt straight from the Circles RPC; no indexer required.
 */
import {
  createPublicClient,
  http,
  decodeEventLog,
  parseAbiItem,
  getAddress,
  type Hash,
} from "viem";
import { gnosis } from "viem/chains";
import {
  CIRCLES_RPC_URL,
  ENTRY_FEE_ATTO,
  HUB_V2_ADDRESS,
  ORG_ADDRESS,
  SCORE_GROUP_ADDRESS,
} from "@/lib/circles-config";

const publicClient = createPublicClient({
  chain: gnosis,
  transport: http(CIRCLES_RPC_URL),
});

const transferSingleAbi = parseAbiItem(
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)"
);
const erc20TransferAbi = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

/** Group token id in Hub V2 == uint256(uint160(groupAddress)). */
const GROUP_TOKEN_ID = BigInt(SCORE_GROUP_ADDRESS);

// Allow a little slack for demurrage→inflationary truncation on the ERC20 path.
const MIN_AMOUNT = (ENTRY_FEE_ATTO * 95n) / 100n;

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  from?: string;
  amount?: string;
  mode?: "erc1155" | "erc20";
}

export async function verifyEntryPayment(
  txHash: string,
  expectedFrom?: string
): Promise<VerifyResult> {
  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: txHash as Hash });
  } catch {
    return { ok: false, reason: "Transaction not found or not yet mined" };
  }
  if (receipt.status !== "success") {
    return { ok: false, reason: "Transaction reverted" };
  }

  const org = getAddress(ORG_ADDRESS);

  for (const log of receipt.logs) {
    // ---- ERC1155 TransferSingle from the Hub (org recipient path) ----
    if (getAddress(log.address) === getAddress(HUB_V2_ADDRESS)) {
      try {
        const { args, eventName } = decodeEventLog({
          abi: [transferSingleAbi],
          data: log.data,
          topics: log.topics,
        });
        if (
          eventName === "TransferSingle" &&
          getAddress(args.to as string) === org &&
          (args.id as bigint) === GROUP_TOKEN_ID &&
          (args.value as bigint) >= MIN_AMOUNT
        ) {
          const from = getAddress(args.from as string);
          if (expectedFrom && from !== getAddress(expectedFrom)) continue;
          return { ok: true, from, amount: (args.value as bigint).toString(), mode: "erc1155" };
        }
      } catch {
        /* not this event */
      }
    }

    // ---- ERC20 Transfer into the org (inflationary wrapper path) ----
    try {
      const { args, eventName } = decodeEventLog({
        abi: [erc20TransferAbi],
        data: log.data,
        topics: log.topics,
      });
      if (
        eventName === "Transfer" &&
        getAddress(args.to as string) === org &&
        (args.value as bigint) >= MIN_AMOUNT
      ) {
        const from = getAddress(args.from as string);
        if (expectedFrom && from !== getAddress(expectedFrom)) continue;
        return { ok: true, from, amount: (args.value as bigint).toString(), mode: "erc20" };
      }
    } catch {
      /* not an ERC20 Transfer */
    }
  }

  return { ok: false, reason: "No qualifying CRC transfer to the org found in this tx" };
}
