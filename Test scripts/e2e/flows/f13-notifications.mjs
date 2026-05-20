// F-13 — Notification lifecycle (mark-read, delete).
export default {
  id: 'F-13',
  name: 'Notifications lifecycle',
  dependsOn: ['F-12'],
  actors: ['U2'],
  endpoints: [
    'GET /me/notifications', 'GET /me/notifications/{id}',
    'POST /me/notifications/mark-read', 'DELETE /me/notifications/{id}',
  ],
  async run(ctx) {
    const { http } = ctx;
    const n = await http.get('/me/notifications', { actor: 'U2', expectStatus: 200 });
    const list = n.body?.items || n.body?.data || n.body || [];
    ctx.assert.assert(Array.isArray(list) && list.length > 0, 'F-12 must have produced at least one notification for U2', n.body);
    const id = list[0].notificationId || list[0].id;

    ctx.currentStep = 'mark-some';
    await http.post('/me/notifications/mark-read', { notificationIds: [id] }, { actor: 'U2', allowStatus: [200, 201, 204] });

    ctx.currentStep = 'mark-all';
    await http.post('/me/notifications/mark-read', { markAll: true }, { actor: 'U2', allowStatus: [200, 201, 204] });

    ctx.currentStep = 'detail';
    await http.get(`/me/notifications/${id}`, { actor: 'U2', allowStatus: [200, 404] });

    ctx.currentStep = 'delete';
    await http.del(`/me/notifications/${id}`, { actor: 'U2', allowStatus: [200, 204, 404] });
  },
};
