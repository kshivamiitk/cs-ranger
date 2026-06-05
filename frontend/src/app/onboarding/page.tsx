"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, GraduationCap, Loader2, Rocket, Sparkles, Users } from "lucide-react";
import { Logo } from "@/components/common/Logo";
import { Avatar } from "@/components/common/Avatar";
import { FileUpload } from "@/components/common/FileUpload";
import { api, type OnboardingPatchBody, type OnboardingState } from "@/lib/api";
import { meQueryOptions } from "@/lib/queries";
import { useApp } from "@/app/providers";
import { useDebouncedValue } from "@/lib/hooks";
import { cn } from "@/lib/utils";

const STEPS = ["Role", "Profile", "Preferences", "Finish"];
const DOMAINS = ["Data Structures", "Algorithms", "Web Development", "System Design", "Mathematics", "Machine Learning", "Databases", "DevOps"];
const LANGUAGES = ["English", "Hindi", "Hinglish"];

export default function OnboardingPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user, setUser, setRoleView } = useApp();

  const { data: state, isLoading } = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => api.users.onboarding(),
    enabled: !!user,
  });

  const [step, setStep] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1
  const [roleIntent, setRoleIntent] = useState<"learner" | "creator" | "both">("learner");
  // Step 2
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const debouncedUsername = useDebouncedValue(username, 350);
  // Step 3
  const [domains, setDomains] = useState<string[]>([]);
  const [skillLevel, setSkillLevel] = useState<"beginner" | "intermediate" | "advanced">("beginner");
  const [language, setLanguage] = useState("English");
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [inappNotifications, setInappNotifications] = useState(true);
  // Step 4
  const [headline, setHeadline] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);

  const { data: termsStatus } = useQuery({ queryKey: ["creator-terms-status"], queryFn: () => api.users.creatorTermsStatus(), enabled: !!user });

  // Resume from the saved server state exactly once.
  useEffect(() => {
    if (!state || hydrated) return;
    if (state.completed) {
      router.replace(state.roles.includes("creator") ? "/creator/overview" : "/home");
      return;
    }
    setStep(Math.min(state.step, 3));
    setRoleIntent(state.data.roleIntent || (state.roles.includes("creator") ? (state.roles.includes("learner") ? "both" : "creator") : "learner"));
    setDisplayName(state.profile.display_name || "");
    setUsername(state.profile.username || "");
    setBio(state.profile.bio || "");
    setDomains(state.data.preferences?.domains || []);
    setSkillLevel(state.data.preferences?.skillLevel || "beginner");
    setLanguage(state.data.preferences?.language || "English");
    setEmailNotifications(state.data.preferences?.emailNotifications ?? true);
    setInappNotifications(state.data.preferences?.inappNotifications ?? true);
    setHeadline(state.data.creator?.headline || "");
    setHydrated(true);
  }, [state, hydrated, router]);

  const usernameChanged = !!debouncedUsername && debouncedUsername !== state?.profile.username;
  const { data: usernameCheck } = useQuery({
    queryKey: ["check-username", debouncedUsername],
    queryFn: () => api.users.checkUsername(debouncedUsername),
    enabled: usernameChanged && /^[a-z0-9_]{3,30}$/.test(debouncedUsername),
  });

  const save = useMutation({
    mutationFn: (body: OnboardingPatchBody) => api.users.updateOnboarding(body),
    onError: (e) => setError(e instanceof Error ? e.message : "Could not save your answers"),
  });

  const complete = useMutation({
    mutationFn: async () => {
      if (isCreator && acceptTerms && termsStatus && !termsStatus.accepted) {
        await api.users.acceptCreatorTerms(termsStatus.currentVersion, termsStatus.commissionRate);
      }
      return api.users.completeOnboarding();
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ["onboarding"] });
      qc.invalidateQueries({ queryKey: ["creator-terms-status"] });
      // Re-fetch the authoritative profile so a creator/both role CHOSEN DURING
      // onboarding is reflected immediately. Previously we spread the stale
      // `user` (still holding the signup-time roles), so the Learner/Creator role
      // switcher and the creator nav didn't appear until a full page reload
      // re-fetched /me. Fetching here updates both the app user and the ["me"]
      // query cache in one shot.
      qc.invalidateQueries({ queryKey: meQueryOptions.queryKey });
      try {
        const me = await qc.fetchQuery(meQueryOptions);
        setUser(me);
        if (me.roles?.includes("creator")) setRoleView("creator");
      } catch {
        // Network hiccup — fall back to the optimistic update; a reload will reconcile.
        if (user) setUser({ ...user, has_completed_onboarding: true });
        if (roleIntent !== "learner") setRoleView("creator");
      }
      router.replace(roleIntent === "learner" ? "/home" : "/creator/overview");
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not finish onboarding"),
  });

  const isCreator = roleIntent === "creator" || roleIntent === "both";

  async function next() {
    setError(null);
    try {
      if (step === 0) {
        await save.mutateAsync({ step: 1, roles: roleIntent });
      } else if (step === 1) {
        if (displayName.trim().length < 2) { setError("Add a display name (at least 2 characters)."); return; }
        if (!/^[a-z0-9_]{3,30}$/.test(username)) { setError("Pick a username: 3–30 lowercase letters, digits or underscores."); return; }
        if (usernameChanged && usernameCheck && !usernameCheck.available) { setError("That username is already taken."); return; }
        await save.mutateAsync({ step: 2, profile: { displayName: displayName.trim(), username, bio: bio.trim() || undefined } });
        if (user) setUser({ ...user, display_name: displayName.trim(), username });
      } else if (step === 2) {
        await save.mutateAsync({ step: 3, preferences: { domains, skillLevel, language, emailNotifications, inappNotifications } });
      }
      setStep((s) => Math.min(s + 1, 3));
    } catch {
      /* error already surfaced via the mutation */
    }
  }

  async function finish() {
    setError(null);
    try {
      if (isCreator && headline.trim()) await save.mutateAsync({ step: 4, creator: { headline: headline.trim() } });
      await complete.mutateAsync();
    } catch { /* surfaced */ }
  }

  if (!user || isLoading || !hydrated) {
    return <div className="flex h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-fg-dim" /></div>;
  }

  const busy = save.isPending || complete.isPending;

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between">
          <Logo href="/" />
          <span className="text-xs text-fg-dim">Step {step + 1} of {STEPS.length}</span>
        </div>

        {/* Stepper */}
        <div className="mt-6 flex items-center gap-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex flex-1 items-center gap-2">
              <span className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                i < step ? "bg-success text-white" : i === step ? "bg-brand-gradient text-white shadow-glow" : "bg-surface-2 text-fg-dim",
              )}>
                {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={cn("hidden text-xs sm:block", i === step ? "font-medium text-fg" : "text-fg-dim")}>{label}</span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" />}
            </div>
          ))}
        </div>

        <div className="card mt-6">
          {step === 0 && (
            <div>
              <h1 className="heading-3">How will you use LearnRift?</h1>
              <p className="mt-1 text-sm text-fg-dim">You can always add the other role later from the role switcher.</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {([
                  { k: "learner" as const, icon: <GraduationCap className="h-5 w-5" />, title: "Learn", body: "Take courses, earn certificates and build streaks." },
                  { k: "creator" as const, icon: <Rocket className="h-5 w-5" />, title: "Teach", body: "Publish courses and earn from every enrollment." },
                  { k: "both" as const, icon: <Users className="h-5 w-5" />, title: "Both", body: "Learn and teach from one account." },
                ]).map((o) => (
                  <button key={o.k} onClick={() => setRoleIntent(o.k)}
                    className={cn("rounded-2xl border p-4 text-left transition", roleIntent === o.k ? "border-brand bg-surface-2 shadow-glass" : "border-border bg-surface-2/40 hover:border-brand/50")}>
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2">{o.icon}</span>
                    <p className="mt-3 font-medium">{o.title}</p>
                    <p className="mt-1 text-xs text-fg-dim">{o.body}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h1 className="heading-3">Set up your profile</h1>
                <p className="mt-1 text-sm text-fg-dim">This is how other learners and creators will see you.</p>
              </div>
              <div className="flex items-center gap-4">
                <Avatar name={displayName || user.display_name || "U"} src={user.avatar_url || undefined} size={64} />
                <div className="flex-1">
                  <FileUpload
                    compact
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    maxBytes={2 * 1024 * 1024}
                    hint="Optional · JPG / PNG / WEBP · max 2 MB"
                    onUpload={async (file, onProgress) => {
                      const result = await api.users.uploadAvatar(file, onProgress);
                      setUser({ ...user, avatar_url: result.url });
                    }}
                  />
                </div>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-fg-dim">Display name</span>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="input" placeholder="Aarav Sharma" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-fg-dim">Username</span>
                <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} className="input font-mono" placeholder="aarav_sharma" />
                {usernameChanged && usernameCheck && (
                  <span className={cn("mt-1 block text-xs", usernameCheck.available ? "text-success" : "text-danger")}>
                    {usernameCheck.available ? "Username is available" : "Username is taken"}
                  </span>
                )}
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-fg-dim">Bio (optional)</span>
                <textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} className="input min-h-[72px]" placeholder="Final-year CS student, into systems and math." />
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h1 className="heading-3">What do you want to get better at?</h1>
                <p className="mt-1 text-sm text-fg-dim">We use this to personalise your catalog and recommendations.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {DOMAINS.map((d) => (
                  <button key={d}
                    onClick={() => setDomains((cur) => cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d])}
                    className={cn("chip transition", domains.includes(d) ? "border-brand text-fg bg-surface" : "hover:border-brand/50")}>
                    {d}
                  </button>
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-fg-dim">Skill level</span>
                  <select value={skillLevel} onChange={(e) => setSkillLevel(e.target.value as typeof skillLevel)} className="input">
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-fg-dim">Preferred language</span>
                  <select value={language} onChange={(e) => setLanguage(e.target.value)} className="input">
                    {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
                  </select>
                </label>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={inappNotifications} onChange={(e) => setInappNotifications(e.target.checked)} className="h-4 w-4 accent-[var(--brand-primary)]" />
                  In-app notifications (doubt replies, course updates, achievements)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={emailNotifications} onChange={(e) => setEmailNotifications(e.target.checked)} className="h-4 w-4 accent-[var(--brand-primary)]" />
                  Email notifications
                </label>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h1 className="heading-3">{isCreator ? "Creator setup" : "You're all set"}</h1>
                <p className="mt-1 text-sm text-fg-dim">
                  {isCreator
                    ? "A couple of optional things before your studio opens."
                    : "Jump into the catalog and start your first course — your streak begins today."}
                </p>
              </div>

              {isCreator && (
                <>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-fg-dim">Creator headline (optional)</span>
                    <input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={120} className="input" placeholder="Teaching DSA without the gatekeeping" />
                  </label>
                  {termsStatus && !termsStatus.accepted && (
                    <label className="flex items-start gap-2 rounded-xl border border-border bg-surface-2/60 p-3 text-sm">
                      <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--brand-primary)]" />
                      <span>
                        Accept the Creator Terms (v{termsStatus.currentVersion}) including the {Math.round(termsStatus.commissionRate * 100)}% platform commission.
                        You can also do this later from the publish flow.
                      </span>
                    </label>
                  )}
                  <div className="rounded-xl border border-border bg-surface-2/60 p-3 text-xs text-fg-dim">
                    Payouts need a one-time KYC (bank account or UPI) — set it up any time from <span className="text-fg">Creator → Finance</span>.
                  </div>
                </>
              )}

              <div className="rounded-2xl border border-brand/30 bg-surface-2/60 p-4 text-sm">
                <p className="flex items-center gap-2 font-medium"><Sparkles className="h-4 w-4 text-brand" /> What happens next</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-fg-dim">
                  <li>Your preferences personalise the catalog{domains.length ? ` (${domains.slice(0, 3).join(", ")}${domains.length > 3 ? "…" : ""})` : ""}.</li>
                  {isCreator
                    ? <li>Your studio is ready — <Link href="/creator/courses/new" className="text-brand">create your first course</Link> whenever you like.</li>
                    : <li>Lessons you complete build your streak and unlock badges.</li>}
                </ul>
              </div>
            </div>
          )}

          {error && <p className="mt-4 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

          <div className="mt-6 flex items-center justify-between">
            <button onClick={() => { setError(null); setStep((s) => Math.max(0, s - 1)); }} disabled={step === 0 || busy} className="btn-ghost disabled:opacity-40">
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            {step < 3 ? (
              <button onClick={next} disabled={busy} className="btn-primary disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Continue <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button onClick={finish} disabled={busy} className="btn-primary disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Finish setup
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
