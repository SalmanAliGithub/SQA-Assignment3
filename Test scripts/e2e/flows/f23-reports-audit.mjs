// F-23 — Reports + audit logs (queue & poll).
import { totpGenerate } from '../lib/totp.mjs';

export default {
  id: 'F-23',
  name: 'Reports + audit logs',
  dependsOn: ['F-7'],
  actors: ['AD1'],
  endpoints: [
    'GET /admin/reports/types', 'POST /admin/reports/{type}',
    'GET /admin/reports/jobs', 'GET /admin/reports/jobs/{jobId}',
    'POST /admin/reports/jobs/{jobId}/cancel',
    'GET /admin/audit-logs', 'GET /admin/audit-logs/{id}',
    'POST /admin/audit-logs/export',
  ],
  async run(ctx) {
    const { http } = ctx;
    ctx.currentActor = 'AD1';

    ctx.currentStep = 'types';
    const t = await http.get('/admin/reports/types', { expectStatus: 200 });
    const types = t.body?.items || t.body?.data || t.body || [];
    const type = types[0]?.code || types[0]?.type || 'TRANSACTIONS_DAILY';

    ctx.currentStep = 'queue';
    const today = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    const q = await http.post(`/admin/reports/${type}`, {
      parameters: { from: start, to: today, date: today },
      format: 'csv',
    }, { allowStatus: [200, 201, 202, 400, 422] });
    const jobId = q.body?.jobId || q.body?.id;

    ctx.currentStep = 'jobs';
    await http.get('/admin/reports/jobs', { expectStatus: 200 });

    if (jobId) {
      ctx.currentStep = 'job-detail';
      await http.get(`/admin/reports/jobs/${jobId}`, { allowStatus: [200, 404] });
    }

    // Queue + cancel
    const q2 = await http.post(`/admin/reports/${type}`, { parameters: { from: start, to: today, date: today }, format: 'csv' }, { allowStatus: [200, 201, 202, 400, 422] });
    const jobId2 = q2.body?.jobId || q2.body?.id;
    if (jobId2) {
      ctx.currentStep = 'cancel';
      await http.post(`/admin/reports/jobs/${jobId2}/cancel`, {}, { allowStatus: [200, 201, 204, 409] });
    }

    ctx.currentStep = 'audit-list';
    const al = await http.get('/admin/audit-logs', { query: { limit: 10 }, expectStatus: 200 });
    const auditItems = al.body?.items || al.body?.data || al.body || [];
    if (auditItems[0]?.id) {
      ctx.currentStep = 'audit-detail';
      await http.get(`/admin/audit-logs/${auditItems[0].id}`, { allowStatus: [200, 404] });
    }

    ctx.currentStep = 'audit-export';
    const exportFrom = new Date(Date.now() - 7 * 86400_000).toISOString();
    const exportTo = new Date().toISOString();
    await http.post('/admin/audit-logs/export', {
      from: exportFrom, to: exportTo, format: 'CSV',
      otpCode: totpGenerate(ctx.actors.AD1.mfaSecret),
    }, { expectStatus: [200, 201, 202] });
  },
};
