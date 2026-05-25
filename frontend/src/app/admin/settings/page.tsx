"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api, type PlatformSettings } from "@/lib/api";
import { relativeTime } from "@/lib/utils";

type FormState = {
  site_name: string;
  commission_percent: string;
  min_payout_inr: string;
  refund_window_days: string;
  tds_threshold_inr: string;
  tds_percent: string;
  refund_auto_approval: boolean;
  creator_terms_version: string;
  payout_schedule: PlatformSettings["payout_schedule"];
  feature_flags: Record<string, boolean>;
};

function toForm(s: PlatformSettings): FormState {
  return {
    site_name: s.site_name ?? "",
    commission_percent: String(Math.round((s.commission_rate ?? 0) * 10000) / 100),
    min_payout_inr: String(s.min_payout_inr ?? 0),
    refund_window_days: String(s.refund_window_days ?? 0),
    tds_threshold_inr: String(s.tds_threshold_inr ?? 0),
    tds_percent: String(Math.round((s.tds_rate ?? 0) * 10000) / 100),
    refund_auto_approval: !!s.refund_auto_approval,
    creator_terms_version: s.creator_terms_version ?? "",
    payout_schedule: s.payout_schedule ?? "manual",
    feature_flags: { ...(s.feature_flags || {}) },
  };
}

function toPatch(form: FormState, original: PlatformSettings): Partial<PlatformSettings> {
  const next: PlatformSettings = {
    site_name: form.site_name.trim(),
    commission_rate: Number(form.commission_percent) / 100,
    min_payout_inr: Number(form.min_payout_inr),
    refund_window_days: Number(form.refund_window_days),
    tds_threshold_inr: Number(form.tds_threshold_inr),
    tds_rate: Number(form.tds_percent) / 100,
    refund_auto_approval: form.refund_auto_approval,
    creator_terms_version: form.creator_terms_version.trim(),
    payout_schedule: form.payout_schedule,
    feature_flags: form.feature_flags,
  };
  // Only send keys that actually changed — keeps updated_at/updated_by and the audit log honest.
  const patch: Partial<PlatformSettings> = {};
  for (const key of Object.keys(next) as (keyof PlatformSettings)[]) {
    if (JSON.stringify(next[key]) !== JSON.stringify(original[key])) {
      (patch as Record<string, unknown>)[key] = next[key];
    }
  }
  return patch;
}

export default function AdminSettingsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);
  const [newFlag, setNewFlag] = useState("");
  const [saved, setSaved] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["platform-settings"],
    queryFn: () => api.admin.platformSettings(),
  });

  const settings = data?.settings;
  const lastUpdatedAt = useMemo(() => {
    const dates = (data?.rows || []).map((r) => r.updated_at).filter(Boolean) as string[];
    return dates.length ? dates.sort().at(-1) : null;
  }, [data]);

  // Initialise the editable form once the settings arrive (and after each successful save).
  if (settings && form === null) setForm(toForm(settings));

  const save = useMutation({
    mutationFn: (patch: Partial<PlatformSettings>) => api.admin.updatePlatformSettings(patch),
    onSuccess: (resp) => {
      // Re-derive the form from the saved settings returned by the API, then
      // refresh the cached query so other pages (e.g. /admin/payouts) update too.
      setForm(toForm(resp.settings));
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["platform-settings"] });
      setTimeout(() => setSaved(false), 4000);
    },
  });

  const patch = form && settings ? toPatch(form, settings) : {};
  const dirty = Object.keys(patch).length > 0;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setSaved(false);
  }

  return (
    <>
      <Navbar variant="admin" />
      <main className="mx-auto max-w-3xl px-4 py-10 md:px-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="heading-2">Platform Settings</h1>
            <p className="mt-1 text-sm text-fg-dim">Global configuration, stored in the database. Every change is audited.</p>
          </div>
          {lastUpdatedAt && <p className="text-xs text-fg-dim">Last updated {relativeTime(lastUpdatedAt)}</p>}
        </div>

        {isLoading && (
          <div className="mt-6 space-y-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card animate-pulse">
                <div className="h-4 w-32 rounded bg-surface-2" />
                <div className="mt-4 h-10 rounded-xl bg-surface-2" />
                <div className="mt-3 h-10 rounded-xl bg-surface-2" />
              </div>
            ))}
          </div>
        )}

        {isError && (
          <div className="mt-6 card border-danger/30 text-sm">
            <p className="font-medium text-danger">Could not load settings</p>
            <p className="mt-1 text-fg-dim">{error instanceof Error ? error.message : "Unknown error"}</p>
            <button onClick={() => refetch()} className="btn-ghost mt-4 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Retry</button>
          </div>
        )}

        {form && settings && (
          <div className="mt-6 space-y-6">
            <Section title="Site identity">
              <Field label="Site name" value={form.site_name} onChange={(v) => set("site_name", v)} />
            </Section>

            <Section title="Monetization & payouts">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Commission rate (%)" type="number" value={form.commission_percent} onChange={(v) => set("commission_percent", v)} hint="Applies to new enrollments only." />
                <Field label="Minimum payout (INR)" type="number" value={form.min_payout_inr} onChange={(v) => set("min_payout_inr", v)} />
              </div>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-fg-dim">Payout schedule</span>
                <select
                  value={form.payout_schedule}
                  onChange={(e) => set("payout_schedule", e.target.value as FormState["payout_schedule"])}
                  className="input"
                >
                  <option value="manual">Manual — admin initiates each run</option>
                  <option value="monthly_1st">Automatic — 1st of each month</option>
                  <option value="monthly_1st_15th">Automatic — 1st & 15th of each month</option>
                </select>
              </label>
            </Section>

            <Section title="Refunds & tax">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Refund window (days)" type="number" value={form.refund_window_days} onChange={(v) => set("refund_window_days", v)} />
                <Field label="TDS threshold (INR / year)" type="number" value={form.tds_threshold_inr} onChange={(v) => set("tds_threshold_inr", v)} />
                <Field label="TDS rate (%)" type="number" value={form.tds_percent} onChange={(v) => set("tds_percent", v)} />
              </div>
              <Toggle
                label="Refund auto-approval"
                description="Automatically approve refund requests made inside the refund window."
                checked={form.refund_auto_approval}
                onChange={(v) => set("refund_auto_approval", v)}
              />
            </Section>

            <Section title="Creator terms">
              <Field
                label="Creator T&C version"
                value={form.creator_terms_version}
                onChange={(v) => set("creator_terms_version", v)}
                hint="Bumping the version requires every creator to re-accept the terms before their next submission."
              />
            </Section>

            <Section title="Feature flags">
              {Object.keys(form.feature_flags).length === 0 && (
                <p className="text-sm text-fg-dim">No feature flags yet. Add one below to soft-launch a feature without a deploy.</p>
              )}
              <div className="space-y-2">
                {Object.entries(form.feature_flags).map(([flag, enabled]) => (
                  <div key={flag} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 px-4 py-2.5">
                    <span className="font-mono text-xs">{flag}</span>
                    <div className="flex items-center gap-2">
                      <Toggle compact label="" checked={enabled} onChange={(v) => set("feature_flags", { ...form.feature_flags, [flag]: v })} />
                      <button
                        aria-label={`Remove ${flag}`}
                        onClick={() => {
                          const next = { ...form.feature_flags };
                          delete next[flag];
                          set("feature_flags", next);
                        }}
                        className="text-fg-dim hover:text-danger"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={newFlag}
                  onChange={(e) => setNewFlag(e.target.value)}
                  placeholder="new_flag_name"
                  className="input font-mono text-xs"
                />
                <button
                  onClick={() => {
                    const name = newFlag.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
                    if (!name) return;
                    set("feature_flags", { ...form.feature_flags, [name]: false });
                    setNewFlag("");
                  }}
                  className="btn-ghost shrink-0 text-xs"
                >
                  <Plus className="h-3.5 w-3.5" /> Add flag
                </button>
              </div>
            </Section>

            {save.isError && (
              <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm">
                <p className="font-medium text-danger">Save failed</p>
                <p className="mt-1 text-fg-dim">{save.error instanceof Error ? save.error.message : "Unknown error"}</p>
              </div>
            )}
            {saved && !dirty && (
              <div className="flex items-center gap-2 rounded-2xl border border-success/30 bg-success/10 p-4 text-sm">
                <Check className="h-4 w-4 text-success" /> Settings saved. Changes are recorded in the audit log.
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button onClick={() => { setForm(toForm(settings)); setSaved(false); }} disabled={!dirty || save.isPending} className="btn-ghost disabled:opacity-50">
                Cancel
              </button>
              <button onClick={() => save.mutate(patch)} disabled={!dirty || save.isPending} className="btn-primary disabled:opacity-50">
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {save.isPending ? "Saving…" : `Save changes${dirty ? ` (${Object.keys(patch).length})` : ""}`}
              </button>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h2 className="mb-4 font-display font-semibold">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", hint }: { label: string; value: string; onChange: (v: string) => void; type?: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-fg-dim">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="input" />
      {hint && <span className="mt-1 block text-xs text-fg-dim">{hint}</span>}
    </label>
  );
}

function Toggle({ label, description, checked, onChange, compact }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void; compact?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={compact ? "flex items-center" : "flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3 text-left"}
    >
      {!compact && (
        <span>
          <span className="block text-sm font-medium">{label}</span>
          {description && <span className="mt-0.5 block text-xs text-fg-dim">{description}</span>}
        </span>
      )}
      <span className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${checked ? "bg-brand" : "bg-border"}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
}
