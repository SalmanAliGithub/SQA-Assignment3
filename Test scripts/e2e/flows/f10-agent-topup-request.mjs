// F-10 — Agent-initiated float top-up request lifecycle.
import { totpGenerate } from '../lib/totp.mjs';

export default {
  id: 'F-10',
  name: 'Agent top-up request',
  dependsOn: ['F-9'],
  actors: ['AG1', 'AD1'],
  endpoints: [
    'POST /me/agent/topup-requests', 'GET /me/agent/topup-requests',
    'GET /admin/agents/topup-requests',
    'POST /admin/agents/topup-requests/{id}/approve',
    'POST /admin/agents/topup-requests/{id}/reject',
  ],
  async run(ctx) {
    const { http } = ctx;
    const mfa = () => totpGenerate(ctx.actors.AD1.mfaSecret);

    ctx.currentStep = 'create';
    const c = await http.post('/me/agent/topup-requests', { amount: '5000.00', notes: 'daily cash run' }, { actor: 'AG1', allowStatus: [200, 201, 422] });
    const id1 = c.body?.id;

    ctx.currentStep = 'list-mine';
    await http.get('/me/agent/topup-requests', { actor: 'AG1', expectStatus: 200 });
    ctx.currentStep = 'list-admin';
    await http.get('/admin/agents/topup-requests', { actor: 'AD1', query: { status: 'PENDING' }, expectStatus: 200 });

    if (id1) {
      ctx.currentStep = 'approve';
      await http.post(`/admin/agents/topup-requests/${id1}/approve`, { mfaCode: mfa() }, { actor: 'AD1', allowStatus: [200, 201, 204, 422] });
      ctx.fixtures.lastApprovedTopupId = id1;
    }

    // Second request, reject path
    const c2 = await http.post('/me/agent/topup-requests', { amount: '1000.00' }, { actor: 'AG1', allowStatus: [200, 201, 422] });
    const id2 = c2.body?.id;
    if (id2) {
      ctx.currentStep = 'reject';
      await http.post(`/admin/agents/topup-requests/${id2}/reject`, { reason: 'low priority', mfaCode: mfa() }, { actor: 'AD1', allowStatus: [200, 201, 204, 422] });
    }
  },
};
