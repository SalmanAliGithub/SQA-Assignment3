// F-3 — Device binding & revocation.
import { bindDevice } from './blocks/b03-device-bind.mjs';

export default {
  id: 'F-3',
  name: 'Device binding & revocation',
  dependsOn: ['F-2'],
  actors: ['U1'],
  endpoints: ['POST /auth/login', 'POST /auth/device/bind/verify', 'POST /auth/device/bind', 'DELETE /me/devices/{deviceId}'],
  async run(ctx) {
    const { http, assert } = ctx;
    const a = ctx.actors.U1;
    ctx.currentActor = 'U1';

    ctx.currentStep = 'login-new-device';
    const newDeviceId = ctx.fixtures.uuid();
    // Park SMS cursor BEFORE login so the device-bind OTP it emits is reachable.
    ctx.sms.resetCursor(a.phone);
    const r = await http.post('/auth/login', { phone: a.phone, pin: a.pin, deviceId: newDeviceId }, { noAuth: true, expectStatus: [403] });
    const challengeToken =
      r.body?.challengeToken ??
      r.body?.error?.details?.challengeToken ??
      r.body?.details?.challengeToken;
    assert.assert(challengeToken, 'login from new device must return challengeToken (DEVICE_BIND_REQUIRED)', r.body);

    ctx.currentStep = 'bind';
    await bindDevice(ctx, 'U1', { challengeToken, deviceId: newDeviceId, platform: 'IOS', deviceName: 'iPhone Test' });

    // Bind endpoint doesn't return tokens — login with the newly trusted device.
    const reli = await http.post('/auth/login', { phone: a.phone, pin: a.pin, deviceId: newDeviceId }, { noAuth: true, expectStatus: [200, 201] });
    a.accessToken = reli.body.accessToken;
    a.refreshToken = reli.body.refreshToken;
    a.deviceId = newDeviceId;

    ctx.currentStep = 'list-devices';
    const devs = await http.get('/me/devices', { expectStatus: 200 });
    const list = Array.isArray(devs.body) ? devs.body : devs.body?.items || devs.body?.data || [];
    assert.assert(list.length >= 2, 'after binding a 2nd device, /me/devices should show >= 2', list);

    ctx.currentStep = 'revoke-other';
    const other = list.find(d => (d.deviceId || d.device_uuid) && (d.deviceId || d.device_uuid) !== a.deviceId)
                  || list.find(d => d.id && !d.isCurrent && d.deviceId !== a.deviceId);
    assert.assert(other?.id, 'must find a non-current device to revoke', list);
    const del = await http.del(`/me/devices/${other.id}`, { expectStatus: [200, 204] });
    assert.assert([200, 204].includes(del.status), 'device revoke must succeed');

    // Re-login to ensure a fresh token after device changes
    const li = await http.post('/auth/login', { phone: a.phone, pin: a.pin, deviceId: a.deviceId }, { noAuth: true, allowStatus: [200, 201, 403] });
    if (li.status === 200 || li.status === 201) {
      a.accessToken = li.body.accessToken;
      a.refreshToken = li.body.refreshToken;
    }
  },
};
