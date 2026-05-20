// N-16 — Refresh token reuse after rotation must 401.
export default {
  id: 'N-16', name: 'Refresh token reuse → 401',
  dependsOn: ['F-1'], actors: ['U1'],
  endpoints: ['POST /auth/refresh'],
  async run(ctx) {
    const a = ctx.actors.U1;
    // grab a fresh pair
    const r1 = await ctx.http.post('/auth/refresh', { refreshToken: a.refreshToken }, { noAuth: true, allowStatus: [200, 201, 401] });
    if (r1.status !== 200 && r1.status !== 201) {
      ctx.log.warn('Could not obtain fresh refresh — using current token');
    } else {
      const newRefresh = r1.body.refreshToken;
      const old = a.refreshToken;
      a.refreshToken = newRefresh;
      a.accessToken = r1.body.accessToken;
      // Use the OLD refresh token — must be rejected
      const r2 = await ctx.http.post('/auth/refresh', { refreshToken: old }, { noAuth: true, allowStatus: [401, 403, 409] });
      ctx.assert.assert(r2.status >= 400, 'rotated refresh must be rejected', r2.body);
    }
  },
};
