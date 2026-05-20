export default {
  id: 'N-3', name: 'AGENT calls POST /transfers → 403', dependsOn: ['F-9'], actors: ['AG1'],
  endpoints: ['POST /transfers'],
  async run(ctx) {
    const r = await ctx.http.post('/transfers', { recipientPhone: '+251911000099', amount: '5.00' }, { actor: 'AG1', allowStatus: [401, 403] });
    ctx.assert.assert([401, 403].includes(r.status), 'expected 401/403', r.body);
  },
};
