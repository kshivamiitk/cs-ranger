"use client";

import { useQuery } from "@tanstack/react-query";
import { Database, HardDrive, Loader2, Server, UploadCloud } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api, type StorageBucketUsage } from "@/lib/api";
import { relativeTime } from "@/lib/utils";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export default function AdminStoragePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-storage-overview"],
    queryFn: () => api.admin.storageOverview(),
    refetchInterval: 60_000,
  });

  return (
    <>
      <Navbar variant="admin" />
      <main className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="heading-2">Storage</h1>
            <p className="mt-1 text-sm text-fg-dim">
              Database size, Supabase Storage objects, and creator quota counters.
            </p>
          </div>
          {data?.generatedAt && <p className="text-xs text-fg-dim">Updated {relativeTime(data.generatedAt)}</p>}
        </div>

        {isLoading ? (
          <div className="mt-12 flex justify-center text-fg-dim"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : data ? (
          <>
            <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StorageKpi icon={<Database className="h-5 w-5 text-brand" />} label="Postgres database" value={formatBytes(data.databaseBytes)} sub="pg_database_size" />
              <StorageKpi icon={<HardDrive className="h-5 w-5 text-success" />} label="Supabase Storage" value={formatBytes(data.supabaseStorageBytes)} sub={`${data.supabaseStorageObjects} objects`} />
              <StorageKpi icon={<UploadCloud className="h-5 w-5 text-brand-accent" />} label="Tracked uploads" value={formatBytes(data.trackedUploadBytes)} sub={`${data.trackedUploadObjects} app records`} />
              <StorageKpi icon={<Server className="h-5 w-5 text-amber-400" />} label="Creator billable" value={formatBytes(data.creatorStorageBytes)} sub={`${formatBytes(data.staticWebsiteBytes)} static sites`} />
            </section>

            <section className="mt-8 grid gap-6 lg:grid-cols-2">
              <BucketTable title="Supabase Storage by bucket" items={data.supabaseStorageByBucket} empty="No Supabase Storage objects found." />
              <BucketTable title="Tracked uploads by bucket" items={data.trackedUploadByBucket} empty="No uploaded_assets rows found." />
            </section>

            <section className="mt-8 card">
              <h2 className="heading-3">Creator storage counters</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <Metric label="Used by creators" value={formatBytes(data.creatorStorageBytes)} />
                <Metric label="Pending uploads" value={formatBytes(data.pendingUploadBytes)} />
                <Metric label="Active purchased quota" value={formatBytes(data.activePurchasedBytes)} />
              </div>
              <p className="mt-4 text-xs text-fg-dim">
                Creator billable usage includes PDFs, attachments, rich images, and static-site payloads tracked by the app. Supabase Storage excludes static-site JSON stored in Postgres.
              </p>
            </section>
          </>
        ) : (
          <div className="mt-8 card text-sm text-fg-dim">Storage overview is unavailable.</div>
        )}
      </main>
      <Footer />
    </>
  );
}

function StorageKpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2">{icon}</span>
        <span className="text-xs text-fg-dim">{sub}</span>
      </div>
      <p className="mt-4 font-display text-2xl font-bold">{value}</p>
      <p className="text-xs uppercase tracking-widest text-fg-dim">{label}</p>
    </div>
  );
}

function BucketTable({ title, items, empty }: { title: string; items: StorageBucketUsage[]; empty: string }) {
  return (
    <div className="card">
      <h2 className="heading-3">{title}</h2>
      <div className="mt-4 overflow-hidden rounded-xl border border-border">
        {(items || []).length === 0 ? (
          <p className="p-4 text-sm text-fg-dim">{empty}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-widest text-fg-dim">
              <tr><th className="p-3">Bucket</th><th className="p-3 text-right">Objects</th><th className="p-3 text-right">Size</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((b) => (
                <tr key={b.bucket}>
                  <td className="p-3 font-medium">{b.bucket}</td>
                  <td className="p-3 text-right text-fg-dim">{b.objects}</td>
                  <td className="p-3 text-right">{formatBytes(b.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-4">
      <p className="text-xs uppercase tracking-widest text-fg-dim">{label}</p>
      <p className="mt-2 font-display text-xl font-bold">{value}</p>
    </div>
  );
}
