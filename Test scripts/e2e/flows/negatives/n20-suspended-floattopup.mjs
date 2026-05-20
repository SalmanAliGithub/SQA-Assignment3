import { totpGenerate } from '../../lib/totp.mjs';

export default {
  id: 'N-20', name: 'Float top-up for SUSPENDED agent → 409',
  dependsOn: ['F-9'], actors: ['AD1', 'AG1'],
  endpoints: ['POST /admin/agents/{id}/float-topup'],
  async run(ctx) {
    const mfa = () => totpGenerate(ctx.actors.AD1.mfaSecret);
    await ctx.http.post(`/admin/agents/${ctx.actors.AG1.agentId}/suspend`, { reason: 'N-20' }, { actor: 'AD1', allowStatus: [200, 201, 204, 409] });
    const r = await ctx.http.post(`/admin/agents/${ctx.actors.AG1.agentId}/float-topup`, { amount: '100.00' }, {
      actor: 'AD1', expectStatus: [409, 422],
    });
    ctx.assert.assert([409, 422].includes(r.status), 'suspended float-topup must be rejected', r.body);
    await ctx.http.post(`/admin/agents/${ctx.actors.AG1.agentId}/reactivate`, {}, { actor: 'AD1', allowStatus: [200, 201, 204] });
  },
};
