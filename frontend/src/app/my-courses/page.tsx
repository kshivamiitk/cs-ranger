"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Download, Loader2 } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { Progress } from "@/components/common/Progress";
import { api, type CertificateItem, type Course } from "@/lib/api";
import { useApp } from "@/app/providers";
import { durationFromSeconds, relativeTime, saveBlob } from "@/lib/utils";

export default function MyCoursesPage() {
  const { user } = useApp();
  const userId = user?.user_id || user?.id;
  const qc = useQueryClient();
  const [tab, setTab] = useState<"progress" | "completed">("progress");
  const [certificateErrors, setCertificateErrors] = useState<Record<string, string>>({});
  // Same cache key as the home dashboard's "Continue learning" — one fetch shared across both.
  const { data: enrollments, isLoading } = useQuery({ queryKey: ["my-enrollments", userId], queryFn: () => api.enrollments.list(), enabled: !!user });
  const { data: certificates } = useQuery({
    queryKey: ["my-certificates", userId],
    queryFn: () => api.achievements.myCertificates(),
    enabled: !!userId && tab === "completed",
  });
  const claimCertificate = useMutation({
    mutationFn: (courseId: string) => api.achievements.claimCertificate(courseId),
    onSuccess: (_data, courseId) => {
      setCertificateErrors((prev) => {
        const next = { ...prev };
        delete next[courseId];
        return next;
      });
      qc.invalidateQueries({ queryKey: ["my-certificates", userId] });
    },
    onError: (e, courseId) => {
      setCertificateErrors((prev) => ({ ...prev, [courseId]: e instanceof Error ? e.message : "Could not claim certificate" }));
    },
  });
  const downloadCertificate = useMutation({
    mutationFn: async (cert: CertificateItem) => {
      const blob = await api.achievements.downloadCertificate(cert.id);
      saveBlob(blob, `learnrift-certificate-${cert.id}.pdf`);
    },
    onError: (e, cert) => {
      setCertificateErrors((prev) => ({ ...prev, [cert.course_id]: e instanceof Error ? e.message : "Could not download certificate" }));
    },
  });
  if (!user) return null;

  const inProgress = (enrollments || []).filter((e) => !e.completed_at);
  const completed = (enrollments || []).filter((e) => e.completed_at);
  const list = tab === "progress" ? inProgress : completed;
  const certificateByCourse = new Map((certificates || []).map((cert) => [cert.course_id, cert]));

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 py-10 md:px-6">
        <h1 className="heading-2">My Courses</h1>
        <p className="mt-1 text-sm text-fg-dim">Pick up where you left off.</p>

        <div className="mt-6 inline-flex rounded-full border border-border bg-surface-2 p-0.5">
          {[
            { k: "progress", label: `In Progress (${inProgress.length})` },
            { k: "completed", label: `Completed (${completed.length})` },
          ].map((t) => (
            <button key={t.k} onClick={() => setTab(t.k as "progress" | "completed")}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${tab === t.k ? "bg-brand-gradient text-white shadow-glow" : "text-fg-dim hover:text-fg"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="mt-8 flex justify-center text-fg-dim"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="mt-6 space-y-3">
            {list.length === 0 ? (
              <div className="card text-center text-fg-dim">
                {tab === "progress" ? "No courses in progress. Browse the catalog to get started." : "No completed courses yet."}
              </div>
            ) : (
              list.map((e) => {
                const c = e.courses;
                if (!c) return null;
                return (
                  <div key={e.id} className="card flex flex-col gap-4 md:flex-row md:items-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {c.thumbnail_url && <img src={c.thumbnail_url} alt="" className="h-32 w-full rounded-xl object-cover md:h-20 md:w-32" />}
                    <div className="flex-1 min-w-0">
                      <p className="line-clamp-1 font-display font-semibold">{c.title}</p>
                      {c.duration_seconds ? <p className="text-xs text-fg-dim">{durationFromSeconds(c.duration_seconds)}</p> : null}
                      <div className="mt-3">
                        <Progress value={e.progress_percent} />
                        <div className="mt-1 flex items-center justify-between text-xs text-fg-dim">
                          <span>{e.progress_percent}% complete</span>
                          <span>Enrolled {relativeTime(e.enrolled_at)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 md:justify-end">
                      {/* Without last_node_id we don't know a valid nodeId here (the
                          list endpoint doesn't fetch modules to stay fast). Route to
                          the course page, which resolves the first lesson and routes
                          on. Resolves the /learn/ 404 from empty nodeId segments. */}
                      <Link
                        href={e.last_node_id ? `/course/${c.id}/learn/${e.last_node_id}` : `/course/${c.id}`}
                        className={tab === "progress" ? "btn-primary text-sm" : "btn-ghost text-sm"}
                      >
                        {tab === "progress" ? "Continue" : "Review"}
                      </Link>
                      {tab === "completed" && c.certificate_enabled !== false ? (
                        <CertificateAction
                          course={c}
                          certificate={certificateByCourse.get(c.id)}
                          error={certificateErrors[c.id]}
                          claimPending={claimCertificate.isPending && claimCertificate.variables === c.id}
                          downloadPending={downloadCertificate.isPending && downloadCertificate.variables?.id === certificateByCourse.get(c.id)?.id}
                          onClaim={() => claimCertificate.mutate(c.id)}
                          onDownload={(cert) => downloadCertificate.mutate(cert)}
                        />
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

function CertificateAction({
  course,
  certificate,
  error,
  claimPending,
  downloadPending,
  onClaim,
  onDownload,
}: {
  course: Course;
  certificate?: CertificateItem;
  error?: string;
  claimPending: boolean;
  downloadPending: boolean;
  onClaim: () => void;
  onDownload: (cert: CertificateItem) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1 md:items-end">
      {certificate ? (
        <button onClick={() => onDownload(certificate)} disabled={downloadPending} className="btn-primary text-sm disabled:opacity-50" aria-label={`Download certificate for ${course.title}`}>
          {downloadPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Certificate
        </button>
      ) : (
        <button onClick={onClaim} disabled={claimPending} className="btn-primary text-sm disabled:opacity-50" aria-label={`Claim certificate for ${course.title}`}>
          {claimPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Award className="h-4 w-4" />} Claim certificate
        </button>
      )}
      {error ? <p className="max-w-64 text-xs text-danger md:text-right">{error}</p> : null}
    </div>
  );
}
