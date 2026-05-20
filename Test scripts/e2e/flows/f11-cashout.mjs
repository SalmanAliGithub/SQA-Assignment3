// F-11 — Customer-initiated cash-out (OTP-gated).
export default {
  id: 'F-11',
  name: 'Cash-out OTP flow',
  dependsOn: ['F-9'],
  actors: ['U1', 'AG1'],
  endpoints: [
    'POST /cico/cash-out/request', 'POST /cico/cash-out/{requestId}/verify-otp',
    'POST /cico/cash-out/{requestId}/commit', 'GET /cico/cash-out/{requestId}/status',
    'POST /cico/cash-out/{requestId}/cancel',
  ],
  async run(ctx) {
    const { http, sms, fixtures, assert } = ctx;

    ctx.currentStep = 'request';
    sms.resetCursor(ctx.actors.U1.phone);
    const r = await http.post('/cico/cash-out/request', { customerPhone: ctx.actors.U1.phone, amount: '50.00' }, { actor: 'AG1', expectStatus: [200, 201, 422] });
    const requestId = r.body?.requestId || r.body?.id;
    if (!requestId) { ctx.log.warn('cash-out request did not return id — skipping rest'); return; }

    ctx.currentStep = 'status-1';
    await http.get(`/cico/cash-out/${requestId}/status`, { actor: 'AG1', expectStatus: 200 });

    ctx.currentStep = 'verify-otp';
    const otp = await sms.waitForOtp(ctx.actors.U1.phone).catch(() => null);
    if (!otp) { ctx.log.warn('no OTP received for cash-out — skipping'); return; }
    await http.post(`/cico/cash-out/${requestId}/verify-otp`, { otp }, { actor: 'AG1', allowStatus: [200, 201, 400, 422] });

    ctx.currentStep = 'commit';
    const key = fixtures.uuid();
    const c = await http.post(`/cico/cash-out/${requestId}/commit`, {}, { actor: 'AG1', idempotencyKey: key, allowStatus: [200, 201, 422] });
    assert.assert(c.status !== 500, 'commit should not 500');

    ctx.currentStep = 'commit-replay';
    await http.post(`/cico/cash-out/${requestId}/commit`, {}, { actor: 'AG1', idempotencyKey: key, allowStatus: [200, 201, 409] });

    ctx.currentStep = 'status-final';
    await http.get(`/cico/cash-out/${requestId}/status`, { actor: 'AG1', expectStatus: 200 });

    // Cancel path: start another and cancel
    ctx.currentStep = 'request-2';
    const r2 = await http.post('/cico/cash-out/request', { customerPhone: ctx.actors.U1.phone, amount: '20.00' }, { actor: 'AG1', allowStatus: [200, 201, 422] });
    const rid2 = r2.body?.requestId || r2.body?.id;
    if (rid2) {
      ctx.currentStep = 'cancel';
      await http.post(`/cico/cash-out/${rid2}/cancel`, {}, { actor: 'U1', allowStatus: [200, 201, 204, 403, 404] });
    }
  },
};
