import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api";

// Warm the React Query caches that a role's landing page reads, so switching into
// that role renders instantly from cache instead of waiting on a fresh round trip
// to the (remote) database. Keys/fns MUST match those used by the pages:
//   learner  → app/home/page.tsx
//   creator  → app/creator/overview/page.tsx
// staleTime is set so repeated hovers don't refire while the data is still fresh.

const WARM = 60_000;

export function prefetchLearnerDashboard(qc: QueryClient, userId?: string) {
  qc.prefetchQuery({ queryKey: ["my-enrollments", userId], queryFn: () => api.enrollments.list(), staleTime: WARM });
  qc.prefetchQuery({ queryKey: ["recommended"], queryFn: () => api.search.courses({ sort: "popular", limit: 8 }), staleTime: WARM });
  if (userId) qc.prefetchQuery({ queryKey: ["achievements-summary", userId], queryFn: () => api.achievements.summary(userId), staleTime: WARM });
}

export function prefetchCreatorDashboard(qc: QueryClient, creatorId?: string) {
  if (!creatorId) return;
  qc.prefetchQuery({ queryKey: ["creator-overview", creatorId], queryFn: () => api.analytics.creatorOverview(creatorId), staleTime: WARM });
  qc.prefetchQuery({ queryKey: ["balance", creatorId], queryFn: () => api.wallet.balance(creatorId), staleTime: WARM });
  qc.prefetchQuery({ queryKey: ["creator-courses", creatorId], queryFn: () => api.courses.mine(), staleTime: WARM });
}
