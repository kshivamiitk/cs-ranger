"use client";

import { queryOptions } from "@tanstack/react-query";
import { api } from "./api";

/**
 * Single source of truth for the current-user/profile fetch.
 *
 * The auth bootstrap in <Providers> primes this query (via queryClient.fetchQuery)
 * and any component that needs the profile (e.g. /profile/edit) reuses the SAME
 * ["me"] cache instead of issuing a duplicate `/users/me` request. The 5-minute
 * staleTime keeps the profile from refetching on every navigation — it only
 * changes on explicit save (which invalidates ["me"]).
 */
export const meQueryOptions = queryOptions({
  queryKey: ["me"] as const,
  queryFn: () => api.users.me(),
  staleTime: 5 * 60_000,
  gcTime: 30 * 60_000,
});
