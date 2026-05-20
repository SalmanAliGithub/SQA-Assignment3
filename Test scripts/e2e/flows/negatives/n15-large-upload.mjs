// N-15 — Large file (>5MB) to /me/kyc/upload must be rejected by the size cap.
// Send the REQUIRED `type` field so the size validator (not the schema validator) fires.
import { Buffer } from 'node:buffer';

export default {
  id: 'N-15', name: 'POST /me/kyc/upload >5MB → 413/422',
  dependsOn: ['F-1'], actors: ['U1'],
  endpoints: ['POST /me/kyc/upload'],
  async run(ctx) {
    const big = Buffer.alloc(10 * 1024 * 1024, 0x41); // 10MB — scenarios.md § 7 N-15 spec
    const fd = new FormData();
    fd.append('image', new Blob([big], { type: 'image/png' }), 'big.png');
    fd.append('type', 'ID_DOCUMENT');
    const r = await ctx.http.request({
      method: 'POST', path: '/me/kyc/upload', multipart: fd, actor: 'U1',
      expectStatus: [400, 413, 422],
    });
    ctx.assert.assert([400, 413, 422].includes(r.status), 'oversize upload must be rejected with 400/413/422', { status: r.status, body: r.body });
    // Sanity-check the rejection is on size, not on some other validator.
    const msg = JSON.stringify(r.body).toLowerCase();
    ctx.assert.assert(
      /5\s?mb|size|too large|file must be/.test(msg),
      'rejection must reference size cap (not a different validator)',
      r.body,
    );
  },
};
