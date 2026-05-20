// F-18 — Admin transactions: search, inspect, flag, reverse.
import { totpGenerate } from '../lib/totp.mjs';
import { assertTransactionImmutable } from '../lib/side-effects.mjs';

export default {
  id: 'F-18',
  name: 'Admin transactions search/inspect/flag/reverse',
  dependsOn: ['F-9', 'F-12'],
  actors: ['AD1'],
  endpoints: [
    'GET /admin/transactions', 'GET /admin/transactions/{id}',
    'POST /admin/transactions/{id}/flag', 'POST /admin/transactions/{id}/reverse',
  ],
  async run(ctx) {
    const { http, assert } = ctx;
    const mfa = () => totpGenerate(ctx.actors.AD1.mfaSecret);

    ctx.currentStep = 'search';
    const s = await http.get('/admin/transactions', { actor: 'AD1', query: { limit: 20 }, expectStatus: 200 });
    const items = s.body?.items || s.body?.data || s.body || [];
    assert.assert(items.length > 0, 'admin transactions list must have rows from prior flows', s.body);

    // Pick the F-12 P2P tx for flag (read-only side-effect).
    const flagTarget = items.find(t => t.id === ctx.fixtures.p2pTxId) || items[0];
    assert.assert(flagTarget?.id, 'must have a transaction id to flag', items[0]);

    ctx.currentStep = 'detail';
    await http.get(`/admin/transactions/${flagTarget.id}`, { actor: 'AD1', expectStatus: 200 });

    ctx.currentStep = 'flag';
    const f = await http.post(`/admin/transactions/${flagTarget.id}/flag`, { severity: 'WARNING', reason: 'velocity anomaly detected during e2e run' }, { actor: 'AD1', expectStatus: [200, 201] });
    if (f.body?.flagId) ctx.fixtures.lastFlagId = f.body.flagId;

    // Pick a different tx to reverse so the flag target stays untouched.
    const reverseTarget = items.find(t => t.id !== flagTarget.id) || flagTarget;
    assert.assert(reverseTarget?.id, 'must have a transaction id to reverse', items);

    ctx.currentStep = 'reverse';
    await http.post(`/admin/transactions/${reverseTarget.id}/reverse`, { reason: 'merchant chargeback reverse via e2e harness', mfaCode: mfa() }, { actor: 'AD1', expectStatus: [200, 201, 204] });
    ctx.fixtures.reversedTxId = reverseTarget.id;

    // Side-effect: IR-4 ledger immutability. The original tx must still exist + be marked reversed.
    ctx.currentStep = 'verify-immutability';
    await assertTransactionImmutable(ctx, reverseTarget.id);
  },
};
