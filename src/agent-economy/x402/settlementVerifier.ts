import { createHash } from 'node:crypto';
import { createPublicClient, http, isAddress, parseAbiItem, parseEventLogs, type Address, type Hex } from 'viem';
import { base } from 'viem/chains';
import { getAgentEconomyStore } from '../store.js';
import { createPayAIHeaders, PAYAI_FACILITATOR, readPayAIAuthentication, type PayAIAuthentication } from './payaiAuth.js';
import type { X402AcceptOption, X402PaymentPayload, X402SettlementVerification } from './types.js';

const authorizationUsed = parseAbiItem('event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)');
const transfer = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const hashPattern = /^0x[0-9a-f]{64}$/i;

export function getPaymentPayload(header: string, requirements: X402AcceptOption, resourceUrl: string): X402PaymentPayload | null {
  if (header.length > 12_000) return null;
  try {
    const packet = JSON.parse(header.startsWith('{') ? header : Buffer.from(header, 'base64').toString('utf8'));
    const accepted = packet?.accepted;
    const { authorization: auth, signature } = packet?.payload ?? {};
    if (packet?.x402Version !== 2 ||
        (packet.resource && packet.resource.url !== resourceUrl) ||
        accepted?.scheme !== requirements.scheme || accepted.network !== requirements.network ||
        accepted.amount !== requirements.amount || !sameAddress(accepted.asset, requirements.asset) ||
        !sameAddress(accepted.payTo, requirements.payTo) ||
        typeof auth?.from !== 'string' || !isAddress(auth.from) ||
        sameAddress(auth.from, requirements.payTo) || !sameAddress(auth.to, requirements.payTo) ||
        String(auth.value) !== requirements.amount ||
        typeof auth.nonce !== 'string' || !hashPattern.test(auth.nonce) ||
        !/^\d{1,12}$/.test(String(auth.validAfter)) || !/^\d{1,12}$/.test(String(auth.validBefore)) ||
        typeof signature !== 'string' || !/^0x(?:[0-9a-f]{2}){64,4096}$/i.test(signature)) {
      return null;
    }
    return {
      x402Version: 2,
      resource: { url: resourceUrl, mimeType: 'application/json' },
      accepted: requirements,
      payload: {
        signature: signature.toLowerCase(),
        authorization: {
          from: auth.from.toLowerCase(),
          to: requirements.payTo,
          value: requirements.amount,
          validAfter: String(auth.validAfter),
          validBefore: String(auth.validBefore),
          nonce: auth.nonce.toLowerCase(),
        },
      },
    };
  } catch {
    return null;
  }
}

function sameAddress(value: unknown, expected: string) {
  return typeof value === 'string' && value.toLowerCase() === expected.toLowerCase();
}

type PaymentResult =
  | { kind: 'confirmed'; proof: X402SettlementVerification }
  | { kind: 'invalid'; message: string }
  | { kind: 'pending' }
  | { kind: 'conflict' };

async function callFacilitator(operation: 'verify' | 'settle', payment: X402PaymentPayload, authentication: PayAIAuthentication) {
  const response = await fetch(PAYAI_FACILITATOR + '/' + operation, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...createPayAIHeaders(authentication) },
    body: JSON.stringify({ x402Version: 2, paymentPayload: payment, paymentRequirements: payment.accepted }),
    redirect: 'error',
    signal: AbortSignal.timeout(operation === 'verify' ? 6_000 : 18_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('PayAI did not authorize the request.');
  }
  const data = await response.json();
  if (operation === 'verify' && !response.ok && data?.isValid !== false) {
    throw new Error('Facilitator verification unavailable');
  }
  return data;
}

export async function verifyX402Settlement(
  payment: X402PaymentPayload,
  requestHash: string,
): Promise<PaymentResult> {
  const store = getAgentEconomyStore();
  const { authorization: auth } = payment.payload;
  const settlementId = createHash('sha256').update(auth.from + ':' + auth.nonce).digest('hex');
  const client = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL || base.rpcUrls.default.http[0], { timeout: 4500, retryCount: 0 }),
  });

  let intent = await store.getX402PaymentIntent(settlementId);
  if (intent && intent.requestHash !== requestHash) return { kind: 'conflict' };

  if (await client.getChainId() !== base.id) throw new Error('Base RPC returned an unexpected chain');
  if (!intent) {
    const now = Math.floor(Date.now() / 1000);
    if (Number(auth.validBefore) <= now || Number(auth.validAfter) > now ||
        Number(auth.validBefore) > now + payment.accepted.maxTimeoutSeconds + 30) {
      return { kind: 'invalid', message: 'Payment authorization expiry does not match the quoted terms.' };
    }

    const authentication = readPayAIAuthentication();
    if (!authentication) throw new Error('PayAI merchant authentication is unavailable.');
    const verified = await callFacilitator('verify', payment, authentication);
    if (verified?.isValid !== true || (verified.payer && !sameAddress(verified.payer, auth.from))) {
      return { kind: 'invalid', message: 'The facilitator did not verify the authorization.' };
    }

    const firstBlock = await client.getBlockNumber();
    const reservation = await store.reserveX402PaymentIntent({
      id: settlementId,
      requestHash,
      firstBlock: String(firstBlock),
    });
    intent = reservation.record;

    if (intent.requestHash !== requestHash) return { kind: 'conflict' };
    if (reservation.created) {
      const submitted = await callFacilitator('settle', payment, authentication).catch(() => null);
      if (submitted?.network === payment.accepted.network &&
          typeof submitted.transaction === 'string' && hashPattern.test(submitted.transaction)) {
        const txHash = submitted.transaction.toLowerCase();
        intent = { ...intent, txHash };
        await store.setX402PaymentTransaction(settlementId, txHash);
      }
    }
  }

  const asset = payment.accepted.asset as Address;
  const payer = auth.from as Address;
  const nonce = auth.nonce as Hex;
  let txHash = intent.txHash as Hex | undefined;
  if (!txHash) {
    // An interrupted facilitator call may already have broadcast the transfer.
    // Locate that authorization's transaction, without asking the buyer to pay again.
    const firstBlock = BigInt(intent.firstBlock);
    const tip = await client.getBlockNumber();
    const searchEnd = firstBlock + 450n;
    const logs = await client.getLogs({
      address: asset,
      event: authorizationUsed,
      args: { authorizer: payer, nonce },
      fromBlock: firstBlock,
      toBlock: tip < searchEnd ? tip : searchEnd,
      strict: true,
    });
    txHash = logs.find(log => !log.removed)?.transactionHash ?? undefined;
    if (!txHash) {
      const expired = Number(auth.validBefore) + 45 < Date.now() / 1000;
      return expired ? { kind: 'invalid', message: 'The authorization expired without a confirmed Base transfer.' } : { kind: 'pending' };
    }
    await store.setX402PaymentTransaction(settlementId, txHash);
  }

  const receipt = await client.getTransactionReceipt({ hash: txHash }).catch(() => null);
  if (!receipt) return { kind: 'pending' };
  if (receipt.status !== 'success' || receipt.transactionHash.toLowerCase() !== txHash.toLowerCase() ||
      receipt.blockNumber <= 0n || receipt.blockNumber > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { kind: 'invalid', message: 'The Base transaction did not settle successfully.' };
  }

  const assetLogs = receipt.logs.filter(log => !log.removed && sameAddress(log.address, asset));
  const authorizationLogs = parseEventLogs({ abi: [authorizationUsed], logs: assetLogs, strict: true });
  const transferLogs = parseEventLogs({ abi: [transfer], logs: assetLogs, strict: true });
  const used = authorizationLogs.some(log => sameAddress(log.args.authorizer, auth.from) &&
    log.args.nonce.toLowerCase() === auth.nonce);
  const received = transferLogs.some(log => sameAddress(log.args.from, auth.from) &&
    sameAddress(log.args.to, payment.accepted.payTo) && log.args.value === BigInt(payment.accepted.amount));

  if (!used || !received) {
    return { kind: 'invalid', message: 'The Base receipt does not prove this exact USDC payment.' };
  }

  const finalized = await client.getBlock({ blockTag: 'finalized' });
  if (finalized.number === null || finalized.number < receipt.blockNumber) return { kind: 'pending' };
  const canonical = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (canonical.hash === null || canonical.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
    return { kind: 'pending' };
  }

  return { kind: 'confirmed', proof: { settlementId, txHash, blockNumber: Number(receipt.blockNumber) } };
}
