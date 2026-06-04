"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type PublicSettings = {
  commissionRate: number;
  commissionPercent: number;
  creatorSharePercent: number;
  tdsRate: number;
  tdsPercent: number;
  minPayoutInr: number;
  refundWindowDays: number;
  siteName: string;
};

// Pre-load fallback: matches the backend's PLATFORM_COMMISSION_RATE default so
// there's no layout flash before the live value loads. The real value (which is
// what actually charges creators) replaces this within one fetch.
const FALLBACK: PublicSettings = {
  commissionRate: 0.15,
  commissionPercent: 15,
  creatorSharePercent: 85,
  tdsRate: 0.1,
  tdsPercent: 10,
  minPayoutInr: 500,
  refundWindowDays: 7,
  siteName: "LearnRift",
};

/**
 * Live platform rates (commission %, creator share %, TDS %, payout threshold).
 * Cached 5 min — these change rarely. Returns the fallback until the first fetch
 * resolves so consumers can render a number immediately.
 */
export function usePublicSettings(): PublicSettings {
  const { data } = useQuery({
    queryKey: ["public-settings"],
    queryFn: () => api.users.publicSettings(),
    staleTime: 5 * 60 * 1000,
  });
  return data ?? FALLBACK;
}
