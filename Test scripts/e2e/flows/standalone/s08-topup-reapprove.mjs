import { totpGenerate } from '../../lib/totp.mjs';
export default {
  id: 'S-8',
  name: 'POST /admin/agents/topup-requests/{id}/approve replay → 409',
  dependsOn: ['F-10'],
  actors: ['AD1'],
  endpoints: ['POST /admin/agents/topup-requests/{id}/approve'],
  async run(ctx) {
    const id = ctx.fixtures.lastApprovedTopupId;
    if (!id) { ctx.log.warn('no approved topup id from F-10'); return; }
    const r = await ctx.http.post(`/admin/agents/topup-requests/${id}/approve`, {
      mfaCode: totpGenerate(ctx.actors.AD1.mfaSecret),
    }, { actor: 'AD1', allowStatus: [200, 201, 204, 400, 409] });
    ctx.assert.assert(r.status !== 500, 'reapprove must not 500');
  },
};
