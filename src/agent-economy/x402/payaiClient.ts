import { getVercelOidcToken } from '@vercel/oidc';
import { readPayAIAuthentication, requestPayAI, type PayAIOperation } from '../../../supabase/functions/gxeon-payai/payaiAuth.js';
import type { X402PaymentPayload } from './types.js';

const edgeTimeouts = { status: 6_000, verify: 10_000, settle: 23_000 };

function getPayAIEdgeUrl() {
  const configuredUrl = process.env.GXEON_PAYAI_EDGE_URL?.trim();
  if (!configuredUrl) return null;
  const url = new URL(configuredUrl);
  if (url.protocol !== 'https:' || !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) ||
      url.pathname !== '/functions/v1/gxeon-payai' || url.username || url.password ||
      url.port || url.search || url.hash) {
    throw new Error('Invalid PayAI Edge Function URL');
  }
  return url;
}

async function callPayAIEdge(url: URL, operation?: PayAIOperation, body?: string) {
  const token = await getVercelOidcToken({ audience: url.href });
  if (!token) throw new Error('Vercel production identity unavailable');
  if (operation) url.searchParams.set('operation', operation);

  return fetch(url.href, {
    method: operation ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(edgeTimeouts[operation ?? 'status']),
  });
}

function localPayAIAuthentication() {
  return readPayAIAuthentication(process.env.PAYAI_API_KEY_ID, process.env.PAYAI_API_KEY_SECRET);
}

export async function getPayAIStatus() {
  const edgeUrl = getPayAIEdgeUrl();
  if (!edgeUrl) {
    const authentication = localPayAIAuthentication();
    return authentication ? { mode: authentication.mode, source: 'vercel' } as const : null;
  }

  const response = await callPayAIEdge(edgeUrl);
  if (!response.ok) throw new Error('PayAI Edge Function unavailable');
  const { mode } = (await response.json()) as { mode?: unknown };
  if (mode === 'misconfigured') return null;
  if (mode !== 'wallet' && mode !== 'merchant') throw new Error('Invalid PayAI Edge Function status');
  return { mode, source: 'supabase' } as const;
}

export async function callPayAIFacilitator(operation: PayAIOperation, payment: X402PaymentPayload) {
  const body = JSON.stringify({ x402Version: 2, paymentPayload: payment, paymentRequirements: payment.accepted });
  const edgeUrl = getPayAIEdgeUrl();
  let response: Response;
  if (edgeUrl) {
    response = await callPayAIEdge(edgeUrl, operation, body);
  } else {
    const authentication = localPayAIAuthentication();
    if (!authentication) throw new Error('PayAI merchant authentication is unavailable.');
    response = await requestPayAI(operation, body, authentication);
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('PayAI did not authorize the request.');
  }
  const data = await response.json();
  if (operation === 'verify' && !response.ok && data?.isValid !== false) {
    throw new Error('Facilitator verification unavailable');
  }
  return data;
}
