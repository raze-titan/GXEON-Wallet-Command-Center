import { PayoutVerification, BountyItem } from '../types';
import { quantumEventBus } from '../events/eventBus';

export interface PayoutVerificationRequest {
  bountyId?: string;
  minerRewardId?: string;
  network: string;
  asset: string;
  destinationWallet: string;
  expectedAmount: string;
  txHash?: string;
  customRpcEndpoint?: string;
}

/**
 * EXACT IMPLEMENTED AND CONFIRMED ON-CHAIN VERIFICATION SOURCES ONLY.
 * Legacy/unimplemented sources are strictly excluded.
 */
export const LIVE_ONCHAIN_SOURCES = [
  'evm_rpc_native_transfer