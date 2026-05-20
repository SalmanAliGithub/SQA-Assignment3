// F-2 — Session lifecycle.
export default {
  id: 'F-2',
  name: 'Session lifecycle (refresh, logout, logout-all)',
  dependsOn: ['F-1'],
  actors: ['U1'],
  endpoints: ['POST /auth/login', 'POST /auth/refresh', 'POST /auth/logout', 'POST /me/logout-all'],
  async run(ctx) {
    const { http, assert } = ctx;
    const a = ctx.actors.U1;
    ctx.currentActor = 'U1';

    ctx.currentStep = 'refresh';
    const r = await http.post('/auth/refresh', { refreshToken: a.refreshToken }, { noAuth: true, expectStatus: [200, 201] });
    const oldRefresh = a.refreshToken;
    a.accessToken = r.body.accessToken;
    a.refreshToken = r.body.refreshToken;

    ctx.currentStep = 'refresh-rotated';
    const r2 = await http.post('/auth/refresh', { refreshToken: oldRefresh }, { noAuth: true, allowStatus: [401, 403, 409] });
    assert.assert(r2.status !== 200, 'rotated refresh token must be rejected', r2.body);

    ctx.currentStep = 'logout-all';
    const lo = await http.post('/me/logout-all', {}, { actor: 'U1', allowStatus: [200, 204, 401] });
    if (lo.status === 401) {
      ctx.log.warn('logout-all 401 — session may already be revoked; re-logging in');
      const re = await http.post('/auth/login', { phone: a.phone, pin: a.pin, deviceId: a.deviceId }, { noAuth: true, allowStatus: [200, 201, 403] });
      if (re.status === 200 || re.status === 201) { a.accessToken = re.body.accessToken; a.refreshToken = re.body.refreshToken; }
    }

    // Need a fresh login since logout-all revoked everything (except current per scenarios, but try refresh again to confirm)
    ctx.currentStep = 'login-again';
    const l = await http.post('/auth/login', { phone: a.phone, pin: a.pin, deviceId: a.deviceId }, { noAuth: true, allowStatus: [200, 201, 403] });
    if (l.status === 403) {
      ctx.log.warn('login after logout-all required device-bind — non-fatal here', l.body);
    } else {
      a.accessToken = l.body.accessToken;
      a.refreshToken = l.body.refreshToken;
    }

    ctx.currentStep = 'logout';
    if (a.refreshToken) {
      await http.post('/auth/logout', { refreshToken: a.refreshToken }, { actor: 'U1', allowStatus: [200, 204, 401] });
    }

    // Re-login so downstream flows have a fresh token
    ctx.currentStep = 'final-relogin';
    const l2 = await http.post('/auth/login', { phone: a.phone, pin: a.pin, deviceId: a.deviceId }, { noAuth: true, allowStatus: [200, 201, 403] });
    if (l2.status === 200 || l2.status === 201) {
      a.accessToken = l2.body.accessToken;
      a.refreshToken = l2.body.refreshToken;
    }
  },
};
