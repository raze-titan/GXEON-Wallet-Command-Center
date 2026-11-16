import { getFeatureFlags } from '../featureFlags.js';
import { getAgentEconomyStore } from '../store.js';
import { getTreasuryStatus } from './networks.js';
import { PAYAI_FACILITATOR, readPayAIAuthentication } from './payaiAuth.js';
import type { TreasuryVerificationRecord } from './treasuryVerifier.js';

export const X402_BASE_NETWORK = 'eip155:8453';

export function hasBaseWalletProof(record: TreasuryVerificationRecord | null, address: string) {
  return record?.chain_id === 8453 && record.treasury_address.toLowerCase() === address.toLowerCase();
}

export async function getX402Readiness(walletProof?: TreasuryVerificationRecord | null) {
  const treasury = getTreasuryStatus();
  if (treasury.status !== 'TREASURY_VERIFIED') {
    return { enabled: false, error: 'TREASURY_NOT_CONFIGURED', reason: treasury.error ?? 'Treasury approval is pending.' } as const;
  }
  if (!getFeatureFlags().marketEnabled || process.env.GXEON_AUTONOMOUS_SELLING_ENABLED !== 'true') {
    return { enabled: false, error: 'SELLING_DISABLED', reason: 'x402 selling is paused by the operator.' } as const;
  }
  if (process.env.GXEON_X402_FACILITATOR !== 'payai') {
    return { enabled: false, error: 'FACILITATOR_NOT_CONFIGURED', reason: 'A Base USDC settlement facilitator is required.' } as const;
  }
  const authentication = readPayAIAuthentication();
  if (!authentication) {
    return { enabled: false, error: 'FACILITATOR_AUTH_NOT_CONFIGURED', reason: 'PayAI merchant authentication requires a valid key pair.' } as const;
  }
  try {
    const record = walletProof === undefined
      ? await getAgentEconomyStore().getTreasuryVerification(treasury.treasuryPayTo) : walletProof;
    if (!hasBaseWalletProof(record, treasury.treasuryPayTo)) {
      return { enabled: false, error: 'WALLET_PROOF_REQUIRED', reason: 'The receiving address needs a verified Base wallet proof.' } as const;
    }
  } catch {
    return { enabled: false, error: 'WALLET_PROOF_UNAVAILABLE', reason: 'The receiving address proof is temporarily unavailable.' } as const;
  }
  return {
    enabled: true,
    payTo: treasury.treasuryPayTo,
    facilitator: PAYAI_FACILITATOR,
    facilitatorAuthentication: authentication.mode === 'merchant' ? 'merchant_configured' : 'wallet',
  } as const;
}
