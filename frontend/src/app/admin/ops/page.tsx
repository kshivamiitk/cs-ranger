"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Database, Loader2, RefreshCw, Server, Zap } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api, type OpsDependencyHealth, type OpsServiceReport } from "@/lib/api";

function formatUptime(totalSeconds?: number): string {
  if (totalSeconds === undefined) return "—";
  const d = Math.floor(totalSeconds / 86_400);
  const h = Math.floor((totalSeconds % 86_400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${totalSeconds % 60}s`;
}

const BUCKET_LABELS: { key: string; label: string }[] = [
  { key: "lt50ms", label: "<50ms" },
  { key: "lt200ms", label: "<200ms" },
  { key: "lt1000ms", label: "<1s" },
  { key: "gte1000ms", label: "≥1s" },
];

export default function AdminOpsPage() {
  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["admin-ops"],
    queryFn: () => api.admin.ops(),
    refetchInterval: 30_000,
  });

  const services = data?.services || [];
  const upCount = services.filter((s) => s.reachable && s.status === "ok").length;
  const degradedCount = services.filter((s) => s.reachable && s.status === "degraded").length;
  const downCount = services.filter((s) => !s.reachable || s.status === "down").length;

  return (
    <>
      <Navbar variant="admin" />
      <main className="mx-auto max-w-7xl px-4 py-10 md:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2"><Activity className="h-5 w-5" /></span>
            <div>
              <h1 className="heading-2">Ops</h1>
              <p className="text-sm text-fg-dim">Per-service health, dependency connectivity and request metrics since last restart.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {dataUpdatedAt > 0 && (
              <span className="text-xs text-fg-dim">Updated {new Date(dataUpdatedAt).toLocaleTimeString()}</span>
            )}
            <button onClick={() => refetch()} disabled={isFetching} className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-50">
              {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16 text-fg-dim"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : isError ? (
          <div className="card text-center text-sm">
            <p className="text-danger">Could not load the ops report{error instanceof Error ? ` — ${error.message}` : ""}.</p>
            <p className="mt-1 text-xs text-fg-dim">The API gateway may be down, or this account may not have admin access.</p>
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
              <span className="chip border-success/30 text-success">{upCount} healthy</span>
              {degradedCount > 0 && <span className="chip border-warning/30 text-warning">{degradedCount} degraded</span>}
              {downCount > 0 && <span className="chip border-danger/30 text-danger">{downCount} down</span>}
              <span className="chip border-border text-fg-dim">Gateway up {formatUptime(data?.gateway.uptimeSeconds)}</span>
              <span className="ml-auto text-fg-dim">Counters reset when a service restarts.</span>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {services.map((s) => <ServiceCard key={s.name} service={s} />)}
            </div>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}

function ServiceCard({ service: s }: { service: OpsServiceReport }) {
  const status = !s.reachable ? "down" : s.status || "ok";
  const statusClass = status === "ok"
    ? "border-success/30 text-success"
    : status === "degraded"
      ? "border-warning/30 text-warning"
      : "border-danger/30 text-danger";
  const m = s.metrics;
  const bucketTotal = m ? Math.max(1, Object.values(m.latencyBuckets).reduce((a, b) => a + b, 0)) : 1;

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-display text-sm font-semibold">
          <Server className="h-4 w-4 text-fg-dim" /> {s.name}
          <span className="font-mono text-[10px] text-fg-dim">:{s.port}</span>
        </p>
        <span className={`chip ${statusClass}`}>{status}</span>
      </div>

      {!s.reachable ? (
        <p className="mt-3 text-sm text-fg-dim">Service did not respond — check that it is running.</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <Stat label="Uptime" value={formatUptime(s.uptimeSeconds)} />
            <Stat label="Requests" value={m ? String(m.requestsTotal) : "—"} />
            <Stat label="Avg latency" value={m ? `${m.avgLatencyMs}ms` : "—"} />
          </div>

          {m && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-[11px] text-fg-dim">
                <span>Latency distribution</span>
                <span>{m.errors4xx} × 4xx · <span className={m.errors5xx > 0 ? "text-danger" : ""}>{m.errors5xx} × 5xx</span></span>
              </div>
              <div className="mt-1.5 space-y-1">
                {BUCKET_LABELS.map((b) => {
                  const count = m.latencyBuckets[b.key] ?? 0;
                  const pct = Math.round((count / bucketTotal) * 100);
                  return (
                    <div key={b.key} className="flex items-center gap-2 text-[11px]">
                      <span className="w-12 shrink-0 text-fg-dim">{b.label}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-8 shrink-0 text-right tabular-nums text-fg-dim">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {s.connectivity && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              <DependencyChip icon={<Database className="h-3 w-3" />} label="Supabase" health={s.connectivity.supabase} />
              <DependencyChip icon={<Zap className="h-3 w-3" />} label="Redis" health={s.connectivity.redis} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2/60 px-2 py-1.5">
      <p className="font-semibold tabular-nums">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-fg-dim">{label}</p>
    </div>
  );
}

function DependencyChip({ icon, label, health }: { icon: React.ReactNode; label: string; health: OpsDependencyHealth }) {
  const cls = !health.configured
    ? "border-border text-fg-dim"
    : health.ok
      ? "border-success/30 text-success"
      : "border-danger/30 text-danger";
  const text = !health.configured ? "not configured" : health.ok ? `ok${health.latencyMs !== undefined ? ` · ${health.latencyMs}ms` : ""}` : "failing";
  return (
    <span className={`chip ${cls}`} title={health.error || undefined}>
      {icon} {label}: {text}
    </span>
  );
}
