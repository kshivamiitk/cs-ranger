"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Flame, Trophy, Award, Loader2, Download, ExternalLink } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { Heatmap } from "@/components/common/Heatmap";
import { api, type CertificateItem } from "@/lib/api";
import { useApp } from "@/app/providers";
import { saveBlob } from "@/lib/utils";

const RARITY: Record<string, string> = {
  common: "from-slate-400 to-slate-600",
  rare: "from-sky-400 to-indigo-600",
  epic: "from-fuchsia-400 to-purple-600",
  legendary: "from-amber-400 via-orange-500 to-rose-500",
};

export default function AchievementsPage() {
  const { user } = useApp();
  const userId = user?.user_id || user?.id;
  const { data: badges, isLoading } = useQuery({ queryKey: ["badges", userId], queryFn: () => api.achievements.badges(userId!), enabled: !!userId });
  const { data: streak } = useQuery({ queryKey: ["streak", userId], queryFn: () => api.achievements.streak(userId!), enabled: !!userId });
  const { data: heatmap } = useQuery({ queryKey: ["heatmap", userId], queryFn: () => api.achievements.heatmap(userId!), enabled: !!userId });
  const { data: certificates, isLoading: certsLoading } = useQuery({ queryKey: ["my-certificates", userId], queryFn: () => api.achievements.myCertificates(), enabled: !!userId });

  if (!user) return null;

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 py-10 md:px-6">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2"><Trophy className="h-5 w-5" /></span>
          <div>
            <h1 className="heading-2">Achievements</h1>
            <p className="text-sm text-fg-dim">Streaks, badges, and certificates you've earned.</p>
          </div>
        </div>

        <section className="mb-10 grid gap-4 sm:grid-cols-3">
          <BigStat icon={<Flame className="h-7 w-7 text-orange-400" />} value={String(streak?.current_streak ?? 0)} label="Day streak" sub={`Longest: ${streak?.longest_streak ?? 0} days`} />
          <BigStat icon={<Trophy className="h-7 w-7 text-amber-400" />} value={String(badges?.earned.length ?? 0)} label="Badges earned" sub={`${badges?.locked.length ?? 0} more to unlock`} />
          <BigStat icon={<Award className="h-7 w-7 text-brand" />} value={String(certificates?.length ?? 0)} label="Certificates" sub="Completion certificates" />
        </section>

        {heatmap && Object.keys(heatmap).length > 0 && <Heatmap data={heatmap} />}

        <section className="mt-12">
          <h2 className="heading-3 mb-4">Certificates</h2>
          {certsLoading ? (
            <div className="flex justify-center p-6 text-fg-dim"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : (certificates?.length ?? 0) === 0 ? (
            <div className="card text-center text-fg-dim">
              No certificates yet. Finish a certificate-enabled course and claim yours from the completion screen.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {certificates!.map((c) => <CertificateCard key={c.id} cert={c} />)}
            </div>
          )}
        </section>

        {isLoading ? (
          <div className="mt-10 flex justify-center text-fg-dim"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <>
            <section className="mt-12">
              <h2 className="heading-3 mb-4">Earned badges</h2>
              {(badges?.earned ?? []).length === 0 ? (
                <div className="card text-center text-fg-dim">No badges yet. Complete a lesson to earn your first.</div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {(badges?.earned ?? []).map((b) => (
                    <div key={b.id} className="card relative overflow-hidden text-center transition hover:-translate-y-0.5 hover:shadow-glow">
                      <div className={`absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br ${RARITY[b.rarity || "common"]} opacity-30 blur-2xl`} />
                      <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${RARITY[b.rarity || "common"]} text-3xl shadow-glow`}>
                        {b.icon}
                      </div>
                      <p className="mt-3 font-display text-sm font-semibold">{b.name}</p>
                      <p className="mt-0.5 text-xs text-fg-dim">{b.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="mt-10">
              <h2 className="heading-3 mb-4">Locked badges</h2>
              <div className="grid gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {(badges?.locked ?? []).map((b) => (
                  <div key={b.id} className="card text-center opacity-50">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-2 text-3xl grayscale">{b.icon}</div>
                    <p className="mt-3 font-display text-sm font-semibold">{b.name}</p>
                    <p className="mt-0.5 text-xs text-fg-dim">{b.description}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}

function CertificateCard({ cert }: { cert: CertificateItem }) {
  const [error, setError] = useState<string | null>(null);
  const download = useMutation({
    mutationFn: async () => {
      const blob = await api.achievements.downloadCertificate(cert.id);
      saveBlob(blob, `cs-ranger-certificate-${cert.id}.pdf`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Download failed"),
  });

  return (
    <div className="card flex flex-col">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white"><Award className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-medium">{cert.courses?.title || "Course certificate"}</p>
          <p className="mt-0.5 text-xs text-fg-dim">Issued {new Date(cert.issued_at).toLocaleDateString()}</p>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button onClick={() => download.mutate()} disabled={download.isPending} className="btn-primary flex-1 px-3 py-1.5 text-xs disabled:opacity-50">
          {download.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download PDF
        </button>
        <Link href={`/verify/${cert.verification_token}`} className="btn-ghost flex-1 px-3 py-1.5 text-xs">
          <ExternalLink className="h-3.5 w-3.5" /> Verify
        </Link>
      </div>
    </div>
  );
}

function BigStat({ icon, value, label, sub }: { icon: React.ReactNode; value: string; label: string; sub: string }) {
  return (
    <div className="card flex items-center gap-4">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2">{icon}</span>
      <div>
        <p className="font-display text-3xl font-bold">{value}</p>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-fg-dim">{sub}</p>
      </div>
    </div>
  );
}
