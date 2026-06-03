/**
 * Build the entry-fee transfer (player → org Safe) as **native** group-CRC.
 *
 * We don't use `transferGroupCrc` here because of a sub-wei rounding bug in its
 * org/ERC1155 path: it unwraps the static-equivalent of the demurraged fee and
 * then `safeTransferFrom`s the full demurraged fee — but the on-chain unwrap
 * truncates, yielding a hair *less* than the fee, so the transfer reverts with
 * an insufficient balance (empty `0x`).
 *
 * Fix: unwrap the fee's worth of CRC **plus a small buffer** that beats the
 * truncation, then transfer exactly the fee. Sources native ERC1155 first, then
 * the demurrage wrapper, then the inflationary wrapper.
 */
import { encodeFunctionData, type Address } from "viem";
import { CirclesConverter } from "@aboutcircles/sdk-utils/circlesConverter";
import type { PermissionlessGroup } from "@aboutcircles/sdk-permissionless-groups";
import { HUB_V2_ADDRESS, SCORE_GROUP_ADDRESS } from "./circles-config";

export interface SimpleTx {
  to: string;
  data: string;
  value: string;
}

const UNWRAP_ABI = [
  { name: "unwrap", type: "function", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
] as const;

const SAFE_TRANSFER_FROM_ABI = [
  {
    name: "safeTransferFrom",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export async function buildEntryTransferTxs(
  group: PermissionlessGroup,
  avatar: Address,
  org: Address,
  feeAtto: bigint,
  /**
   * Native group-CRC that a *preceding* batch step (a migration) will mint to
   * the avatar before this transfer runs. Lets us bundle migration + payment
   * into one atomic, single-signature batch: we account for that native here so
   * we only unwrap whatever's still short.
   */
  extraNativeAtto = 0n
): Promise<SimpleTx[]> {
  const bd = await group.balanceBreakdown(avatar);
  // Hub token id of a group == uint256(uint160(groupAddress)).
  const tokenId = BigInt(SCORE_GROUP_ADDRESS);
  const txs: SimpleTx[] = [];

  // How much native ERC1155 we still need to cover the fee (counting native the
  // migration step will add).
  const availableNative = bd.erc1155 + extraNativeAtto;
  let need = feeAtto > availableNative ? feeAtto - availableNative : 0n;

  // Cover from the demurrage wrapper (1:1 demurraged units).
  if (need > 0n && bd.demurrageWrapper > 0n) {
    const take = need < bd.demurrageWrapper ? need : bd.demurrageWrapper;
    txs.push({
      to: bd.demurrageWrapperAddress,
      data: encodeFunctionData({ abi: UNWRAP_ABI, functionName: "unwrap", args: [take] }),
      value: "0",
    });
    need -= take;
  }

  // Cover the rest from the inflationary wrapper, unwrapping a touch extra so
  // the truncating on-chain unwrap still yields at least `need` demurraged.
  if (need > 0n) {
    let staticAmt = CirclesConverter.attoCirclesToAttoStaticCircles(need);
    staticAmt += staticAmt / 10000n + 10n ** 12n; // ~0.01% + 1e-6 CRC buffer
    if (staticAmt > bd.inflationaryWrapper) staticAmt = bd.inflationaryWrapper;
    txs.push({
      to: bd.inflationaryWrapperAddress,
      data: encodeFunctionData({ abi: UNWRAP_ABI, functionName: "unwrap", args: [staticAmt] }),
      value: "0",
    });
  }

  // Deliver exactly the fee as native ERC1155 to the org.
  txs.push({
    to: HUB_V2_ADDRESS,
    data: encodeFunctionData({
      abi: SAFE_TRANSFER_FROM_ABI,
      functionName: "safeTransferFrom",
      args: [avatar, org, tokenId, feeAtto, "0x"],
    }),
    value: "0",
  });

  return txs;
}
