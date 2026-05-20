// F-8 — Accountant adjustment request + 4-eyes approval.
import { onboardAccountant } from './blocks/b07-onboard-accountant.mjs';
import { totpGenerate } from '../lib/totp.mjs';

export default {
  id: 'F-8',
  name: 'Accountant adjustment request + admin approval',
  dependsOn: ['F-7', 'F-1'],
  actors: ['AD1', 'AC1', 'U1'],
  endpoints: [
    'POST /admin/accountants', 'GET /admin/accountants', 'GET /admin/accountants/{id}',
    'POST /admin/accountants/{id}/deactivate', 'POST /admin/accountants/{id}/reactivate', 'POST /admin/accountants/{id}/reset-password',
    'POST /admin/adjustments', 'GET /admin/adjustments', 'GET /admin/adjustments/{id}',
    'POST /admin/adjustments/{id}/approve', 'POST /admin/adjustments/{id}/reject', 'POST /admin/adjustments/{id}/cancel',
  ],
  async run(ctx) {
    const { http, fixtures, assert } = ctx;
    ctx.currentActor = 'AD1';

    ctx.currentStep = 'onboard-accountant';
    const phone = fixtures.nextPhone('AC1');
    await onboardAccountant(ctx, { adminLabel: 'AD1', accountantLabel: 'AC1', phone });
    assert.assert(ctx.actors.AC1?.accessToken, 'AC1 onboarding must yield a usable token');

    ctx.currentStep = 'list-accountants';
    await http.get('/admin/accountants', { actor: 'AD1', expectStatus: 200 });

    ctx.currentStep = 'detail-accountant';
    await http.get(`/admin/accountants/${ctx.actors.AC1.accountantId}`, { actor: 'AD1', expectStatus: 200 });

    ctx.currentStep = 'submit-adjustment';
    const targetPhone = ctx.actors.U1.phone;
    const submit = await http.post('/admin/adjustments', {
      targetWalletPhone: targetPhone, amount: '50.00', direction: 'CREDIT',
      reason: 'SMS billing reconciliation', supportingRefs: [],
    }, { actor: 'AC1', expectStatus: [200, 201] });
    const adjId = submit.body?.id || submit.body?.adjustmentId;
    assert.assert(adjId, 'submit-adjustment must return id', submit.body);
    ctx.fixtures.adjustmentId = adjId;

    ctx.currentStep = 'list-adjustments';
    await http.get('/admin/adjustments', { actor: 'AD1', expectStatus: 200 });

    ctx.currentStep = 'detail-adjustment';
    await http.get(`/admin/adjustments/${adjId}`, { actor: 'AD1', expectStatus: 200 });

    ctx.currentStep = 'approve';
    await http.post(`/admin/adjustments/${adjId}/approve`, {
      note: 'verified', mfaCode: totpGenerate(ctx.actors.AD1.mfaSecret),
    }, { actor: 'AD1', expectStatus: [200, 201, 204] });

    // Reject path
    ctx.currentStep = 'submit-2';
    const s2 = await http.post('/admin/adjustments', {
      targetWalletPhone: targetPhone, amount: '10.00', direction: 'DEBIT', reason: 'reject-test',
    }, { actor: 'AC1', expectStatus: [200, 201] });
    const adjId2 = s2.body?.id || s2.body?.adjustmentId;
    assert.assert(adjId2, 'submit-2 must return id', s2.body);
    ctx.currentStep = 'reject';
    await http.post(`/admin/adjustments/${adjId2}/reject`, { reason: 'missing evidence' }, { actor: 'AD1', expectStatus: [200, 201, 204] });

    // Cancel path
    ctx.currentStep = 'submit-3';
    const s3 = await http.post('/admin/adjustments', {
      targetWalletPhone: targetPhone, amount: '5.00', direction: 'CREDIT', reason: 'cancel-test',
    }, { actor: 'AC1', expectStatus: [200, 201] });
    const adjId3 = s3.body?.id || s3.body?.adjustmentId;
    assert.assert(adjId3, 'submit-3 must return id', s3.body);
    ctx.currentStep = 'cancel';
    await http.post(`/admin/adjustments/${adjId3}/cancel`, {}, { actor: 'AC1', expectStatus: [200, 201, 204] });

    // Accountant lifecycle
    ctx.currentStep = 'deactivate-ac';
    await http.post(`/admin/accountants/${ctx.actors.AC1.accountantId}/deactivate`, {}, { actor: 'AD1', expectStatus: [200, 201, 204] });
    ctx.currentStep = 'reactivate-ac';
    await http.post(`/admin/accountants/${ctx.actors.AC1.accountantId}/reactivate`, {}, { actor: 'AD1', expectStatus: [200, 201, 204] });
    ctx.currentStep = 'reset-password-ac';
    await http.post(`/admin/accountants/${ctx.actors.AC1.accountantId}/reset-password`, {}, { actor: 'AD1', expectStatus: [200, 201, 204] });
  },
};
