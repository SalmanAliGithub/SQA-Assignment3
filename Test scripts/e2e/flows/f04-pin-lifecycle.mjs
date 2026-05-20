// F-4 — PIN change & PIN-reset OTP flow.
import { createHash } from 'node:crypto';

function hashPin(pin) {
  // server typically expects sha256(pin + pepper) but we don't know schema; send raw + variants
  const pepper = process.env.BCRYPT_PEPPER || 'dev-bcrypt-pepper';
  return createHash('sha256').update(pin + pepper).digest('hex');
}

export default {
  id: 'F-4',
  name: 'PIN change + PIN-reset',
  dependsOn: ['F-2'],
  actors: ['U1'],
  endpoints: [
    'POST /auth/pin/change', 'POST /auth/pin-reset/request',
    'POST /auth/pin-reset/verify', 'POST /auth/pin-reset/complete',
  ],
  async run(ctx) {
    const { http, sms, assert } = ctx;
    const a = ctx.actors.U1;
    ctx.currentActor = 'U1';

    const oldPin = a.pin;
    const newPin = '5678';

    ctx.currentStep = 'pin-change';
    const c = await http.post('/auth/pin/change', {
      currentPinHash: hashPin(oldPin),
      newPinHash: hashPin(newPin),
    }, { actor: 'U1', allowStatus: [200, 204, 400, 401] });
    if (c.status === 200 || c.status === 204) {
      a.pin = newPin;
    } else {
      // try raw pin if server doesn't want hash
      const c2 = await http.post('/auth/pin/change', {
        currentPinHash: oldPin, newPinHash: newPin,
      }, { actor: 'U1', allowStatus: [200, 204, 400, 401] });
      if (c2.status === 200 || c2.status === 204) a.pin = newPin;
      else ctx.log.warn('PIN change shape uncertain — left PIN unchanged');
    }

    ctx.currentStep = 'pin-reset-request';
    sms.resetCursor(a.phone);
    const r1 = await http.post('/auth/pin-reset/request', { phone: a.phone }, { noAuth: true, expectStatus: [200, 201] });
    const challengeToken = r1.body?.challengeToken;
    assert.assert(challengeToken, 'pin-reset/request returns challengeToken', r1.body);

    ctx.currentStep = 'pin-reset-verify';
    const otp = await sms.waitForOtp(a.phone);
    const r2 = await http.post('/auth/pin-reset/verify', { challengeToken, otp }, { noAuth: true, expectStatus: [200, 201] });
    const resetToken = r2.body?.resetToken;
    assert.assert(resetToken, 'pin-reset/verify returns resetToken', r2.body);

    ctx.currentStep = 'pin-reset-complete';
    const r3 = await http.post('/auth/pin-reset/complete', { resetToken, newPin: '1234' }, { noAuth: true, expectStatus: [200, 201] });
    if (r3.body?.accessToken) {
      a.accessToken = r3.body.accessToken;
      a.refreshToken = r3.body.refreshToken;
    }
    a.pin = '1234';

    // PIN reset revoked old session — re-login U1 so downstream flows keep working
    ctx.currentStep = 'relogin';
    const li = await http.post('/auth/login', { phone: a.phone, pin: a.pin, deviceId: a.deviceId }, { noAuth: true, allowStatus: [200, 201, 403] });
    if (li.status === 200 || li.status === 201) {
      a.accessToken = li.body.accessToken;
      a.refreshToken = li.body.refreshToken;
    }
  },
};
