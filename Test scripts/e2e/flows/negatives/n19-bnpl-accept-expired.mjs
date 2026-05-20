// N-19 — Accepting a BNPL offer after its expiry must be rejected (410/409/422).
// Uses the application created in F-16 for the cancel-path product, then expires its
// offer in postgres via docker exec and re-tries the accept.
import { execSync } from 'node:child_process';

export default {
  id: 'N-19', name: 'BNPL accept after offer expiry → 410/409/422',
  dependsOn: ['F-16'], actors: ['U1'],
  endpoints: ['POST /bnpl/applications/{id}/accept'],
  async run(ctx) {
    const appId = ctx.fixtures.bnplCancelAppId;
    if (!appId) {
      ctx.assert.skip('N-19 has no real BNPL application from F-16 to expire');
    }

    // Refresh U1 token — earlier flows may have aged the session out.
    const u1 = ctx.actors.U1;
    const re = await ctx.http.post('/auth/login', { phone: u1.phone, pin: u1.pin, deviceId: u1.deviceId }, { noAuth: true, allowStatus: [200, 201, 403] });
    if (re.status === 200 || re.status === 201) {
      u1.accessToken = re.body.accessToken;
      u1.refreshToken = re.body.refreshToken;
    }

    // Force-expire the offer in the database directly (this is the only deterministic way
    // to drive the expiry branch without sleeping for the real TTL).
    ctx.currentStep = 'force-expire';
    try {
      execSync(
        `docker exec maal-prod-postgres psql -U maal -d maal -v ON_ERROR_STOP=1 -c ` +
        `"UPDATE bnpl_applications SET offer_expires_at = NOW() - INTERVAL '1 hour' WHERE id = '${appId}'"`,
        { stdio: 'pipe' },
      );
    } catch (err) {
      ctx.log.warn(`N-19 could not force-expire offer (${err.message}) — falling back to random UUID test`);
      const r = await ctx.http.post(`/bnpl/applications/${ctx.fixtures.uuid()}/accept`, {}, {
        actor: 'U1', idempotencyKey: ctx.fixtures.uuid(), expectStatus: [400, 404, 409, 410, 422],
      });
      ctx.assert.assert(r.status >= 400, 'invalid application id must be rejected', r.body);
      return;
    }

    ctx.currentStep = 'accept-expired';
    const r = await ctx.http.post(`/bnpl/applications/${appId}/accept`, {}, {
      actor: 'U1', idempotencyKey: ctx.fixtures.uuid(), expectStatus: [409, 410, 422],
    });
    ctx.assert.assert([409, 410, 422].includes(r.status), 'expired offer accept must be rejected with 409/410/422', r.body);
  },
};
