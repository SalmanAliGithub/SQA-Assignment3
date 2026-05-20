// F-6 — KYC tier upgrade (User submits → Admin approves).
export default {
  id: 'F-6',
  name: 'KYC tier upgrade',
  dependsOn: ['F-1', 'F-7'],
  actors: ['U1', 'AD1'],
  endpoints: [
    'POST /me/kyc/upload', 'POST /me/kyc/submit', 'GET /me/kyc', 'GET /me/kyc/submissions/{id}',
    'GET /admin/kyc/submissions', 'GET /admin/kyc/submissions/{id}',
    'POST /admin/kyc/submissions/{id}/approve',
    'POST /admin/kyc/submissions/{id}/reject', 'POST /admin/kyc/submissions/{id}/request-update',
  ],
  async run(ctx) {
    const { http, fixtures, assert } = ctx;

    async function upload(field, type) {
      const fd = new FormData();
      const png = fixtures.tinyPng();
      fd.append('image', new Blob([png], { type: 'image/png' }), 'id.png');
      if (type) fd.append('type', type);
      return http.request({ method: 'POST', path: '/me/kyc/upload', multipart: fd, actor: 'U1', allowStatus: [200, 201, 400, 422] });
    }

    ctx.currentStep = 'upload-id';
    const u1 = await upload('document', 'ID_DOCUMENT');
    ctx.currentStep = 'upload-selfie';
    const u2 = await upload('document', 'SELFIE');
    const nidUpload = u1.body?.uploadId;
    const selfieUpload = u2.body?.uploadId;

    ctx.currentStep = 'submit';
    const s = await http.post('/me/kyc/submit', {
      targetTier: 'TIER_1',
      fullName: `${ctx.actors.U1.firstName} ${ctx.actors.U1.lastName}`,
      dateOfBirth: '1996-03-12',
      address: 'Bole, Addis Ababa',
      nationalIdNumber: 'FAN-' + ctx.runId,
      nationalIdUploadId: nidUpload || 'placeholder-id',
      selfieUploadId: selfieUpload || 'placeholder-selfie',
    }, { actor: 'U1', allowStatus: [200, 201, 422] });
    const subId = s.body?.id || s.body?.submissionId;
    if (subId) ctx.fixtures.kycSubmissionId = subId;

    ctx.currentStep = 'me-kyc';
    await http.get('/me/kyc', { actor: 'U1', expectStatus: 200 });
    if (subId) {
      ctx.currentStep = 'submission-detail';
      await http.get(`/me/kyc/submissions/${subId}`, { actor: 'U1', allowStatus: [200, 404] });
    }

    ctx.currentStep = 'admin-list';
    const list = await http.get('/admin/kyc/submissions', { actor: 'AD1', query: { status: 'SUBMITTED' }, allowStatus: [200, 400] });
    const items = list.body?.items || list.body?.data || list.body || [];
    const target = items.find(i => i.id === subId) || items[0];

    if (target?.id) {
      ctx.currentStep = 'admin-detail';
      await http.get(`/admin/kyc/submissions/${target.id}`, { actor: 'AD1', expectStatus: 200 });
      ctx.currentStep = 'approve';
      const approveRes = await http.post(`/admin/kyc/submissions/${target.id}/approve`, { targetTier: 'TIER_1', note: 'F-6 OK' }, { actor: 'AD1', expectStatus: [200, 201, 204] });

      // Side-effect: user's KYC tier must reflect the approval.
      ctx.currentStep = 'verify-tier-bump';
      const after = await http.get('/me/kyc', { actor: 'U1', expectStatus: 200 });
      const newTier = after.body?.currentTier || after.body?.tier || after.body?.kycTier || after.body?.tierLevel;
      assert.assert(newTier === 'TIER_1', `KYC approve must promote user to TIER_1, got "${newTier}"`, after.body);
    }

    // Reject + request-update branches require a fresh submission; create stubs if available
    ctx.currentStep = 'second-submit';
    const s2 = await http.post('/me/kyc/submit', {
      targetTier: 'TIER_1', fullName: 'Hanna Tesema',
      dateOfBirth: '1996-03-12', address: 'Bole, AA',
      nationalIdNumber: 'FAN-X-' + ctx.runId,
      nationalIdUploadId: nidUpload || 'placeholder', selfieUploadId: selfieUpload || 'placeholder',
    }, { actor: 'U1', allowStatus: [200, 201, 400, 409, 422] });
    const sid2 = s2.body?.id || s2.body?.submissionId;
    if (sid2) {
      ctx.currentStep = 'request-update';
      await http.post(`/admin/kyc/submissions/${sid2}/request-update`, { reason: 'low quality' }, { actor: 'AD1', allowStatus: [200, 201, 204, 409, 422] });
      ctx.currentStep = 'reject';
      await http.post(`/admin/kyc/submissions/${sid2}/reject`, { reason: 'doc mismatch' }, { actor: 'AD1', allowStatus: [200, 201, 204, 409, 422] });
    }
  },
};
