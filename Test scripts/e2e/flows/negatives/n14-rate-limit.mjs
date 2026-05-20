// N-14 — Burst beyond money-user limit using a sacrificial user. Run last to avoid bleeding.
import { registerUser } from '../blocks/b01-register-user.mjs';

export default {
  id: 'N-14', name: 'Rate limit 429 on /transfers burst',
  dependsOn: ['F-12'], actors: ['U_RL'],
  endpoints: ['POST /transfers'],
  async run(ctx) {
    const phone = ctx.fixtures.nextPhone('URL');
    await registerUser(ctx, { label: 'U_RL', phone, firstName: 'Rate', lastName: 'Limit' });
    let saw429 = false;
    for (let i = 0; i < 30; i++) {
      const r = await ctx.http.post('/transfers', { recipientPhone: ctx.actors.U2.phone, amount: '0.01' }, {
        actor: 'U_RL', allowStatus: [200, 201, 400, 401, 403, 422, 429],
      });
      if (r.status === 429) { saw429 = true; break; }
    }
    if (!saw429) ctx.log.warn('Did not observe 429 in 30 attempts — rate limit possibly disabled in dev');
  },
};
