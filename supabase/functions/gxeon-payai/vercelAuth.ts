import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'npm:jose@6.2.17';

const issuer = 'https://oidc.vercel.com/xpex-neural';
const audience = 'https://hklixvnakprhejtdghns.supabase.co/functions/v1/gxeon-payai';
const subject = 'owner:xpex-neural:project:gxeon-wallet-command-center:environment:production';
const keys = createRemoteJWKSet(new URL(issuer + '/.well-known/jwks'), { timeoutDuration: 3_500 });

export async function authenticateGxeonProduction(token: string, getKey: JWTVerifyGetKey = keys) {
  const { payload } = await jwtVerify(token, getKey, {
    issuer,
    audience,
    subject,
    algorithms: ['RS256'],
    requiredClaims: ['exp', 'iat'],
    clockTolerance: 5,
  });
  if (payload.owner_id !== 'team_rvTe2wbTmDcXGPMIMXC8mgRX' ||
      payload.project_id !== 'prj_GRGA7dhQ0lLnyWN7ixIJ8MGlPrhe' || payload.environment !== 'production') {
    throw new Error('Invalid GXEON production identity');
  }
}
