// B-2 — Login as existing USER/AGENT with PIN.
import { registerUser } from './b01-register-user.mjs';

export async function loginPin(ctx, label, { newDeviceId = false } = {}) {
  const { http, log, assert } = ctx;
  const a = ctx.actors[label];
  assert.assert(a, `loginPin requires existing actor ${label}`);
  const deviceId = newDeviceId ? ctx.fixtures.uuid() : a.deviceId;
  log.block(`B-2 login ${label}`, { newDeviceId }, label);
  const r = await http.post('/auth/login', { phone: a.phone, pin: a.pin, deviceId }, {
    noAuth: true, allowStatus: [200, 201, 401, 403],
  });
  if (r.status === 403 && r.body?.code === 'DEVICE_BIND_REQUIRED') {
    return { needsDeviceBind: true, challengeToken: r.body.challengeToken, deviceId };
  }
  assert.assert([200, 201].includes(r.status), `login expected 200/201 got ${r.status}`, r.body);
  a.accessToken = r.body.accessToken;
  a.refreshToken = r.body.refreshToken;
  a.deviceId = deviceId;
  return { actor: a };
}

export { registerUser };
