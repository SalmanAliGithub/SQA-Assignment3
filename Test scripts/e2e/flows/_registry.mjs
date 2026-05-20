// Static registry of all flow modules. Static import keeps Node ESM happy and gives us deterministic load.
import f26a from './f26a-health.mjs';
import f07 from './f07-admin-auth.mjs';
import f01 from './f01-onboarding.mjs';
import f02 from './f02-session.mjs';
import f03 from './f03-device-binding.mjs';
import f04 from './f04-pin-lifecycle.mjs';
import f05 from './f05-profile-deletion.mjs';
import f17 from './f17-admin-users.mjs';
import f08 from './f08-adjustments.mjs';
import f22 from './f22-system-configs.mjs';
import f09 from './f09-agent-cashin.mjs';
import f21 from './f21-commission-rules.mjs';
import f10 from './f10-agent-topup-request.mjs';
import f11 from './f11-cashout.mjs';
import f12 from './f12-p2p-transfer.mjs';
import f13 from './f13-notifications.mjs';
import f14 from './f14-limits.mjs';
import f06 from './f06-kyc-upgrade.mjs';
import f16 from './f16-bnpl.mjs';
import f15 from './f15-disputes.mjs';
import f18 from './f18-admin-transactions.mjs';
import f19 from './f19-risk-flags.mjs';
import f20 from './f20-dashboard-sse.mjs';
import f23 from './f23-reports-audit.mjs';
import f24 from './f24-broadcast.mjs';
import f25 from './f25-commission-export.mjs';
import f26b from './f26b-internal-events.mjs';

import s01 from './standalone/s01-recent-activity.mjs';
import s02 from './standalone/s02-agent-open-count.mjs';
import s03 from './standalone/s03-financing-products.mjs';
import s04 from './standalone/s04-agents-nearby.mjs';
import s05 from './standalone/s05-transfer-bykey-404.mjs';
import s06 from './standalone/s06-bnpl-contracts.mjs';
import s07 from './standalone/s07-agent-tx-404.mjs';
import s08 from './standalone/s08-topup-reapprove.mjs';
import s09 from './standalone/s09-financing-contract.mjs';

import n00 from './negatives/n00-auto-unauthenticated.mjs';
import n01 from './negatives/n01-user-calls-admin.mjs';
import n02 from './negatives/n02-user-cashin.mjs';
import n03 from './negatives/n03-agent-transfer.mjs';
import n04 from './negatives/n04-agent-bnpl.mjs';
import n05 from './negatives/n05-accountant-approve.mjs';
import n06 from './negatives/n06-accountant-freeze.mjs';
import n07 from './negatives/n07-user-probe.mjs';
import n08 from './negatives/n08-anon-me.mjs';
import n09 from './negatives/n09-frozen-transfer.mjs';
import n10 from './negatives/n10-suspended-cashin.mjs';
import n11 from './negatives/n11-no-idempotency.mjs';
import n12 from './negatives/n12-idempotency-conflict.mjs';
import n13 from './negatives/n13-freeze-no-mfa.mjs';
import n14 from './negatives/n14-rate-limit.mjs';
import n15 from './negatives/n15-large-upload.mjs';
import n16 from './negatives/n16-refresh-reuse.mjs';
import n17 from './negatives/n17-dispute-foreign.mjs';
import n18 from './negatives/n18-double-reverse.mjs';
import n19 from './negatives/n19-bnpl-accept-expired.mjs';
import n20 from './negatives/n20-suspended-floattopup.mjs';

export async function loadAllFlows() {
  return [
    f26a,
    f07, f01, f02, f03, f04, f05,
    f17, f08, f22, f09, f21,
    f10, f11, f12, f13, f14,
    f06, f16, f15,
    f18, f19,
    f20, f23, f24, f25,
    f26b,
    s01, s02, s03, s04, s05, s06, s07, s08, s09,
    n00, n01, n02, n03, n04, n05, n06, n07, n08, n09, n10,
    n11, n12, n13, n14, n15, n16, n17, n18, n19, n20,
  ];
}
