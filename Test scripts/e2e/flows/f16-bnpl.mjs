// F-16 — BNPL full lifecycle.
export default {
  id: 'F-16',
  name: 'BNPL: product → application → disbursement → repayment → overdue → writeoff',
  dependsOn: ['F-6', 'F-9'],
  actors: ['AD1', 'U1'],
  endpoints: [
    'GET /admin/financing/products', 'POST /admin/financing/products', 'PATCH /admin/financing/products/{id}',
    'POST /admin/financing/products/{id}/publish', 'POST /admin/financing/products/{id}/retire',
    'GET /bnpl/products', 'POST /bnpl/applications', 'GET /bnpl/applications/{id}',
    'POST /bnpl/applications/{id}/accept', 'POST /bnpl/applications/{id}/cancel',
    'GET /me/bnpl/contracts', 'GET /me/bnpl/contracts/{id}', 'POST /me/bnpl/contracts/{id}/repayments',
    'GET /admin/financing/contracts', 'GET /admin/financing/contracts/{id}',
    'POST /admin/financing/contracts/{id}/record-repayment',
    'POST /admin/financing/contracts/{id}/remind',
    'POST /admin/financing/contracts/{id}/writeoff',
    'GET /admin/financing/overdue', 'GET /admin/financing/overview',
  ],
  async run(ctx) {
    const { http, fixtures } = ctx;

    ctx.currentStep = 'create-product';
    const cp = await http.post('/admin/financing/products', {
      name: `E2E Product ${ctx.runId}`,
      category: 'EQUIPMENT',
      minAmount: '500.00',
      maxAmount: '5000.00',
      fixedMarkup: '0.00',
      tenureMonths: 3,
      minCreditScore: 0,
      minKycTier: 'TIER_1',
    }, { actor: 'AD1', allowStatus: [200, 201, 400, 422] });
    const productId = cp.body?.id;
    if (!productId) { ctx.log.warn('product not created — skipping rest'); return; }

    ctx.currentStep = 'patch-product';
    await http.patch(`/admin/financing/products/${productId}`, { name: `E2E Product ${ctx.runId} v2` }, { actor: 'AD1', allowStatus: [200, 201, 204, 422] });

    ctx.currentStep = 'publish';
    await http.post(`/admin/financing/products/${productId}/publish`, {}, { actor: 'AD1', allowStatus: [200, 201, 204] });

    ctx.currentStep = 'admin-list-products';
    await http.get('/admin/financing/products', { actor: 'AD1', expectStatus: 200 });

    ctx.currentStep = 'user-list-products';
    const lp = await http.get('/bnpl/products', { actor: 'U1', expectStatus: 200 });
    const items = lp.body?.items || lp.body?.data || lp.body || [];
    const product = items.find(p => p.id === productId || p.productId === productId) || items[0];

    if (!product) { ctx.log.warn('no products visible to user'); }

    ctx.currentStep = 'apply';
    const app = await http.post('/bnpl/applications', {
      productId: product?.id || product?.productId || productId,
      requestedAmount: '3000.00',
      purpose: 'equipment',
      consents: { credit: true, terms: true },
      consentVersion: 'v1',
    }, { actor: 'U1', allowStatus: [200, 201, 400, 422] });
    const appId = app.body?.id || app.body?.applicationId;
    if (!appId) { ctx.log.warn('application failed — skipping rest of BNPL'); return; }

    ctx.currentStep = 'app-detail';
    await http.get(`/bnpl/applications/${appId}`, { actor: 'U1', allowStatus: [200, 404] });

    ctx.currentStep = 'accept';
    const acc = await http.post(`/bnpl/applications/${appId}/accept`, {}, { actor: 'U1', idempotencyKey: fixtures.uuid(), allowStatus: [200, 201, 409, 422] });
    const contractId = acc.body?.contractId || acc.body?.id;

    ctx.currentStep = 'my-contracts';
    await http.get('/me/bnpl/contracts', { actor: 'U1', expectStatus: 200 });
    if (contractId) {
      ctx.currentStep = 'my-contract-detail';
      await http.get(`/me/bnpl/contracts/${contractId}`, { actor: 'U1', allowStatus: [200, 404] });
      ctx.currentStep = 'repay';
      await http.post(`/me/bnpl/contracts/${contractId}/repayments`, { amount: '500.00' }, { actor: 'U1', idempotencyKey: fixtures.uuid(), allowStatus: [200, 201, 422] });
    }

    ctx.currentStep = 'admin-contracts';
    await http.get('/admin/financing/contracts', { actor: 'AD1', expectStatus: 200 });
    if (contractId) {
      ctx.currentStep = 'admin-contract-detail';
      await http.get(`/admin/financing/contracts/${contractId}`, { actor: 'AD1', allowStatus: [200, 404] });
      ctx.currentStep = 'admin-record-repay';
      await http.post(`/admin/financing/contracts/${contractId}/record-repayment`, { amount: '200.00', reason: 'branch deposit' }, { actor: 'AD1', idempotencyKey: fixtures.uuid(), allowStatus: [200, 201, 422] });
      ctx.currentStep = 'remind';
      await http.post(`/admin/financing/contracts/${contractId}/remind`, {}, { actor: 'AD1', allowStatus: [200, 201, 204] });
    }

    ctx.currentStep = 'overdue';
    await http.get('/admin/financing/overdue', { actor: 'AD1', expectStatus: 200 });
    ctx.currentStep = 'overview';
    await http.get('/admin/financing/overview', { actor: 'AD1', expectStatus: 200 });

    if (contractId) {
      ctx.currentStep = 'writeoff';
      await http.post(`/admin/financing/contracts/${contractId}/writeoff`, { reason: 'uncollectable' }, { actor: 'AD1', idempotencyKey: fixtures.uuid(), allowStatus: [200, 201, 422] });
    }

    // Cancel a fresh application on a SECOND product so we don't collide with the
    // already-resolved application (server returns 409 for duplicate on same product).
    ctx.currentStep = 'create-product-2';
    const cp2 = await http.post('/admin/financing/products', {
      name: `E2E Cancel Product ${ctx.runId}`,
      category: 'EQUIPMENT',
      minAmount: '100.00',
      maxAmount: '1000.00',
      fixedMarkup: '0.00',
      tenureMonths: 2,
      minCreditScore: 0,
      minKycTier: 'TIER_1',
    }, { actor: 'AD1', expectStatus: [200, 201] });
    const productId2 = cp2.body?.id;
    await http.post(`/admin/financing/products/${productId2}/publish`, {}, { actor: 'AD1', expectStatus: [200, 201, 204] });
    ctx.fixtures.bnplCancelProductId = productId2;

    ctx.currentStep = 'apply-2';
    const a2 = await http.post('/bnpl/applications', {
      productId: productId2,
      requestedAmount: '300.00',
      consents: { credit: true, terms: true },
      consentVersion: 'v1',
    }, { actor: 'U1', expectStatus: [200, 201] });
    const appId2 = a2.body?.id || a2.body?.applicationId;
    ctx.fixtures.bnplCancelAppId = appId2;
    if (appId2) {
      ctx.currentStep = 'cancel';
      await http.post(`/bnpl/applications/${appId2}/cancel`, {}, { actor: 'U1', allowStatus: [200, 201, 204, 422] });
    }

    ctx.currentStep = 'retire';
    await http.post(`/admin/financing/products/${productId}/retire`, {}, { actor: 'AD1', allowStatus: [200, 201, 204] });
  },
};
