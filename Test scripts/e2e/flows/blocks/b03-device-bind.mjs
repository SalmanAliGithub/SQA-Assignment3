// B-3 — Bind a new device after a login challenge.

export async function bindDevice(ctx, label, { challengeToken, deviceId, platform = 'IOS', deviceName = 'NewDevice' }) {
  const { http, sms, log, assert } = ctx;
  const a = ctx.actors[label];
  assert.assert(a, `bindDevice requires existing actor ${label}`);
  log.block(`B-3 deviceBind ${label}`, null, label);

  // NOTE: caller MUST call sms.resetCursor(a.phone) BEFORE the login that emits
  // the OTP. Doing it here would discard the message we need to read.
  const otp = await sms.waitForOtp(a.phone);

  const v = await http.post('/auth/device/bind/verify', { challengeToken, otp }, { noAuth: true, expectStatus: [200, 201] });
  const setupToken = v.body?.setupToken;
  assert.assert(setupToken, 'device/bind/verify must return setupToken', v.body);

  const b = await http.post('/auth/device/bind', {
    setupToken, deviceId, platform, deviceName,
  }, { noAuth: true, expectStatus: [200, 201] });
  a.accessToken = b.body.accessToken;
  a.refreshToken = b.body.refreshToken;
  a.deviceId = deviceId;
  return a;
}
