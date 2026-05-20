export default {
  id: 'N-2', name: 'USER calls POST /cico/cash-in → 403', dependsOn: ['F-1'], actors: ['U1'],
  endpoints: ['POST /cico/cash-in'],
  async run(ctx) {
    const r = await ctx.http.post('/cico/cash-in', { customerPhone: '+251000000001', amount: '10.00' }, { actor: 'U1', allowStatus: [401, 403] });
    ctx.assert.assert([401, 403].includes(r.status), 'expected 401/403', r.body);
  },
};
