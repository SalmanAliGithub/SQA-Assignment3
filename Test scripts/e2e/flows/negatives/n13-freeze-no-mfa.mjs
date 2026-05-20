export default {
  id: 'N-13', name: 'POST /admin/users/{id}/freeze without mfaCode → 401/422',
  dependsOn: ['F-17'], actors: ['AD1'],
  endpoints: ['POST /admin/users/{id}/freeze'],
  async run(ctx) {
    const uid = ctx.fixtures.adminInitiatedUserId || ctx.fixtures.uuid();
    const r = await ctx.http.post(`/admin/users/${uid}/freeze`, { reason: 'no-mfa' }, { actor: 'AD1', allowStatus: [400, 401, 403, 422] });
    ctx.assert.assert([400, 401, 422].includes(r.status), 'missing mfa must be rejected', r.body);
  },
};
