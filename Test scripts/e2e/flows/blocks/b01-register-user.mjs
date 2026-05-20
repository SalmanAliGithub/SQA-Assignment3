// B-1 — Register a fresh USER (or AGENT pre-onboarded by admin).
// Endpoints: POST /auth/register/{request-otp,verify-otp,complete}.

export async function registerUser(ctx, { label, phone, pin = '1234', firstName = 'Test', lastName = 'User', platform = 'ANDROID' }) {
  const { http, sms, log, assert } = ctx;
  const deviceId = ctx.fixtures.uuid();
  log.block(`B-1 registerUser ${label} ${phone}`, null, label);

  sms.resetCursor(phone);

  // 1. Request OTP
  const r1 = await http.post('/auth/register/request-otp', { phone }, { noAuth: true, expectStatus: [200, 201] });
  const challengeToken = r1.body?.challengeToken;
  assert.assert(challengeToken, 'register/request-otp must return challengeToken', r1.body);

  // 2. Extract OTP from stub log
  const otp = await sms.waitForOtp(phone);

  // 3. Verify
  const r2 = await http.post('/auth/register/verify-otp', { challengeToken, otp }, { noAuth: true, expectStatus: [200, 201] });
  const setupToken = r2.body?.setupToken;
  assert.assert(setupToken, 'register/verify-otp must return setupToken', r2.body);

  // 4. Complete
  const r3 = await http.post('/auth/register/complete', {
    setupToken,
    pin,
    deviceId,
    platform,
    deviceName: `${label}-Test`,
    firstName,
    lastName,
  }, { noAuth: true, expectStatus: [200, 201] });

  const { accessToken, refreshToken, user } = r3.body || {};
  assert.assert(accessToken && refreshToken && user?.id, 'register/complete must return tokens + user', r3.body);

  const actor = {
    label, phone, pin, deviceId, firstName, lastName,
    accessToken, refreshToken,
    userId: user.id,
    role: user.role || 'USER',
  };
  ctx.actors[label] = actor;
  log.info(`registered ${label}=${user.id} (${phone})`, null, label);
  return actor;
}
