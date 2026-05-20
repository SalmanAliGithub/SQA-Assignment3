// F-17 — Admin user management: admin-initiated reg, freeze/unfreeze, wallet inspect, reset-pin, recovery.
import { totpGenerate } from '../lib/totp.mjs';

export default {
  id: 'F-17',
  name: 'Admin user management',
  dependsOn: ['F-7'],
  actors: ['AD1'],
  endpoints: [
    'POST /admin/users', 'POST /admin/users/{id}/verify-otp',
    'GET /admin/users', 'GET /admin/users/{id}', 'GET /admin/users/{userId}/wallet',
    'POST /admin/users/{id}/freeze', 'POST /admin/users/{id}/unfreeze',
    'POST /admin/users/{id}/reset-pin', 'POST /admin/users/{id}/account-recovery',
  ],
  async run(ctx) {
    const { http, sms, assert, fixtures } = ctx;
    const phone = fixtures.nextPhone('AdminInitiated');
    ctx.currentActor = 'AD1';

    ctx.currentStep = 'create';
    sms.resetCursor(phone);
    const c = await http.post('/admin/users', {
      phoneNumber: phone, fullName: 'Test User', initialKycTier: 'TIER_0', note: 'F-17 fixture',
    }, { expectStatus: [200, 201] });
    const uid = c.body?.id || c.body?.userId;
    assert.assert(uid, 'admin/users must return id', c.body);
    ctx.fixtures.adminInitiatedUserId = uid;
    ctx.fixtures.adminInitiatedPhone = phone;

    ctx.currentStep = 'verify-otp';
    const otp = await sms.waitForOtp(phone);
    await http.post(`/admin/users/${uid}/verify-otp`, { otp }, { allowStatus: [200, 201, 204] });

    ctx.currentStep = 'list';
    await http.get('/admin/users', { query: { status: 'Active', q: 'Test' }, allowStatus: [200, 400] });

    ctx.currentStep = 'detail';
    await http.get(`/admin/users/${uid}`, { expectStatus: 200 });

    ctx.currentStep = 'wallet';
    await http.get(`/admin/users/${uid}/wallet`, { allowStatus: [200, 404] });

    const mfa = () => totpGenerate(ctx.actors.AD1.mfaSecret);

    ctx.currentStep = 'freeze';
    await http.post(`/admin/users/${uid}/freeze`, { reason: 'suspicious', mfaCode: mfa() }, { allowStatus: [200, 201, 204, 422] });

    ctx.currentStep = 'unfreeze';
    await http.post(`/admin/users/${uid}/unfreeze`, { reason: 'cleared', mfaCode: mfa() }, { allowStatus: [200, 201, 204, 422] });

    ctx.currentStep = 'reset-pin';
    await http.post(`/admin/users/${uid}/reset-pin`, { reason: 'user lost PIN' }, { allowStatus: [200, 201, 204] });

    ctx.currentStep = 'recovery';
    await http.post(`/admin/users/${uid}/account-recovery`, {
      replacementDeviceId: ctx.fixtures.uuid(),
      replacementPlatform: 'ANDROID',
      reason: 'lost',
      mfaCode: mfa(),
    }, { allowStatus: [200, 201, 204, 400, 422] });
  },
};
