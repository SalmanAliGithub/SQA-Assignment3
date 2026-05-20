export default {
  id: 'N-10', name: 'Suspended AGENT calls POST /cico/cash-in → 403',
  dependsOn: ['F-9'], actors: ['AD1', 'AG1'],
  endpoints: ['POST /admin/agents/{id}/suspend', 'POST /cico/cash-in'],
  async run(ctx) {
    await ctx.http.post(`/admin/agents/${ctx.actors.AG1.agentId}/suspend`, { reason: 'N-10' }, { actor: 'AD1', allowStatus: [200, 201, 204, 409] });
    const r = await ctx.http.post('/cico/cash-in', { customerPhone: ctx.actors.U1.phone, amount: '1.00' }, { actor: 'AG1', allowStatus: [200, 201, 401, 403, 422] });
    ctx.assert.assert(r.status !== 200 && r.status !== 201, 'suspended agent cash-in should not succeed', r.body);
    await ctx.http.post(`/admin/agents/${ctx.actors.AG1.agentId}/reactivate`, {}, { actor: 'AD1', allowStatus: [200, 201, 204] });
  },
};
