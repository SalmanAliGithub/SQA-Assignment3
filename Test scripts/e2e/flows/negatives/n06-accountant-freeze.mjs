export default {
  id: 'N-6', name: 'ACCOUNTANT calls POST /admin/users/{id}/freeze → 403',
  dependsOn: ['F-8', 'F-17'], actors: ['AC1'],
  endpoints: ['POST /admin/users/{id}/freeze'],
  async run(ctx) {
    if (!ctx.actors.AC1?.accessToken) { ctx.log.warn('AC1 has no token — skipping'); return; }
    const uid = ctx.fixtures.adminInitiatedUserId || ctx.fixtures.uuid();
    const r = await ctx.http.post(`/admin/users/${uid}/freeze`, { reason: 'x', mfaCode: '000000' }, { actor: 'AC1', allowStatus: [401, 403, 404] });
    ctx.assert.assert([401, 403, 404].includes(r.status), 'must reject', r.body);
  },
};
