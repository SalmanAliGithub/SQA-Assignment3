import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

// returns true if all required preconditions met; otherwise calls log.error and returns false.
export async function preflight(ctx) {
  const { log, http, opts } = ctx;
  log.info('Pre-flight checks');

  // 1. Health + readiness
  try {
    const h = await http.get('/health', { noAuth: true, allowStatus: [200, 503] });
    if (h.status !== 200) {
      log.error(`API /health returned ${h.status}`, h.body);
      return false;
    }
  } catch (err) {
    log.error('API unreachable at ' + opts.baseUrl, { error: String(err) });
    log.error('Hint: run `pnpm dev` to start the API + Postgres + Redis.');
    return false;
  }
  try {
    const r = await http.get('/ready', { noAuth: true, allowStatus: [200, 503] });
    if (r.status !== 200) {
      log.warn('API /ready returned 503 — proceeding but dependencies may be flaky', r.body);
    }
  } catch (err) {
    log.warn('/ready check failed', { error: String(err) });
  }

  // 2. SMS stub file path
  const smsFile = resolve(opts.smsStubFile);
  try {
    if (!existsSync(smsFile)) {
      writeFileSync(smsFile, '', 'utf8');
      log.debug(`Created empty stub SMS log at ${smsFile}`);
    } else {
      log.debug(`Using stub SMS log at ${smsFile}`);
    }
  } catch (err) {
    log.error(`Cannot access stub SMS log at ${smsFile}`, { error: String(err) });
    return false;
  }
  ctx.fixtures.smsFileAbs = smsFile;

  // 3. Admin credentials
  if (!opts.adminFastToken) {
    const email = process.env.DEFAULT_ADMIN_EMAIL || 'admin@maal.local';
    const password = process.env.DEFAULT_ADMIN_PASSWORD;
    if (!password) {
      log.warn('DEFAULT_ADMIN_PASSWORD not set — F-7 will likely fail. Set it before running, e.g.');
      log.warn('  export DEFAULT_ADMIN_PASSWORD=<from db:setup seed log>');
      log.warn('  or pass --admin-fast-token to use the HMAC shortcut (skips F-7).');
    }
    ctx.fixtures.adminEmail = email;
    ctx.fixtures.adminPassword = password || null;
  }

  // 4. BCRYPT_PEPPER
  if (!process.env.BCRYPT_PEPPER) {
    log.warn('BCRYPT_PEPPER not set in this shell — admin login may fail. dev defaults to "dev-bcrypt-pepper".');
  }

  // 5. Reset if requested
  if (opts.reset) {
    log.info('Running `pnpm dev:reset` (this takes 30-60s)');
    try {
      execSync('pnpm dev:reset', { stdio: 'inherit' });
    } catch (err) {
      log.error('dev:reset failed', { error: String(err) });
      return false;
    }
  }

  log.info('Pre-flight OK');
  return true;
}
