import { totpGenerate } from '../../lib/totp.mjs';
export default {
  id: 'N-18', name: 'Re-reverse already-reversed tx → 409',
  dependsOn: ['F-18'], actors: ['AD1'],
  endpoints: ['POST /admin/transactions/{id}/reverse'],
  async run(ctx) {
    const id = ctx.fixtures.reversedTxId;
    if (!id) { ctx.log.warn('no reversed tx — skipping'); return; }
    const r = await ctx.http.post(`/admin/transactions/${id}/reverse`, {
      reason: 'double reverse attempt during e2e', mfaCode: totpGenerate(ctx.actors.AD1.mfaSecret),
    }, { actor: 'AD1', allowStatus: [200, 201, 204, 409, 422] });
    ctx.assert.assert(r.status === 409 || r.status === 422, 'double-reverse must be rejected', r.body);
  },
};
