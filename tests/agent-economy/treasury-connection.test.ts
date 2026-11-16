import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hexToString, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import servicesHandler from '../../api/v1/services';
import { resetAgentEconomyStoreForTesting } from '../../src/agent-economy/store';
import {
  confirmTreasuryVerification,
  prepareTreasuryVerification,
  readTreasuryApi,
  type TreasuryStatus,
} from '../../src/wallets/treasuryConnection';

const account = privateKeyToAccount(generatePrivateKey());

describe('GXEON wallet connection', () => {
  beforeEach(() => {
    resetAgentEconomyStoreForTesting();
    vi.stubEnv('GXEON_X402_BASE_PAYTO', account.address);
    vi.stubEnv('GXEON_TREASURY_CHALLENGE_SECRET', 'ab'.repeat(32));
    vi.stubEnv('GXEON_TREASURY_VERIFIED', 'false');
    vi.stubEnv('GXEON_AUTONOMOUS_SELLING_ENABLED', 'true');
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const headers = new Headers();
      let response: Response | undefined;
      const res = {
        statusCode: 200,
        setHeader: (name: string, value: string) => headers.set(name, value),
        end: (body: string) => { response = new Response(body, { status: res.statusCode, headers }); },
      };
      await servicesHandler({ method: init?.method ?? 'GET', url, body: init?.body }, res);
      return response;
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('switches to Base and stores the approved proof while x402 is paused', async () => {
    let chain = '0x1';
    const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
      switch (method) {
        case 'eth_requestAccounts': return [account.address];
        case 'eth_chainId': return chain;
        case 'wallet_switchEthereumChain':
          expect(params).toEqual([{ chainId: '0x2105' }]);
          chain = '0x2105';
          return null;
        case 'personal_sign':
          expect(params?.[1]).toBe(account.address);
          return account.signMessage({ message: hexToString(params?.[0] as Hex) });
        default: throw new Error(`Unexpected wallet method ${method}`);
      }
    });

    const pending = await prepareTreasuryVerification({ request });
    const proof = await confirmTreasuryVerification(pending, 'metamask');
    const status = await readTreasuryApi<TreasuryStatus>('/v1/treasury/status');
    expect(proof.address).toBe(account.address);
    expect(status).toEqual({ configured: true, walletVerified: true, verifiedAt: proof.verifiedAt, x402Enabled: false });
    expect(request.mock.calls.map(([args]) => args.method)).toEqual([
      'eth_requestAccounts', 'eth_chainId', 'wallet_switchEthereumChain', 'eth_chainId', 'personal_sign',
    ]);
  });

  it('rejects a different account before requesting a signature', async () => {
    const request = vi.fn(async (_args: { method: string }) => [privateKeyToAccount(generatePrivateKey()).address]);
    await expect(prepareTreasuryVerification({ request })).rejects.toThrow('endereço cadastrado');
    expect(request.mock.calls).toEqual([[{ method: 'eth_requestAccounts' }]]);
  });

  it('rejects an edited challenge even if it was signed by the right account', async () => {
    const { challenge } = await readTreasuryApi<{ challenge: string }>(`/v1/treasury/challenge?address=${account.address}`);
    const edited = challenge.replace('Rede: Base (8453)', 'Rede: Ethereum (1)');
    const signature = await account.signMessage({ message: edited });
    await expect(readTreasuryApi('/v1/treasury/verify', {
      method: 'POST',
      body: JSON.stringify({ address: account.address, challenge: edited, signature }),
    })).rejects.toThrow('difere do desafio');
  });
});
