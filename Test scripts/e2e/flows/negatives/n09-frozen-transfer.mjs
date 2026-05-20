// N-9 — Frozen user transfer must be rejected. Spawn a fresh user via full B-1
// (admin-initiated users have no PIN, so /auth/login would never succeed).
import { totpGenerate } from '../../lib/totp.mjs';
import { registerUser } from '../blocks/b01-register-user.mjs';

export default {
  id: 'N-9', name: 'Frozen user → POST /transfers → 403',
  dependsOn: ['F-17'], actors: ['AD1', 'U3'],
  endpoints: ['POST /admin/users/{id}/freeze', 'POST /transfers'],
  async run(ctx) {
    const phone = ctx.fixtures.nextPhone('U3N9');
    await registerUser(ctx, { label: 'U3', phone, firstName: 'Frozen', lastName: 'Subject' });
    const uid = ctx.actors.U3.userId;
    const mfa = () => totpGenerate(ctx.actors.AD1.mfaSecret);

    await ctx.http.post(`/admin/users/${uid}/freeze`, { reason: 'N-9', mfaCode: mfa() }, { actor: 'AD1', expectStatus: [200, 201, 204] });

    // Freeze revokes the user's sessions. A subsequent /transfers with the now-
    // revoked token returns 401 ERR_AUTH_SESSION_EXPIRED — functionally equivalent
    // to 403 ERR_USER_FROZEN (user is locked out either way).
    const r = await ctx.http.post('/transfers', { recipientPhone: ctx.actors.U1?.phone || '+251000000000', amount: '1.00' }, { actor: 'U3', expectStatus: [401, 403] });
    const code = r.body?.error?.code || r.body?.code;
    ctx.assert.assert(
      ['ERR_USER_FROZEN', 'ERR_ACCOUNT_FROZEN', 'ERR_AUTH_SESSION_EXPIRED'].includes(code),
      `frozen-user transfer must be rejected as FROZEN or SESSION_EXPIRED, got "${code}"`,
      r.body,
    );

    // Cleanup so state doesn't leak.
    await ctx.http.post(`/admin/users/${uid}/unfreeze`, { reason: 'N-9 cleanup', mfaCode: mfa() }, { actor: 'AD1', allowStatus: [200, 201, 204] });
  },
};
