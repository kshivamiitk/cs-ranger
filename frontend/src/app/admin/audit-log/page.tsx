"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RefreshCw, ScrollText } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { Avatar } from "@/components/common/Avatar";
import { api, type AuditLogEntry } from "@/lib/api";

const ACTION_OPTIONS = [
  { value: "", label: "All actions" },
  { value: "course.approve", label: "Course approved" },
  { value: "course.reject", label: "Course rejected" },
  { value: "settings.update", label: "Settings changed" },
  { value: "commission.update", label: "Commission changed" },
  { value: "terms.update", label: "Creator terms updated" },
  { value: "user.suspend", label: "User suspended" },
  { value: "user.unsuspend", label: "User unsuspended" },
  { value: "user.grant_creator", label: "Creator role granted" },
  { value: "user.revoke_creator", label: "Creator role revoked" },
  { value: "user.admin_grant_requested", label: "Admin grant requested" },
  { value: "user.grant_admin", label: "Admin role granted" },
  { value: "payout.bulk", label: "Bulk payout initiated" },
  { value: "payout.manual", label: "Manual payout" },
  { value: "payout.retry", label: "Payout retried" },
];

function actionLabel(action: string) {
  return ACTION_OPTIONS.find((o) => o.value === action)?.label || action;
}

export default function AdminAuditLogPage() {
  const [page, setPage] = useState(1);
  const [actionType, setActionType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const pageSize = 25;

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-audit-log", { page, pageSize, actionType, dateFrom, dateTo }],
    queryFn: () => api.admin.auditLog({
      page,
      pageSize,
      actionType: actionType || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
    placeholderData: keepPreviousData,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  function setFilter(update: () => void) {
    update();
    setPage(1);
  }

  return (
    <>
      <Navbar variant="admin" />
      <main className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2"><ScrollText className="h-5 w-5" /></span>
          <div>
            <h1 className="heading-2">Audit Log</h1>
            <p className="mt-1 text-sm text-fg-dim">Immutable record of every admin action. Append-only, enforced by Postgres triggers.</p>
          </div>
        </div>

        <div className="mt-6 card flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-fg-dim">Action type</span>
            <select value={actionType} onChange={(e) => setFilter(() => setActionType(e.target.value))} className="input w-56">
              {ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-fg-dim">From</span>
            <input type="date" value={dateFrom} onChange={(e) => setFilter(() => setDateFrom(e.target.value))} className="input w-40" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-fg-dim">To</span>
            <input type="date" value={dateTo} onChange={(e) => setFilter(() => setDateTo(e.target.value))} className="input w-40" />
          </label>
          {(actionType || dateFrom || dateTo) && (
            <button onClick={() => setFilter(() => { setActionType(""); setDateFrom(""); setDateTo(""); })} className="btn-ghost text-xs">
              Clear filters
            </button>
          )}
          <span className="ml-auto text-xs text-fg-dim">{data ? `${data.total} entries` : ""}{isFetching && !isLoading ? " · refreshing…" : ""}</span>
        </div>

        <div className="mt-4 card overflow-x-auto p-0">
          {isLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex animate-pulse items-center gap-4 p-4">
                  <div className="h-7 w-7 rounded-full bg-surface-2" />
                  <div className="h-3 w-40 rounded bg-surface-2" />
                  <div className="h-3 w-28 rounded bg-surface-2" />
                  <div className="ml-auto h-3 w-24 rounded bg-surface-2" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="p-8 text-center text-sm">
              <p className="font-medium text-danger">Could not load the audit log</p>
              <p className="mt-1 text-fg-dim">{error instanceof Error ? error.message : "Unknown error"}</p>
              <button onClick={() => refetch()} className="btn-ghost mx-auto mt-4 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Retry</button>
            </div>
          ) : (data?.items.length ?? 0) === 0 ? (
            <div className="p-8 text-center text-sm text-fg-dim">
              <p>No audit entries match these filters.</p>
              <p className="mt-1 text-xs">Entries appear as admins approve courses, change settings, manage users and initiate payouts.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-widest text-fg-dim">
                <tr>
                  <th className="p-3">Timestamp</th>
                  <th className="p-3">Admin</th>
                  <th className="p-3">Action</th>
                  <th className="p-3">Target</th>
                  <th className="p-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody>
                {data!.items.map((entry) => <AuditRow key={entry.id} entry={entry} />)}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-xs text-fg-dim">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-50">
              <ChevronLeft className="h-3.5 w-3.5" /> Previous
            </button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-50">
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

function AuditRow({ entry }: { entry: AuditLogEntry }) {
  const [open, setOpen] = useState(false);
  const adminName = entry.admin?.profiles?.display_name || entry.admin?.email || entry.admin_id.slice(0, 8);
  const hasDetails = entry.metadata && Object.keys(entry.metadata).length > 0;

  return (
    <>
      <tr className="border-t border-border align-top">
        <td className="whitespace-nowrap p-3 text-fg-dim">
          <div>{new Date(entry.created_at).toLocaleDateString()}</div>
          <div className="text-xs">{new Date(entry.created_at).toLocaleTimeString()}</div>
        </td>
        <td className="p-3">
          <div className="flex items-center gap-2">
            <Avatar name={adminName} src={entry.admin?.profiles?.avatar_url} size={24} />
            <div className="min-w-0">
              <p className="truncate font-medium">{adminName}</p>
              {entry.admin?.email && <p className="truncate text-xs text-fg-dim">{entry.admin.email}</p>}
            </div>
          </div>
        </td>
        <td className="p-3">
          <span className="chip">{actionLabel(entry.action)}</span>
        </td>
        <td className="p-3 text-fg-dim">
          {entry.target_type ? (
            <>
              <span className="capitalize">{entry.target_type.replace("_", " ")}</span>
              {entry.target_id && (
                <span className="ml-1 font-mono text-xs">
                  {entry.target_id.length > 14 ? `${entry.target_id.slice(0, 8)}…` : entry.target_id}
                </span>
              )}
            </>
          ) : "—"}
        </td>
        <td className="p-3 text-right">
          {hasDetails ? (
            <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-xs text-brand">
              {open ? <>Hide <ChevronUp className="h-3 w-3" /></> : <>View <ChevronDown className="h-3 w-3" /></>}
            </button>
          ) : <span className="text-xs text-fg-dim">—</span>}
        </td>
      </tr>
      {open && hasDetails && (
        <tr className="border-t border-border/50 bg-surface-2/40">
          <td colSpan={5} className="p-3">
            <pre className="max-h-64 overflow-auto rounded-xl border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed">
              {JSON.stringify(entry.metadata, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}
