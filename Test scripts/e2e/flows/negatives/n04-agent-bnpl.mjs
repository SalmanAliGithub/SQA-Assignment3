export default {
  id: 'N-4', name: 'AGENT calls POST /bnpl/applications → 403', dependsOn: ['F-9'], actors: ['AG1'],
  endpoints: ['POST /bnpl/applications'],
  async run(ctx) {
    const r = await ctx.http.post('/bnpl/applications', { productId: 1, requestedAmount: '100.00', consents: {}, consentVersion: 'v1' }, { actor: 'AG1', allowStatus: [401, 403] });
    ctx.assert.assert([401, 403].includes(r.status), 'expected 401/403', r.body);
  },
};
