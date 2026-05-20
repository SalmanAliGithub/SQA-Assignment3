// F-19 — Risk flag lifecycle + rescore. Uses a throwaway target to avoid freezing U1.
import { registerUser } from './blocks/b01-register-user.mjs';

export default {
  id: 'F-19',
  name: 'Risk flag lifecycle',
  dependsOn: ['F-7'],
  actors: ['AD1', 'U_RISK'],
  endpoints: [
    'GET /admin/risk/flags', 'POST /admin/risk/flags', 'GET /admin/risk/flags/{id}',
    'POST /admin/risk/flags/{id}/decide',
    'GET /admin/risk/scores/{userId}', 'POST /admin/risk/scores/{userId}/rescore',
  ],
  async run(ctx) {
    const { http, fixtures } = ctx;
    ctx.currentStep = 'spawn-target';
    await registerUser(ctx, { label: 'U_RISK', phone: fixtures.nextPhone('URisk'), firstName: 'Risk', lastName: 'Test' });
    const targetId = ctx.actors.U_RISK.userId;

    ctx.currentStep = 'create-flag';
    const c = await http.post('/admin/risk/flags', { userId: targetId, severity: 'WARNING', reason: 'manual review' }, { actor: 'AD1', allowStatus: [200, 201, 422] });
    const flagId = c.body?.id;

    ctx.currentStep = 'list-flags';
    await http.get('/admin/risk/flags', { actor: 'AD1', query: { status: 'OPEN', severity: 'WARNING' }, expectStatus: 200 });

    if (flagId) {
      ctx.currentStep = 'detail';
      await http.get(`/admin/risk/flags/${flagId}`, { actor: 'AD1', allowStatus: [200, 404] });
      ctx.currentStep = 'decide';
      await http.post(`/admin/risk/flags/${flagId}/decide`, { decision: 'OVERRIDE', reason: 'false positive' }, { actor: 'AD1', allowStatus: [200, 201, 204, 422] });
    }

    ctx.currentStep = 'score';
    await http.get(`/admin/risk/scores/${targetId}`, { actor: 'AD1', allowStatus: [200, 404] });

    ctx.currentStep = 'rescore';
    await http.post(`/admin/risk/scores/${targetId}/rescore`, {}, { actor: 'AD1', allowStatus: [200, 201, 202, 204] });
  },
};
