// One-shot scheduled-payout worker. Point a cron job (or any scheduler) at
//   npm run payout:run-due   (from backend/)
// daily — runDueScheduledPayouts is idempotent per window, so calling it more
// often than the schedule requires is harmless. Requires the same env vars as
// the payout-service itself (SUPABASE_*, RAZORPAY_* for live disbursement;
// without Razorpay it uses the mock settlement branch).
import { runDueScheduledPayouts } from "./bulk.js";

runDueScheduledPayouts({ initiatedBy: null })
  .then((result) => {
    console.log(JSON.stringify({ level: "info", service: "payout-scheduler", ...result }));
    process.exit(0);
  })
  .catch((err) => {
    console.error(JSON.stringify({ level: "error", service: "payout-scheduler", msg: "run failed", error: err instanceof Error ? err.message : String(err) }));
    process.exit(1);
  });
