import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'npm:jose@6.2.17';
import { authenticateGxeonProduction } from './vercelAuth.ts';

Deno.test('accepts only the GXEON production project and audience', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const keys = createLocalJWKSet({ keys: [await exportJWK(publicKey)] });
  const claims = {
    iss: 'https://oidc.vercel.com/xpex-neural',
    aud: 'https://hklixvnakprhejtdghns.supabase.co/functions/v1/gxeon-payai',
    sub: 'owner:xpex-neural:project:gxeon-wallet-command-center:environment:production',
    owner_id: 'team_rvTe2wbTmDcXGPMIMXC8mgRX',
    project_id: 'prj_GRGA7dhQ0lLnyWN7ixIJ8MGlPrhe',
    environment: 'production',
    exp: Math.floor(Date.now() / 1_000) + 60,
  };
  function mint(overrides: Partial<typeof claims> = {}) {
    return new SignJWT({ ...claims, ...overrides })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .sign(privateKey);
  }

  await authenticateGxeonProduction(await mint(), keys);
  for (const overrides of [
    { iss: 'https://oidc.vercel.com/another-team' },
    { aud: 'https://vercel.com/xpex-neural' },
    { sub: claims.sub.replace('production', 'preview'), environment: 'preview' },
    { project_id: 'another-project' },
    { owner_id: 'another-team' },
    { exp: 1 },
  ]) {
    const invalid = await mint(overrides);
    await assert.rejects(authenticateGxeonProduction(invalid, keys));
  }
});
