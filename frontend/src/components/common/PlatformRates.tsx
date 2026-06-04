"use client";

import { usePublicSettings } from "@/hooks/usePublicSettings";

/**
 * Inline text helpers that render the live platform rates, so server and client
 * components alike can drop the current commission/creator-share percentage into
 * copy without hardcoding a number. They render just the integer (no "%").
 */
export function CommissionPct() {
  return <>{usePublicSettings().commissionPercent}</>;
}

export function CreatorSharePct() {
  return <>{usePublicSettings().creatorSharePercent}</>;
}
