#!/usr/bin/env node
import { parseArgs } from './config.mjs';
import { createContext } from './context.mjs';
import { createLogger } from './lib/logger.mjs';
import { createHttpClient } from './lib/http.mjs';
import { createAssert } from './lib/assert.mjs';
import { createFixtures } from './lib/fixtures.mjs';
import { createSmsReader } from './lib/sms-stub.mjs';
import { createIdempotencyHelpers } from './lib/idempotency.mjs';
import { loadOpenApi } from './lib/openapi.mjs';
import { preflight } from './preflight.mjs';
import { runFlows, topoSort, printDag } from './orchestrator.mjs';
import { buildCoverageReport, printCoverage } from './coverage.mjs';
import { loadAllFlows } from './flows/_registry.mjs';

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const ctx = createContext(opts);
  const log = createLogger(opts);
  ctx.log = log;
  ctx.openapi = loadOpenApi();
  ctx.http = createHttpClient(ctx);
  ctx.assert = createAssert(ctx);
  ctx.fixtures = { ...ctx.fixtures, ...createFixtures(ctx) };
  ctx.sms = createSmsReader(ctx);
  ctx.idem = createIdempotencyHelpers(ctx);

  log.info(`Maal E2E harness — run ${ctx.startedAt}`);
  log.info(`Logs: ${log.paths.json}`);
  log.info(`Logs: ${log.paths.text}`);
  log.info(`Base URL: ${opts.baseUrl}`);
  log.info(`SMS stub: ${opts.smsStubFile}`);
  log.info(`Run ID: ${ctx.runId}  (phone suffix)`);

  const flows = await loadAllFlows();
  log.info(`Registered ${flows.length} flow modules`);

  if (opts.showDag) {
    printDag(flows);
    process.exit(0);
  }

  // Pre-flight (uses ctx.http but no auth needed)
  const ok = await preflight(ctx);
  if (!ok) {
    log.error('Pre-flight FAILED — aborting');
    log.close();
    process.exit(2);
  }

  await runFlows(ctx, flows, { only: opts.only, skip: opts.skip });

  // Summary
  const tally = { PASS: 0, FAIL: 0, SKIP: 0, BLOCKED: 0 };
  for (const r of Object.values(ctx.results)) tally[r.status] = (tally[r.status] || 0) + 1;
  log.info('───── Summary ─────');
  log.info(`PASS:    ${tally.PASS}`);
  log.info(`FAIL:    ${tally.FAIL}`);
  log.info(`BLOCKED: ${tally.BLOCKED}`);
  log.info(`SKIP:    ${tally.SKIP}`);
  for (const [id, r] of Object.entries(ctx.results)) {
    if (r.status === 'FAIL') log.error(`  ${id}: ${r.error}`);
    else if (r.status === 'BLOCKED') log.warn(`  ${id}: ${r.reason}`);
  }

  // Coverage
  const cov = buildCoverageReport(ctx);
  printCoverage(ctx, cov);

  const coverageFailed = cov.pct < opts.coverageThreshold;
  if (coverageFailed) log.error(`Coverage ${cov.pct}% below threshold ${opts.coverageThreshold}%`);

  log.info(`Run finished. Full debug log: ${log.paths.text}`);
  log.close();

  const exitCode = tally.FAIL > 0 || coverageFailed ? 1 : 0;
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('Harness crash:', err);
  process.exit(3);
});
