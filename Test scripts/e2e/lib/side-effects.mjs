import { waitFor } from './polling.mjs';

// Polls the stub SMS log until a message to `phone` whose body matches `regex` appears.
// Fails the flow via ctx.assert.assert if timeoutMs elapses first.
export async function assertSmsReceived(ctx, phone, regex, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? ctx.opts.smsTimeoutMs ?? 15_000;
  try {
    const msg = await ctx.sms.waitForBodyMatch(phone, regex, { timeoutMs });
    ctx.log.debug(`SMS match ${phone}`, { body: msg.body });
    return msg;
  } catch (err) {
    ctx.assert.assert(false, `expected SMS to ${phone} matching ${regex} within ${timeoutMs}ms (${err.message})`);
  }
}

// Polls GET /me/notifications for `actor` until at least one item satisfies `predicate`.
export async function assertNotificationContains(ctx, actorLabel, predicate, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? ctx.opts.notificationTimeoutMs ?? 15_000;
  const intervalMs = opts.intervalMs ?? 1500;
  try {
    return await waitFor(async () => {
      const r = await ctx.http.get('/me/notifications', { actor: actorLabel, expectStatus: 200 });
      const list = r.body?.items || r.body?.data || r.body || [];
      const arr = Array.isArray(list) ? list : [];
      return arr.find(predicate) || null;
    }, { timeoutMs, intervalMs, label: `notification for ${actorLabel}` });
  } catch (err) {
    ctx.assert.assert(false, `expected notification for ${actorLabel} within ${timeoutMs}ms (${err.message})`);
  }
}

// Re-fetches /admin/transactions/{id} and asserts the original transaction still exists
// (append-only ledger — IR-4) AND that the transaction is now flagged as reversed.
export async function assertTransactionImmutable(ctx, txId, opts = {}) {
  const r = await ctx.http.get(`/admin/transactions/${txId}`, { actor: 'AD1', expectStatus: 200 });
  const body = r.body || {};
  ctx.assert.assert(body.id === txId || body.transactionId === txId, 'reversed tx must still exist (IR-4)', body);
  const status = (body.status || body.state || '').toUpperCase();
  if (status) {
    ctx.assert.assert(
      ['REVERSED', 'REVERSAL_POSTED', 'REVERSAL_COMPLETED'].includes(status),
      `reversed tx ${txId} should have status REVERSED, got "${status}"`,
      body,
    );
  }
  // If the response surfaces the reversal pointer, sanity-check it.
  const reversalRef = body.reversalTransactionId || body.reversedByTransactionId;
  if (reversalRef && !opts.skipReversalLookup) {
    const r2 = await ctx.http.get(`/admin/transactions/${reversalRef}`, { actor: 'AD1', expectStatus: 200 });
    ctx.assert.assert(r2.body, `compensating reversal tx ${reversalRef} must be readable`);
  }
  return body;
}
