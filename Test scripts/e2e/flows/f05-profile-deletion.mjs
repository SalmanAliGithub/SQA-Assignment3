// F-5 — Profile + preferences + soft-delete + admin recovery.
// NOTE: we use U3 (throwaway) so U1 stays usable for later flows.
import { registerUser } from './blocks/b01-register-user.mjs';
import { totpGenerate } from '../lib/totp.mjs';

export default {
  id: 'F-5',
  name: 'Profile, preferences, deletion, admin recovery',
  dependsOn: ['F-1', 'F-7'],
  actors: ['U3', 'AD1'],
  endpoints: [
    'PATCH /me', 'PATCH /me/preferences', 'DELETE /me',
    'POST /admin/users/{id}/account-recovery', 'GET /admin/users/{id}',
  ],
  async run(ctx) {
    const { http, fixtures, assert } = ctx;
    const phone = fixtures.nextPhone('U3');
    await registerUser(ctx, { label: 'U3', phone, firstName: 'Throw', lastName: 'Away' });
    ctx.currentActor = 'U3';

    ctx.currentStep = 'patch-me';
    await http.patch('/me', { fullName: 'Updated Name', avatarUrl: 'https://cdn.example.com/a.jpg' }, { expectStatus: [200, 204] });

    ctx.currentStep = 'patch-prefs';
    await http.patch('/me/preferences', { language: 'am', notifications: { marketing: true } }, { expectStatus: [200, 204] });

    ctx.currentStep = 'delete-me';
    await http.del('/me', { body: { reason: 'changing providers' }, expectStatus: [200, 204] }).catch(async () => {
      // some servers don't accept body on DELETE — retry without
      await http.request({ method: 'DELETE', path: '/me', expectStatus: [200, 204] });
    });

    ctx.currentStep = 'admin-view-user';
    ctx.currentActor = 'AD1';
    const u = await http.get(`/admin/users/${ctx.actors.U3.userId}`, { expectStatus: 200 });
    assert.assert(u.body, 'admin can read deleted user');

    ctx.currentStep = 'account-recovery';
    const mfaCode = totpGenerate(ctx.actors.AD1.mfaSecret);
    await http.post(`/admin/users/${ctx.actors.U3.userId}/account-recovery`, {
      replacementDeviceId: ctx.fixtures.uuid(),
      replacementPlatform: 'ANDROID',
      replacementLabel: 'Replacement Phone',
      reason: 'lost device',
      mfaCode,
    }, { actor: 'AD1', allowStatus: [200, 201, 204, 400, 409, 422] });
  },
};
