// B-5 — Returning admin login (already enrolled).
import { totpGenerate } from '../../lib/totp.mjs';

export async function adminRelogin(ctx, label = 'AD1') {
  const { http, log, assert } = ctx;
  const a = ctx.actors[label];
  assert.assert(a?.mfaSecret, `adminRelogin requires actor ${label} with mfaSecret (run B-4 first)`);
  log.block(`B-5 admin re-login ${label}`, null, label);

  const r1 = await http.post('/admin/auth/login', { email: a.email, password: a.password }, { noAuth: true, expectStatus: [200, 201] });
  const { challengeToken } = r1.body || {};
  assert.assert(challengeToken, 'admin login must return challengeToken', r1.body);

  const code = totpGenerate(a.mfaSecret);
  const r2 = await http.post('/admin/auth/mfa/verify', { challengeToken, code }, { noAuth: true, expectStatus: [200, 201] });
  a.accessToken = r2.body.accessToken;
  a.refreshToken = r2.body.refreshToken;
  return a;
}
