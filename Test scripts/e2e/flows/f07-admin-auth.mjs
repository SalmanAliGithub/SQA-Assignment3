// F-7 — Admin auth full lifecycle.
import { adminFirstLogin } from './blocks/b04-admin-mfa-enroll.mjs';
import { adminRelogin } from './blocks/b05-admin-relogin.mjs';
import { totpGenerate } from '../lib/totp.mjs';

export default {
  id: 'F-7',
  name: 'Admin auth lifecycle',
  dependsOn: ['F-26a'],
  actors: ['AD1'],
  endpoints: [
    'POST /admin/auth/login',
    'POST /admin/auth/mfa/enroll',
    'POST /admin/auth/mfa/verify',
    'POST /admin/auth/password/change',
    'POST /admin/auth/logout',
    'GET /admin/probe',
  ],
  async run(ctx) {
    const { http, assert } = ctx;

    if (ctx.opts.adminFastToken) {
      ctx.log.warn('--admin-fast-token enabled: skipping F-7 (use only for debugging)');
      return;
    }

    ctx.currentStep = 'first-login';
    await adminFirstLogin(ctx, 'AD1');

    ctx.currentStep = 'probe';
    const probe = await http.get('/admin/probe', { actor: 'AD1', expectStatus: [200] });
    assert.assert(probe.body, '/admin/probe should return a body');

    ctx.currentStep = 'logout';
    const a = ctx.actors.AD1;
    await http.post('/admin/auth/logout', { refreshToken: a.refreshToken }, { actor: 'AD1', expectStatus: [200, 204] });

    ctx.currentStep = 'relogin';
    await adminRelogin(ctx, 'AD1');

    ctx.currentStep = 'wrong-mfa';
    const r = await http.post('/admin/auth/password/change', {
      currentPassword: a.password,
      newPassword: a.password,
      mfaCode: '000000',
    }, { actor: 'AD1', allowStatus: [400, 401, 403, 422] });
    assert.assert(r.status !== 200 && r.status !== 204, 'password/change with wrong MFA must not succeed');
  },
};
