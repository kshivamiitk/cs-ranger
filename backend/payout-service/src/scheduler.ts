// Pure payout-window logic — no DB, no env, fully unit-testable.
// All windows are computed in UTC so the key is the same regardless of which
// machine (admin's browser-triggered API call vs a cron box) evaluates it.

export type PayoutSchedule = "manual" | "monthly_1st" | "monthly_1st_15th";

export const PAYOUT_SCHEDULES: readonly PayoutSchedule[] = ["manual", "monthly_1st", "monthly_1st_15th"];

export interface PayoutWindow {
  /** Stable idempotency key, e.g. "monthly_1st:2026-06-01". One disbursement per key. */
  key: string;
  /** When this window opened (UTC midnight). */
  opensAt: Date;
}

function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The window that is currently due for the schedule, or null when payouts are manual. */
export function currentPayoutWindow(schedule: PayoutSchedule, now: Date = new Date()): PayoutWindow | null {
  if (schedule === "manual") return null;
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (schedule === "monthly_1st") {
    const opensAt = utcDate(y, m, 1);
    return { key: `monthly_1st:${dayKey(opensAt)}`, opensAt };
  }
  const opensAt = now.getUTCDate() >= 15 ? utcDate(y, m, 15) : utcDate(y, m, 1);
  return { key: `monthly_1st_15th:${dayKey(opensAt)}`, opensAt };
}

/** When the next window after `now` opens, or null when payouts are manual. */
export function nextPayoutWindowOpensAt(schedule: PayoutSchedule, now: Date = new Date()): Date | null {
  if (schedule === "manual") return null;
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (schedule === "monthly_1st") return utcDate(y, m + 1, 1);
  return now.getUTCDate() >= 15 ? utcDate(y, m + 1, 1) : utcDate(y, m, 15);
}
