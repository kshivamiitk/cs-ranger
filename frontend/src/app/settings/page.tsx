"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Monitor, Moon, Sun, UserRound } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api } from "@/lib/api";
import { useApp } from "@/app/providers";

const NOTIF_EVENTS: { key: string; label: string }[] = [
  { key: "doubt_replies", label: "New reply to my doubt" },
  { key: "course_updates", label: "Updates from courses I'm enrolled in" },
  { key: "new_courses", label: "New course from a creator I follow" },
  { key: "payouts", label: "Payout processed" },
  { key: "support", label: "Support ticket update" },
  { key: "achievements", label: "Achievement earned" },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<"account" | "notifications" | "privacy" | "appearance">("account");

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-10 md:px-6">
        <h1 className="heading-2">Settings</h1>
        <p className="mt-1 text-sm text-fg-dim">Account-level preferences and security.</p>

        <div className="mt-6 grid gap-6 md:grid-cols-[200px_1fr]">
          <nav className="card h-fit p-2">
            {[
              ["account", "Account"],
              ["notifications", "Notifications"],
              ["privacy", "Privacy"],
              ["appearance", "Appearance"],
            ].map(([k, l]) => (
              <button
                key={k}
                onClick={() => setTab(k as typeof tab)}
                className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition ${tab === k ? "bg-surface-2 font-medium" : "text-fg-dim hover:bg-surface-2"}`}
              >
                {l}
              </button>
            ))}
          </nav>

          <div className="space-y-6">
            {tab === "account" && <AccountTab />}
            {tab === "notifications" && <NotificationsTab />}
            {tab === "privacy" && (
              <Section title="Privacy">
                <p className="text-sm text-fg-dim">
                  Your public profile (<span className="text-fg">/u/username</span>) shows your display name, bio, college, published courses and earned certificates by design — that&apos;s what powers certificate verification and the creators directory.
                  Granular visibility toggles aren&apos;t available yet; if you need something hidden, remove it from your <Link href="/profile/edit" className="text-brand">profile</Link> or contact support.
                </p>
              </Section>
            )}
            {tab === "appearance" && <AppearanceTab />}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

function AccountTab() {
  const { user, logout } = useApp();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [deactivatePassword, setDeactivatePassword] = useState("");
  const [confirmText, setConfirmText] = useState("");

  const changePassword = useMutation({
    mutationFn: () => api.auth.changePassword(currentPassword, newPassword),
    onSuccess: () => { setCurrentPassword(""); setNewPassword(""); },
  });
  const deactivate = useMutation({
    mutationFn: () => api.auth.deactivate(deactivatePassword),
    onSuccess: () => logout(),
  });

  return (
    <>
      <Section title="Profile">
        <p className="text-sm text-fg-dim">Display name, username, bio, college and profile photo live on the profile editor.</p>
        <Link href="/profile/edit" className="btn-ghost mt-3 inline-flex text-sm"><UserRound className="h-4 w-4" /> Edit profile</Link>
      </Section>

      <Section title="Change password">
        <p className="text-xs text-fg-dim">Changing your password signs you out of all other devices. Signed in as {user?.email || "your account"}.</p>
        <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Current password" className="input mt-3" autoComplete="current-password" />
        <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password (8+ chars, mixed case, digit)" className="input mt-3" autoComplete="new-password" />
        {changePassword.isError && <p className="mt-2 text-xs text-danger">{changePassword.error instanceof Error ? changePassword.error.message : "Could not change the password"}</p>}
        {changePassword.isSuccess && <p className="mt-2 flex items-center gap-1 text-xs text-success"><Check className="h-3.5 w-3.5" /> Password updated — other sessions were signed out.</p>}
        <button
          onClick={() => changePassword.mutate()}
          disabled={!currentPassword || newPassword.length < 8 || changePassword.isPending}
          className="btn-primary mt-3 text-sm disabled:opacity-50"
        >
          {changePassword.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update password"}
        </button>
      </Section>

      <Section title="Danger zone" danger>
        <p className="text-sm text-fg-dim">
          Deactivating blocks sign-in immediately and ends every session. Your courses, enrollments and earnings history are kept; contact support to reactivate.
          Creators with a pending balance should request a payout before deactivating.
        </p>
        <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder='Type "DEACTIVATE" to confirm' className="input mt-3" />
        <input type="password" value={deactivatePassword} onChange={(e) => setDeactivatePassword(e.target.value)} placeholder="Your password" className="input mt-3" autoComplete="current-password" />
        {deactivate.isError && <p className="mt-2 text-xs text-danger">{deactivate.error instanceof Error ? deactivate.error.message : "Could not deactivate the account"}</p>}
        <button
          onClick={() => deactivate.mutate()}
          disabled={confirmText !== "DEACTIVATE" || !deactivatePassword || deactivate.isPending}
          className="mt-3 inline-flex items-center gap-2 rounded-full border border-danger/40 px-4 py-1.5 text-sm text-danger transition hover:bg-danger/10 disabled:opacity-50"
        >
          {deactivate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Deactivate account"}
        </button>
      </Section>
    </>
  );
}

function NotificationsTab() {
  const qc = useQueryClient();
  const { data: saved, isLoading } = useQuery({ queryKey: ["notification-preferences"], queryFn: () => api.notifications.preferences() });
  const [prefs, setPrefs] = useState<Record<string, { email: boolean; inapp: boolean }>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!saved || hydrated) return;
    const next: Record<string, { email: boolean; inapp: boolean }> = {};
    for (const e of NOTIF_EVENTS) {
      const row = saved.find((p) => p.event_type === e.key);
      next[e.key] = { email: row?.email_enabled ?? true, inapp: row?.inapp_enabled ?? true };
    }
    setPrefs(next);
    setHydrated(true);
  }, [saved, hydrated]);

  const save = useMutation({
    mutationFn: () => api.notifications.savePreferences(
      NOTIF_EVENTS.map((e) => ({ eventType: e.key, emailEnabled: prefs[e.key]?.email ?? true, inappEnabled: prefs[e.key]?.inapp ?? true })),
    ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-preferences"] }),
  });

  if (isLoading || !hydrated) return <Section title="Notification preferences"><Loader2 className="h-5 w-5 animate-spin text-fg-dim" /></Section>;

  return (
    <Section title="Notification preferences">
      <div className="grid grid-cols-[1fr_60px_60px] gap-3 text-sm">
        <div className="text-xs uppercase tracking-widest text-fg-dim">Event</div>
        <div className="text-center text-xs uppercase tracking-widest text-fg-dim">Email</div>
        <div className="text-center text-xs uppercase tracking-widest text-fg-dim">In-app</div>
        {NOTIF_EVENTS.map((e) => (
          <div key={e.key} className="contents">
            <div>{e.label}</div>
            <Toggle checked={prefs[e.key]?.email ?? true} onChange={(v) => setPrefs((p) => ({ ...p, [e.key]: { email: v, inapp: p[e.key]?.inapp ?? true } }))} />
            <Toggle checked={prefs[e.key]?.inapp ?? true} onChange={(v) => setPrefs((p) => ({ ...p, [e.key]: { email: p[e.key]?.email ?? true, inapp: v } }))} />
          </div>
        ))}
      </div>
      {save.isError && <p className="mt-3 text-xs text-danger">{save.error instanceof Error ? save.error.message : "Could not save preferences"}</p>}
      {save.isSuccess && <p className="mt-3 flex items-center gap-1 text-xs text-success"><Check className="h-3.5 w-3.5" /> Preferences saved.</p>}
      <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary mt-4 text-sm disabled:opacity-50">
        {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save preferences"}
      </button>
    </Section>
  );
}

function AppearanceTab() {
  const qc = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);
  const [savedAs, setSavedAs] = useState<string | null>(null);

  async function applyTheme(choice: "light" | "dark" | "system") {
    setSaving(choice);
    setSavedAs(null);
    const resolved = choice === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : choice;
    document.documentElement.classList.toggle("dark", resolved === "dark");
    if (choice === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", choice);
    try {
      await api.users.updateMe({ themePreference: choice });
      qc.invalidateQueries({ queryKey: ["me"] });
      setSavedAs(choice);
    } catch {
      setSavedAs(null);
    } finally {
      setSaving(null);
    }
  }

  return (
    <Section title="Appearance">
      <div className="flex flex-wrap gap-2">
        {([
          { k: "light" as const, label: "Light", icon: <Sun className="h-4 w-4" /> },
          { k: "dark" as const, label: "Dark", icon: <Moon className="h-4 w-4" /> },
          { k: "system" as const, label: "System", icon: <Monitor className="h-4 w-4" /> },
        ]).map((t) => (
          <button
            key={t.k}
            onClick={() => applyTheme(t.k)}
            disabled={!!saving}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 px-4 py-1.5 text-sm transition hover:border-brand disabled:opacity-60"
          >
            {saving === t.k ? <Loader2 className="h-4 w-4 animate-spin" /> : t.icon} {t.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-fg-dim">
        Applied instantly, stored locally and synced to your profile{savedAs ? ` — saved as “${savedAs}”.` : "."}
      </p>
    </Section>
  );
}

function Section({ title, children, danger }: { title: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <div className={`card ${danger ? "border-danger/30" : ""}`}>
      <h3 className={`mb-3 font-display font-semibold ${danger ? "text-danger" : ""}`}>{title}</h3>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center justify-center">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className="relative inline-block h-5 w-9 rounded-full bg-surface-2 transition-colors peer-checked:bg-brand-gradient">
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}
