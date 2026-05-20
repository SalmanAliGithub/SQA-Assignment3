export default {
  id: 'N-1', name: 'USER calls POST /admin/users → 403', dependsOn: ['F-1'], actors: ['U1'],
  endpoints: ['POST /admin/users'],
  async run(ctx) {
    const r = await ctx.http.post('/admin/users', { phoneNumber: '+251000000000', fullName: 'X', initialKycTier: 'TIER_0' }, { actor: 'U1', allowStatus: [401, 403] });
    ctx.assert.assert(r.status === 403 || r.status === 401, 'expected 401/403', r.body);
  },
};
