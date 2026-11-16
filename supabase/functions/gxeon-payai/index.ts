import { readPayAIAuthentication, requestPayAI } from './payaiAuth.ts';
import { authenticateGxeonProduction } from './vercelAuth.ts';

const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (request) => {
  const bearer = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(request.headers.get('Authorization') ?? '');
  if (!bearer || bearer[1].length > 8_192) return json({ error: 'UNAUTHORIZED' }, 401);
  try {
    await authenticateGxeonProduction(bearer[1]);
  } catch {
    return json({ error: 'UNAUTHORIZED' }, 401);
  }

  const authentication = readPayAIAuthentication(
    Deno.env.get('PAYAI_API_KEY_ID'),
    Deno.env.get('PAYAI_API_KEY_SECRET'),
  );
  if (request.method === 'GET') return json({ mode: authentication?.mode ?? 'misconfigured' });
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  if (!authentication) return json({ error: 'FACILITATOR_AUTH_NOT_CONFIGURED' }, 503);

  const operation = new URL(request.url).searchParams.get('operation');
  if (operation !== 'verify' && operation !== 'settle') {
    return json({ error: 'UNSUPPORTED_OPERATION' }, 400);
  }

  let body: string;
  try {
    body = await request.text();
    if (body.length > 16_384) return json({ error: 'PAYMENT_TOO_LARGE' }, 413);
    const { x402Version, paymentPayload, paymentRequirements } = JSON.parse(body);
    if (x402Version !== 2 || paymentPayload?.x402Version !== 2 ||
        paymentRequirements?.scheme !== 'exact' || paymentRequirements?.network !== 'eip155:8453') {
      return json({ error: 'INVALID_PAYMENT' }, 400);
    }
  } catch {
    return json({ error: 'INVALID_PAYMENT' }, 400);
  }

  try {
    const response = await requestPayAI(operation, body, authentication);
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return json({ error: 'FACILITATOR_UNAVAILABLE' }, 503);
  }
});
