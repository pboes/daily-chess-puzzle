/**
 * Daily payout: send the pot to the day's fastest solver, **from the org Safe**,
 * using the SDK's `transferGroupCrc`.
 *
 * `transferGroupCrc` does the form-handling for us: it consolidates the Safe's
 * group-CRC across native ERC1155 + wrapped ERC20 (unwrapping / wrapping as
 * needed) and delivers the amount to the winner. The returned tx batch is
 * executed by the Safe through `SafeContractRunner`, signed by an owner EOA
 * (threshold 1) — so funds move from the registered org, and the Safe multisend
 * makes the batch atomic. The EOA only signs.
 */
import { getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { gnosis } from "viem/chains";
import { SafeContractRunner } from "@aboutcircles/sdk-runner";
import { getPermissionlessGroup } from "@/lib/permissionless-group";
import { CIRCLES_RPC_URL, ORG_ADDRESS, ORG_SIGNER_ADDRESS } from "@/lib/circles-config";

export interface PayoutResult {
  winner: string;
  /** Amount paid to the winner (demurraged atto-CRC). */
  amountAtto: string;
  /** Reserve left in the org Safe to seed the next day (10%). */
  reserveAtto: string;
  /** Org Safe's group-CRC at settlement (the pot, demurraged). */
  potAtto: string;
  /** How transferGroupCrc delivered it. */
  mode: string;
  txHashes: string[];
}

export async function payoutWinner(winner: string): Promise<PayoutResult> {
  const pk = process.env.ORG_PRIVATE_KEY as Hex | undefined;
  if (!pk) throw new Error("ORG_PRIVATE_KEY is not configured");

  // The key only signs for the Safe; assert it's the expected owner EOA.
  const account = privateKeyToAccount(pk);
  if (getAddress(account.address) !== getAddress(ORG_SIGNER_ADDRESS)) {
    throw new Error("ORG_PRIVATE_KEY is not the org Safe's signer EOA");
  }

  const winnerAddr = getAddress(winner);
  const group = getPermissionlessGroup();

  // Pot = the org Safe's group-CRC across all forms (demurraged). Winner takes
  // 90%; the remaining 10% stays in the Safe and seeds the next day.
  const bal = await group.balance(ORG_ADDRESS as `0x${string}`);
  const pot = bal.heldTotal;
  const reserve = pot / 10n;
  const amount = pot - reserve;
  if (amount <= 0n) {
    throw new Error("Org Safe holds no group-CRC — nothing to pay out");
  }

  // Let the SDK build the (form-aware) transfer batch from the Safe → winner.
  const { txs, mode } = await group.transferGroupCrc({
    avatar: ORG_ADDRESS as `0x${string}`,
    to: winnerAddr,
    amount,
  });

  // Execute through the Safe (owner EOA signs, Safe broadcasts atomically).
  const runner = await SafeContractRunner.create(
    CIRCLES_RPC_URL,
    pk,
    ORG_ADDRESS as `0x${string}`,
    gnosis
  );
  const receipt = await runner.sendTransaction(txs);

  return {
    winner: winnerAddr,
    amountAtto: amount.toString(),
    reserveAtto: reserve.toString(),
    potAtto: pot.toString(),
    mode,
    txHashes: [receipt.transactionHash],
  };
}
