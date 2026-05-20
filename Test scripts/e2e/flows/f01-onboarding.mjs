// F-1 — End-user onboarding & wallet first-look.
import { registerUser } from './blocks/b01-register-user.mjs';

export default {
  id: 'F-1',
  name: 'User onboarding + wallet first-look',
  dependsOn: ['F-26a'],
  actors: ['U1'],
  endpoints: [
    'POST /auth/register/request-otp',
    'POST /auth/register/verify-otp',
    'POST /auth/register/complete',
    'GET /me', 'GET /auth/me', 'GET /session/validate',
    'GET /me/wallet', 'GET /me/kyc', 'GET /me/preferences',
    'GET /me/devices', 'GET /me/notifications',
  ],
  async run(ctx) {
    const { http, assert, fixtures } = ctx;
    const phone = fixtures.nextPhone('U1');

    ctx.currentStep = 'register';
    await registerUser(ctx, { label: 'U1', phone, firstName: 'Hanna', lastName: 'Tesema' });
    ctx.currentActor = 'U1';

    ctx.currentStep = 'me';
    const me = await http.get('/me', { expectStatus: 200 });
    assert.assert(me.body?.userId || me.body?.id, '/me must return userId or id', me.body);

    ctx.currentStep = 'auth-me';
    await http.get('/auth/me', { expectStatus: 200 });

    ctx.currentStep = 'session-validate';
    await http.get('/session/validate', { expectStatus: 200 });

    ctx.currentStep = 'wallet';
    const w = await http.get('/me/wallet', { expectStatus: 200 });
    assert.assert(w.body, 'wallet body present');

    ctx.currentStep = 'kyc';
    await http.get('/me/kyc', { expectStatus: 200 });

    ctx.currentStep = 'preferences';
    await http.get('/me/preferences', { expectStatus: 200 });

    ctx.currentStep = 'devices';
    const devs = await http.get('/me/devices', { expectStatus: 200 });
    const list = Array.isArray(devs.body) ? devs.body : devs.body?.items || devs.body?.data || [];
    assert.assert(list.length >= 1, 'at least one device after register', devs.body);

    ctx.currentStep = 'notifications';
    await http.get('/me/notifications', { expectStatus: 200 });
  },
};
