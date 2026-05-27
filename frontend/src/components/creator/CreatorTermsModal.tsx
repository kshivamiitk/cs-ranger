"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileCheck2, Loader2, X } from "lucide-react";
import { api, type CreatorTermsStatus } from "@/lib/api";

/**
 * Creator Terms & Conditions acceptance. Shown when the platform's current
 * terms version hasn't been accepted yet — publishing / submitting a course is
 * blocked server-side (TERMS_ACCEPTANCE_REQUIRED) until this is accepted.
 */
export function CreatorTermsModal({
  status, onAccepted, onClose,
}: {
  status: CreatorTermsStatus;
  onAccepted: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const commissionPercent = Math.round(status.commissionRate * 10000) / 100;

  const accept = useMutation({
    mutationFn: () => api.users.acceptCreatorTerms(status.currentVersion, status.commissionRate),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["creator-terms-status"] });
      onAccepted();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-lg rounded-2xl glass-strong p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2"><FileCheck2 className="h-5 w-5 text-brand" /></span>
            <div>
              <h3 className="heading-3">Creator Terms &amp; Conditions</h3>
              <p className="text-xs text-fg-dim">Version {status.currentVersion}{status.acceptedVersion ? ` · you previously accepted ${status.acceptedVersion}` : ""}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1 text-fg-dim hover:bg-surface-2 hover:text-fg"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-4 max-h-64 overflow-y-auto rounded-xl border border-border bg-surface-2/60 p-4 text-sm leading-relaxed text-fg-dim">
          <p className="font-medium text-fg">By publishing on LearnRift you agree that:</p>
          <ol className="mt-2 list-decimal space-y-2 pl-5">
            <li>The platform retains a commission of <b className="text-fg">{commissionPercent}%</b> on every paid enrollment; the remainder is credited to your creator wallet.</li>
            <li>Learners may request a no-questions-asked refund within the platform refund window; refunded enrollments reverse the corresponding wallet credit.</li>
            <li>Payouts require completed KYC and are subject to the minimum payout threshold and TDS withholding as applicable under Indian tax law.</li>
            <li>You own (or are licensed to use) all content you upload, and it must not infringe third-party rights or violate the prohibited content policy.</li>
            <li>Courses that violate platform policy may be unpublished pending review; repeated violations may result in account suspension.</li>
            <li>Commission or policy changes apply to future enrollments only and will require re-acceptance of an updated terms version before your next submission.</li>
          </ol>
        </div>

        <label className="mt-4 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--brand-primary)]" />
          I have read and accept the Creator Terms (version {status.currentVersion}) including the {commissionPercent}% platform commission.
        </label>

        {accept.isError && (
          <p className="mt-3 text-xs text-danger">{accept.error instanceof Error ? accept.error.message : "Could not record your acceptance"}</p>
        )}

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="btn-ghost flex-1" disabled={accept.isPending}>Not now</button>
          <button
            onClick={() => accept.mutate()}
            disabled={!agreed || accept.isPending}
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {accept.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Accept terms"}
          </button>
        </div>
      </div>
    </div>
  );
}
