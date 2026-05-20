// F-14 — Transfer limits enforcement at T1 (before F-6 promotes to T2).
export default {
  id: 'F-14',
  name: 'Transfer limit enforcement',
  dependsOn: ['F-12'],
  actors: ['U1'],
  endpoints: ['POST /transfers'],
  async run(ctx) {
    const { http, assert } = ctx;
    ctx.currentStep = 'over-tier1-limit';
    const r = await http.post('/transfers', { recipientPhone: ctx.actors.U2.phone, amount: '15000.00' }, {
      actor: 'U1', allowStatus: [400, 401, 403, 422],
    });
    assert.assert(r.status >= 400, 'over-T1 transfer should fail', r.body);

    ctx.currentStep = 'over-balance';
    const r2 = await http.post('/transfers', { recipientPhone: ctx.actors.U2.phone, amount: '999999.00' }, {
      actor: 'U1', allowStatus: [400, 401, 403, 422],
    });
    assert.assert(r2.status >= 400, 'over-balance transfer should fail', r2.body);
  },
};
