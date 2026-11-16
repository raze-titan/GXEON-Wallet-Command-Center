import crypto from 'node:crypto';
import { createPublicClient, getAddress, http, isAddress, recoverMessageAddress, type Address, type Hex } from 'viem';
import { base } from 'viem/chains';
import { getAgentEconomyStore } from '../store.js';

export const FORBIDDEN_EXAMPLE_ADDRESS = '0x209693bc6afc0c5328ba36faf03c514ef312287c';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface TreasuryVerificationRecord {
  treasury_address: string;
  chain_id?: number;
  challenge: string;
  challenge_hash: string;
  signature: string;
  recovered_address: string;
  verified_at: string;
  verification_method?: string;
  wallet_provider?: string;
}

export function getTreasuryVerificationConfig() {
  const address = process.env.GXEON_X402_BASE_PAYTO?.trim() ?? '';
  const secret = process.env.GXEON_TREASURY_CHALLENGE_SECRET?.trim() ?? '';
  if (!isAddress(address) || address.toLowerCase() === FORBIDDEN_EXAMPLE_ADDRESS ||
      !/^[a-f0-9]{64}$/i.test(secret)) return null;
  return { address: getAddress(address), key: Buffer.from(secret, 'hex') };
}

function challengeMessage(address: Address, nonce: string, timestamp: string, key: Buffer) {
  const message = [
    `GXEON-TREASURY:${nonce}:${timestamp}`,
    'Verifico o controle do meu endereço de recebimento USDC no GXEON.',
    'Esta assinatura autoriza apenas a verificação da carteira.',
    'Origem: gxeon-wallet-command-center.vercel.app',
    'Rede: Base (8453)',
    `Endereço: ${address}`,
    `Válido até: ${new Date(Date.parse(timestamp) + CHALLENGE_TTL_MS).toISOString()}`,
  ].join('\n');
  const tag = crypto.createHmac('sha256', key).update(message).digest('hex');
  return `${message}\nValidação GXEON: ${tag}`;
}

function hashChallenge(challenge: string) {
  return crypto.createHash('sha256').update(challenge).digest('hex');
}

export function generateTreasuryChallenge(targetAddress: string) {
  if (targetAddress.trim().toLowerCase() === FORBIDDEN_EXAMPLE_ADDRESS) {
    throw new Error('SECURITY VIOLATION: The example address is forbidden as a production treasury.');
  }
  const config = getTreasuryVerificationConfig();
  if (!config) throw new Error('A verificação da carteira ainda está indisponível.');
  if (!isAddress(targetAddress) || targetAddress.toLowerCase() !== config.address.toLowerCase()) {
    throw new Error('Conecte o endereço cadastrado para receber USDC no GXEON.');
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = new Date().toISOString();
  const challenge = challengeMessage(config.address, nonce, timestamp, config.key);
  return {
    challenge,
    nonce,
    timestamp,
    challengeHash: hashChallenge(challenge),
    targetAddress: config.address,
  };
}

export async function verifyTreasurySignature(params: {
  address: string;
  challenge: string;
  signature: string;
  walletProvider?: 'metamask' | 'coinbase_wallet' | 'browser_wallet';
}): Promise<{
  verified: boolean;
  recoveredAddress?: string;
  error?: string;
  unavailable?: boolean;
  record?: TreasuryVerificationRecord;
}> {
  const { address, challenge, signature, walletProvider = 'browser_wallet' } = params;
  if (address.trim().toLowerCase() === FORBIDDEN_EXAMPLE_ADDRESS) {
    return { verified: false, error: 'The example address is forbidden.' };
  }
  const config = getTreasuryVerificationConfig();
  if (!config) return { verified: false, unavailable: true, error: 'A verificação da carteira ainda está indisponível.' };
  if (!isAddress(address) || address.toLowerCase() !== config.address.toLowerCase()) {
    return { verified: false, error: 'Conecte o endereço cadastrado para receber USDC no GXEON.' };
  }
  if (challenge.length > 1200 || signature.length > 16386 || !/^0x(?:[0-9a-f]{2})+$/i.test(signature)) {
    return { verified: false, error: 'A carteira retornou um formato de assinatura inválido.' };
  }
  const match = /^GXEON-TREASURY:([a-f0-9]{32}):([^\n]+)\n/.exec(challenge);
  const issuedAt = match ? Date.parse(match[2]) : NaN;
  if (!match || !Number.isFinite(issuedAt) || issuedAt > Date.now() || Date.now() - issuedAt >= CHALLENGE_TTL_MS) {
    return { verified: false, error: 'A solicitação de assinatura venceu. Conecte a carteira novamente.' };
  }
  const expected = Buffer.from(challengeMessage(config.address, match[1], match[2], config.key));
  const provided = Buffer.from(challenge);
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return { verified: false, error: 'A mensagem difere do desafio emitido pelo GXEON.' };
  }

  const recovered = await recoverMessageAddress({ message: challenge, signature: signature as Hex }).catch(() => null);
  let method = 'eip191_signature';
  if (recovered?.toLowerCase() !== config.address.toLowerCase()) {
    const client = createPublicClient({
      chain: base,
      transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org', { timeout: 5000, retryCount: 0 }),
    });
    try {
      const verified = await client.verifyMessage({ address: config.address, message: challenge, signature: signature as Hex });
      if (!verified) return { verified: false, error: 'A assinatura não corresponde à carteira cadastrada.' };
      method = 'base_account_signature';
    } catch {
      return { verified: false, unavailable: true, error: 'A validação da assinatura na Base está indisponível. Tente novamente.' };
    }
  }

  const record: TreasuryVerificationRecord = {
    treasury_address: config.address,
    chain_id: base.id,
    challenge,
    challenge_hash: hashChallenge(challenge),
    signature,
    recovered_address: config.address,
    verified_at: new Date().toISOString(),
    verification_method: method,
    wallet_provider: walletProvider,
  };

  try {
    const store = getAgentEconomyStore();
    const prior = await store.getTreasuryVerification(config.address);
    if (prior?.chain_id === base.id && prior.challenge_hash === record.challenge_hash &&
        prior.signature.toLowerCase() === signature.toLowerCase()) {
      return { verified: true, recoveredAddress: config.address, record: prior };
    }
    await store.saveTreasuryVerification(record);
    return { verified: true, recoveredAddress: config.address, record };
  } catch {
    return { verified: false, unavailable: true, error: 'O registro de verificação está indisponível. Tente novamente.' };
  }
}
