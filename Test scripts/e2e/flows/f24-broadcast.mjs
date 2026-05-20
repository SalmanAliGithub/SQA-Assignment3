// F-24 — Broadcast notification fan-out.
import { assertNotificationContains } from '../lib/side-effects.mjs';

export default {
  id: 'F-24',
  name: 'Broadcast notification',
  dependsOn: ['F-12'],
  actors: ['AD1', 'U1', 'U2'],
  endpoints: ['POST /admin/broadcast', 'GET /me/notifications'],
  async run(ctx) {
    const { http, assert } = ctx;
    const marker = `e2e-${ctx.runId}-broadcast`;

    ctx.currentStep = 'broadcast';
    const r = await http.post('/admin/broadcast', {
      title: 'Maintenance',
      body: `${marker} maintenance window starting`,
      targetRoles: ['USER', 'AGENT'],
      channel: 'IN_APP',
    }, { actor: 'AD1', expectStatus: [200, 201, 202] });
    const broadcastId = r.body?.id || r.body?.broadcastId || r.body?.eventId || r.body?.notificationId;
    ctx.fixtures.broadcastId = broadcastId;
    ctx.log.info('broadcast queued', { broadcastId, marker });

    const matches = (n) => {
      const payload = n.payload || n.data || n.metadata || {};
      if (broadcastId && (payload.broadcastId === broadcastId || n.broadcastId === broadcastId || payload.id === broadcastId)) return true;
      if (typeof n.body === 'string' && n.body.includes(marker)) return true;
      if (typeof payload.body === 'string' && payload.body.includes(marker)) return true;
      return false;
    };

    ctx.currentStep = 'verify-u1';
    await assertNotificationContains(ctx, 'U1', matches);
    ctx.currentStep = 'verify-u2';
    await assertNotificationContains(ctx, 'U2', matches);
  },
};
