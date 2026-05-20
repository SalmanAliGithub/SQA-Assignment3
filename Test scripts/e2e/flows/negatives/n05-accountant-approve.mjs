export default {
  id: 'N-5', name: 'ACCOUNTANT calls POST /admin/adjustments/{id}/approve → 403 (IR-3)',
  dependsOn: ['F-8'], actors: ['AC1'],
  endpoints: ['POST /admin/adjustments/{id}/approve'],
  async run(ctx) {
    if (!ctx.actors.AC1?.accessToken) { ctx.log.warn('AC1 has no token — skipping'); return; }
    const id = ctx.fixtures.adjustmentId || ctx.fixtures.uuid();
    const r = await ctx.http.post(`/admin/adjustments/${id}/approve`, { note: 'self' }, { actor: 'AC1', allowStatus: [401, 403, 404] });
    ctx.assert.assert([401, 403, 404].includes(r.status), 'IR-3 must block accountant', r.body);
  },
};
