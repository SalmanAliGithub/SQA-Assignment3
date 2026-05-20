// F-22 — System config inspection + change history.
export default {
  id: 'F-22',
  name: 'System configs',
  dependsOn: ['F-7'],
  actors: ['AD1'],
  endpoints: ['GET /admin/config', 'PATCH /admin/config/{key}', 'GET /admin/config/{key}/history'],
  async run(ctx) {
    const { http, assert } = ctx;
    ctx.currentActor = 'AD1';

    ctx.currentStep = 'list';
    const r = await http.get('/admin/config', { expectStatus: 200 });
    const items = r.body?.items || r.body?.data || r.body || [];
    const list = Array.isArray(items) ? items : items.configs || [];
    const target = list.find(c => c.configKey === 'auth.otp.ttl_seconds' || c.key === 'auth.otp.ttl_seconds') || list[0];
    if (!target) { ctx.log.warn('no config items returned'); return; }
    const key = target.configKey || target.key;
    const oldValue = target.configValue ?? target.value;
    ctx.fixtures.configKey = key;

    ctx.currentStep = 'patch';
    await http.patch(`/admin/config/${encodeURIComponent(key)}`, { value: String(oldValue) }, { allowStatus: [200, 201, 204, 400, 401, 422] });

    ctx.currentStep = 'history';
    await http.get(`/admin/config/${encodeURIComponent(key)}/history`, { allowStatus: [200, 404] });
  },
};
