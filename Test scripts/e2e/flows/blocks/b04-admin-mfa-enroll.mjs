// B-4 — Admin first login → MFA enrol → verify → password change.
import { totpGenerate, extractSecretFromUri } from '../../lib/totp.mjs';

export async function adminFirstLogin(ctx, label = 'AD1') {
  const { http, log, assert } = ctx;
  const email = ctx.fixtures.adminEmail;
  const password = ctx.fixtures.adminPassword;
  assert.assert(password, 'DEFAULT_ADMIN_PASSWORD must be set for B-4 (or use --admin-fast-token)');

  log.block(`B-4 admin first login ${email}`, null, label);

  // 1. Login → challengeToken
  const r1 = await http.post('/admin/auth/login', { email, password }, { noAuth: true, expectStatus: [200, 201] });
  const { challengeToken, mfaEnrolled, mustChangePassword } = r1.body || {};
  assert.assert(challengeToken, 'admin login must return challengeToken', r1.body);

  let secret;
  if (!mfaEnrolled) {
    // 2. Enroll
    const r2 = await http.post('/admin/auth/mfa/enroll', { challengeToken }, { noAuth: true, expectStatus: [200, 201] });
    secret = r2.body?.secretBase32 || r2.body?.secret || extractSecretFromUri(r2.body?.otpauthUrl || r2.body?.otpauthUri || '');
    assert.assert(secret, 'mfa/enroll must return secret', r2.body);
  } else {
    // Already enrolled — we cannot derive the secret. Fail clearly.
    assert.assert(false, 'admin already MFA-enrolled; harness needs the secret. Reset stack with --reset.');
  }

  // 3. Verify TOTP
  const code = totpGenerate(secret);
  const r3 = await http.post('/admin/auth/mfa/verify', { challengeToken, code }, { noAuth: true, expectStatus: [200, 201] });
  const { accessToken, refreshToken } = r3.body || {};
  assert.assert(accessToken && refreshToken, 'mfa/verify must return tokens', r3.body);

  const actor = {
    label, role: 'ADMIN', email, password,
    mfaSecret: secret,
    accessToken, refreshToken,
  };
  ctx.actors[label] = actor;

  // 4. Force password change (still required on first login)
  if (mustChangePassword) {
    const newPassword = password.endsWith('!') ? password.replace(/.$/, '#') : password + '!9X';
    const code2 = totpGenerate(secret);
    await ctx.http.post('/admin/auth/password/change',
      { currentPassword: password, newPassword, mfaCode: code2 },
      { actor: label, expectStatus: [200, 204] },
    );
    actor.password = newPassword;
    ctx.fixtures.adminPassword = newPassword;
  }

  log.info(`admin ${label} authed (MFA enrolled, pwd ${mustChangePassword ? 'changed' : 'OK'})`, null, label);
  return actor;
}
