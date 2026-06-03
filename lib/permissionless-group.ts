/**
 * Factory for a configured `PermissionlessGroup` from
 * `@aboutcircles/sdk-permissionless-groups`.
 *
 * We use exactly two of its methods in this app:
 *   - `balance(avatar)`        → how much group-CRC the player can spend
 *   - `transferGroupCrc(...)`  → build the entry-fee / payout tx batch
 *
 * The score-groups pathfinder + indexer live on the staging RPC; the on-chain
 * Hub/Lift contracts are production. We mirror the package's own example wiring.
 */
import { PermissionlessGroup } from "@aboutcircles/sdk-permissionless-groups";
import { circlesConfig } from "@aboutcircles/sdk-utils";
import {
  HUB_V2_ADDRESS,
  LIFT_ERC20_ADDRESS,
  SCORE_GROUP_ADDRESS,
  SCORE_GROUPS_BACKEND_URL,
  SCORE_GROUPS_RPC_URL,
} from "./circles-config";

let instance: PermissionlessGroup | null = null;

export function getPermissionlessGroup(): PermissionlessGroup {
  if (instance) return instance;

  const config = {
    ...circlesConfig[100]!,
    circlesRpcUrl: SCORE_GROUPS_RPC_URL,
    pathfinderUrl: SCORE_GROUPS_RPC_URL,
  };

  instance = new PermissionlessGroup({
    groupAddress: SCORE_GROUP_ADDRESS,
    hubAddress: HUB_V2_ADDRESS,
    liftERC20Address: LIFT_ERC20_ADDRESS,
    backendBaseUrl: SCORE_GROUPS_BACKEND_URL,
    rpcUrl: SCORE_GROUPS_RPC_URL,
    circlesConfig: config,
  });
  return instance;
}
