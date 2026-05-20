// F-21 — Commission rules lifecycle.
import { totpGenerate } from '../lib/totp.mjs';

export default {
  id: 'F-21',
  name: 'Commission rules lifecycle',
  dependsOn: ['F-7', 'F-9'],
  actors: ['AD1', 'AG1'],
  endpoints: [
    'GET /admin/commission-rules', 'POST /admin/commission-rules',
    'PATCH /admin/commission-rules/{id}', 'POST /admin/commission-rules/{id}/retire',
    'GET /me/agent/commission-rules',
  ],
  async run(ctx) {
    const { http } = ctx;
    const mfa = () => totpGenerate(ctx.actors.AD1.mfaSecret);
    ctx.currentActor = 'AD1';

    ctx.currentStep = 'list';
    await http.get('/admin/commission-rules', { expectStatus: 200 });

    ctx.currentStep = 'create';
    const c = await http.post('/admin/commission-rules', {
      name: 'Test Rule',
      agentTier: 'TIER_1',
      txType: 'CICO_IN',
      percentageRate: '0.0050',
      fixedFee: '1.00',
      mfaCode: mfa(),
    }, { expectStatus: [200, 201] });
    const id = c.body?.id;
    ctx.assert.assert(id, 'commission rule create must return id', c.body);

    ctx.currentStep = 'patch';
    await http.patch(`/admin/commission-rules/${id}`, { percentageRate: '0.0060', mfaCode: mfa() }, { expectStatus: [200, 201, 204] });
    ctx.currentStep = 'retire';
    await http.post(`/admin/commission-rules/${id}/retire`, { mfaCode: mfa() }, { expectStatus: [200, 201, 204] });

    ctx.currentStep = 'agent-view';
    await http.get('/me/agent/commission-rules', { actor: 'AG1', expectStatus: 200 });
  },
};
