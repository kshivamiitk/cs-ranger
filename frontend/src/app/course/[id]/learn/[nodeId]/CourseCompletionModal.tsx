"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { Award, Download, Loader2, PartyPopper, X } from "lucide-react";
import { api } from "@/lib/api";
import { saveBlob } from "@/lib/utils";

/**
 * The "course completed" success moment: celebrate, then claim + download the
 * certificate (idempotent — re-claiming returns the same certificate).
 */
export function CourseCompletionModal({
  courseId, courseTitle, certificateEnabled, completed = true, onClose,
}: {
  courseId: string;
  courseTitle: string;
  certificateEnabled: boolean;
  completed?: boolean;
  onClose: () => void;
}) {
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const claim = useMutation({ mutationFn: () => api.achievements.claimCertificate(courseId) });
  const download = useMutation({
    mutationFn: async () => {
      const certId = claim.data?.certificate.id;
      if (!certId) throw new Error("Claim the certificate first");
      const blob = await api.achievements.downloadCertificate(certId);
      saveBlob(blob, `learnrift-certificate-${certId}.pdf`);
    },
    onError: (e) => setDownloadError(e instanceof Error ? e.message : "Download failed"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl glass-strong" onClick={(e) => e.stopPropagation()}>
        <div className="bg-mesh-1 p-8 text-center text-white">
          <PartyPopper className="mx-auto h-12 w-12" />
          <h3 className="mt-3 font-display text-2xl font-bold">{completed ? "Course completed!" : "Certificate ready"}</h3>
          <p className="mt-1 text-sm text-white/85">{courseTitle}</p>
        </div>
        <div className="p-6">
          <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 rounded-full bg-black/20 p-1 text-white hover:bg-black/40">
            <X className="h-4 w-4" />
          </button>

          {certificateEnabled ? (
            <div className="space-y-3">
              {!claim.data ? (
                <>
                  <p className="text-sm text-fg-dim">
                    {completed
                      ? "You've earned a completion certificate. Claim it to add it to your achievements and download the PDF."
                      : "You've met this course's certificate requirements. Claim it to add it to your achievements and download the PDF."}
                  </p>
                  {claim.isError && <p className="text-xs text-danger">{claim.error instanceof Error ? claim.error.message : "Could not issue the certificate"}</p>}
                  <button onClick={() => claim.mutate()} disabled={claim.isPending} className="btn-primary w-full disabled:opacity-50">
                    {claim.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Award className="h-4 w-4" /> Claim certificate</>}
                  </button>
                </>
              ) : (
                <>
                  <p className="flex items-center gap-2 text-sm text-success"><Award className="h-4 w-4" /> Certificate {claim.data.alreadyIssued ? "already issued" : "issued"}.</p>
                  {downloadError && <p className="text-xs text-danger">{downloadError}</p>}
                  <button onClick={() => download.mutate()} disabled={download.isPending} className="btn-primary w-full disabled:opacity-50">
                    {download.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Download className="h-4 w-4" /> Download PDF</>}
                  </button>
                </>
              )}
            </div>
          ) : (
            <p className="text-sm text-fg-dim">Great work — this course doesn&apos;t issue certificates, but your progress and streak have been recorded.</p>
          )}

          <div className="mt-4 flex gap-2">
            <Link href="/achievements" className="btn-ghost flex-1 text-sm">View achievements</Link>
            <button onClick={onClose} className="btn-ghost flex-1 text-sm">Keep browsing</button>
          </div>
        </div>
      </div>
    </div>
  );
}
