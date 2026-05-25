"use client";

import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, ChevronLeft, ChevronRight, Loader2, RefreshCw, ShieldCheck, UserCheck, UserMinus, UserPlus, X } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { Avatar } from "@/components/common/Avatar";
import { api, type AdminUser } from "@/lib/api";
import { useDebouncedValue } from "@/lib/hooks";

type ManageAction = "suspend" | "unsuspend" | "grant-creator" | "revoke-creator" | "request-admin";

const ACTION_COPY: Record<ManageAction, { title: string; confirm: string; destructive?: boolean; minReason: number; description: string }> = {
  "suspend": { title: "Suspend account", confirm: "Confirm suspension", destructive: true, minReason: 10, description: "The user is logged out everywhere, cannot sign in, and their payouts go on hold. The reason is recorded in the audit log." },
  "unsuspend": { title: "Unsuspend account", confirm: "Confirm unsuspension", minReason: 10, description: "Restores login access immediately. The reason is recorded in the audit log." },
  "grant-creator": { title: "Grant creator role", confirm: "Grant creator", minReason: 10, description: "Lets this user publish courses without going through the standard onboarding flow." },
  "revoke-creator": { title: "Revoke creator role", confirm: "Revoke creator", destructive: true, minReason: 10, description: "Removes the creator role. Published courses stay live but the user loses access to the creator dashboard." },
  "request-admin": { title: "Request admin role", confirm: "File admin request", minReason: 20, description: "Files a request that a different admin must approve (two-person rule). Nothing changes until it is approved." },
};

export default function AdminUsersPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 350);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pageSize = 20;

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-users", { page, pageSize, role, status, q: debouncedSearch }],
    queryFn: () => api.admin.users({
      page,
      pageSize,
      role: role || undefined,
      status: status || undefined,
      q: debouncedSearch || undefined,
    }),
    placeholderData: keepPreviousData,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const selectedUser = selectedId ? data?.items.find((u) => u.user_id === selectedId) ?? null : null;

  function setFilter(update: () => void) {
    update();
    setPage(1);
  }

  return (
    <>
      <Navbar variant="admin" />
      <main className="mx-auto max-w-7xl px-4 py-10 md:px-6">
        <h1 className="heading-2">Users</h1>
        <p className="mt-1 text-sm text-fg-dim">{data ? `${data.total} accounts` : "Manage roles, suspensions and admin access."}</p>

        <div className="mt-4 mb-4 flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setFilter(() => setSearch(e.target.value))}
            placeholder="Search by name or username…"
            className="input max-w-sm"
          />
          <select value={role} onChange={(e) => setFilter(() => setRole(e.target.value))} className="input w-40">
            <option value="">All roles</option>
            <option value="learner">Learner</option>
            <option value="creator">Creator</option>
            <option value="admin">Admin</option>
          </select>
          <select value={status} onChange={(e) => setFilter(() => setStatus(e.target.value))} className="input w-44">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="unverified">Pending verification</option>
          </select>
          {isFetching && !isLoading && <Loader2 className="h-4 w-4 animate-spin text-fg-dim" />}
        </div>

        <div className="card overflow-x-auto p-0">
          {isLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex animate-pulse items-center gap-4 p-4">
                  <div className="h-7 w-7 rounded-full bg-surface-2" />
                  <div className="h-3 w-48 rounded bg-surface-2" />
                  <div className="h-3 w-24 rounded bg-surface-2" />
                  <div className="ml-auto h-3 w-16 rounded bg-surface-2" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="p-8 text-center text-sm">
              <p className="font-medium text-danger">Could not load users</p>
              <p className="mt-1 text-fg-dim">{error instanceof Error ? error.message : "Unknown error"}</p>
              <button onClick={() => refetch()} className="btn-ghost mx-auto mt-4 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Retry</button>
            </div>
          ) : (data?.items.length ?? 0) === 0 ? (
            <p className="p-8 text-center text-sm text-fg-dim">No users match these filters.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-widest text-fg-dim">
                <tr>
                  <th className="p-3">User</th>
                  <th className="p-3">Roles</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">KYC</th>
                  <th className="p-3">Joined</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {data!.items.map((u) => (
                  <tr key={u.user_id} className="border-t border-border">
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.display_name} src={u.avatar_url || undefined} size={28} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{u.display_name}</p>
                          <p className="truncate text-xs text-fg-dim">@{u.username} · {u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r) => <span key={r} className="chip capitalize">{r}</span>)}
                      </div>
                    </td>
                    <td className="p-3"><StatusChip user={u} /></td>
                    <td className="p-3">
                      {u.kyc_status
                        ? <span className={`chip ${u.kyc_status === "approved" ? "border-success/30 text-success" : "border-warning/30 text-warning"}`}>{u.kyc_status}</span>
                        : <span className="text-xs text-fg-dim">—</span>}
                    </td>
                    <td className="p-3 text-fg-dim">{new Date(u.joined_at).toLocaleDateString()}</td>
                    <td className="p-3 text-right">
                      <button onClick={() => setSelectedId(u.user_id)} className="text-xs text-brand">Manage</button>
                    </td>
                  </tr>
                ))}
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

        {selectedUser && (
          <ManageModal
            user={selectedUser}
            onClose={() => setSelectedId(null)}
            onChanged={() => qc.invalidateQueries({ queryKey: ["admin-users"] })}
          />
        )}
      </main>
      <Footer />
    </>
  );
}

function StatusChip({ user }: { user: AdminUser }) {
  if (user.is_suspended) return <span className="chip border-danger/30 text-danger">Suspended</span>;
  if (!user.is_verified) return <span className="chip border-warning/30 text-warning">Pending verification</span>;
  return <span className="chip border-success/30 text-success">Active</span>;
}

function ManageModal({ user, onClose, onChanged }: { user: AdminUser; onClose: () => void; onChanged: () => void }) {
  const [action, setAction] = useState<ManageAction | null>(null);
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const mutate = useMutation({
    mutationFn: async (a: ManageAction) => {
      switch (a) {
        case "suspend": return api.admin.suspendUser(user.user_id, reason);
        case "unsuspend": return api.admin.unsuspendUser(user.user_id, reason);
        case "grant-creator": return api.admin.grantCreator(user.user_id, reason);
        case "revoke-creator": return api.admin.revokeCreator(user.user_id, reason, override);
        case "request-admin": return api.admin.requestAdmin(user.user_id, reason);
      }
    },
    onSuccess: (_data, a) => {
      setSuccess(`${ACTION_COPY[a].title} — done.`);
      setAction(null);
      setReason("");
      setOverride(false);
      onChanged();
    },
  });

  const isCreator = user.roles.includes("creator");
  const isAdmin = user.roles.includes("admin");
  const copy = action ? ACTION_COPY[action] : null;
  const reasonTooShort = copy ? reason.trim().length < copy.minReason : true;

  function startAction(a: ManageAction) {
    setAction(a);
    setReason("");
    setOverride(false);
    setSuccess(null);
    mutate.reset();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl glass-strong p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar name={user.display_name} src={user.avatar_url || undefined} size={44} />
            <div>
              <h3 className="heading-3">{user.display_name}</h3>
              <p className="text-xs text-fg-dim">@{user.username} · {user.email}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1 text-fg-dim hover:bg-surface-2 hover:text-fg"><X className="h-4 w-4" /></button>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Detail label="Roles">
            <div className="flex flex-wrap gap-1">{user.roles.map((r) => <span key={r} className="chip capitalize">{r}</span>)}</div>
          </Detail>
          <Detail label="Status"><StatusChip user={user} /></Detail>
          <Detail label="Email verified">{user.is_verified ? "Yes" : "No"}</Detail>
          <Detail label="KYC">{user.kyc_status || "Not submitted"}</Detail>
          <Detail label="Joined">{new Date(user.joined_at).toLocaleDateString()}</Detail>
          <Detail label="Last login">{user.last_login_at ? new Date(user.last_login_at).toLocaleString() : "Never"}</Detail>
          {user.is_suspended && (
            <Detail label="Suspension reason" wide>{user.suspension_reason || "—"}</Detail>
          )}
        </dl>

        {success && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 p-3 text-sm">
            <Check className="h-4 w-4 text-success" /> {success}
          </div>
        )}
        {mutate.isError && !action && (
          <div className="mt-4 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {mutate.error instanceof Error ? mutate.error.message : "Action failed"}
          </div>
        )}

        {!action ? (
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {!user.is_suspended && !isAdmin && (
              <ActionButton icon={<Ban className="h-4 w-4" />} label="Suspend" destructive onClick={() => startAction("suspend")} />
            )}
            {user.is_suspended && (
              <ActionButton icon={<UserCheck className="h-4 w-4" />} label="Unsuspend" onClick={() => startAction("unsuspend")} />
            )}
            {!isCreator && (
              <ActionButton icon={<UserPlus className="h-4 w-4" />} label="Grant Creator" onClick={() => startAction("grant-creator")} />
            )}
            {isCreator && !isAdmin && (
              <ActionButton icon={<UserMinus className="h-4 w-4" />} label="Revoke Creator" destructive onClick={() => startAction("revoke-creator")} />
            )}
            {!isAdmin && (
              <ActionButton icon={<ShieldCheck className="h-4 w-4" />} label="Request Admin" onClick={() => startAction("request-admin")} />
            )}
            {isAdmin && (
              <p className="col-span-full text-xs text-fg-dim">Admin accounts can only be modified directly in the database or via the two-person admin request flow.</p>
            )}
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-border bg-surface-2/60 p-4">
            <h4 className="font-display text-sm font-semibold">{copy!.title}</h4>
            <p className="mt-1 text-xs text-fg-dim">{copy!.description}</p>
            <label className="mt-3 block">
              <span className="mb-1.5 block text-xs font-medium text-fg-dim">Reason (min {copy!.minReason} characters, recorded in the audit log)</span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="input min-h-[72px]" placeholder="Why are you taking this action?" />
            </label>
            {action === "revoke-creator" && (
              <label className="mt-2 flex items-center gap-2 text-xs text-fg-dim">
                <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--brand-primary)]" />
                Override the pending-balance check (revoke even if the creator still has unpaid earnings)
              </label>
            )}
            {mutate.isError && (
              <p className="mt-3 text-xs text-danger">{mutate.error instanceof Error ? mutate.error.message : "Action failed"}</p>
            )}
            <div className="mt-4 flex gap-2">
              <button onClick={() => { setAction(null); mutate.reset(); }} className="btn-ghost flex-1 text-sm" disabled={mutate.isPending}>Cancel</button>
              <button
                onClick={() => mutate.mutate(action)}
                disabled={reasonTooShort || mutate.isPending}
                className={`flex-1 text-sm ${copy!.destructive ? "inline-flex items-center justify-center gap-2 rounded-full border border-danger/40 px-5 py-2.5 font-medium text-danger transition hover:bg-danger/10 disabled:opacity-50" : "btn-primary disabled:opacity-50"}`}
              >
                {mutate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {copy!.confirm}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Detail({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-xs uppercase tracking-widest text-fg-dim">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

function ActionButton({ icon, label, onClick, destructive }: { icon: React.ReactNode; label: string; onClick: () => void; destructive?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
        destructive ? "border-danger/40 text-danger hover:bg-danger/10" : "border-border bg-surface-2 hover:border-brand"
      }`}
    >
      {icon} {label}
    </button>
  );
}
