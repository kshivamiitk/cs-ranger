"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Calendar, GraduationCap, Loader2 } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api } from "@/lib/api";

export default function CertificateVerifyPage() {
  const params = useParams<{ certId: string }>();
  const { data, isLoading, error } = useQuery({ queryKey: ["cert-verify", params.certId], queryFn: () => api.achievements.verifyCertificate(params.certId) });

  return (
    <>
      <Navbar variant="public" />
      <main className="mx-auto max-w-3xl px-4 py-16 md:px-6">
        {isLoading ? (
          <div className="card text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-fg-dim" /></div>
        ) : error || !data ? (
          <div className="card text-center text-danger">Certificate not found or invalid.</div>
        ) : (
          <div className="card overflow-hidden p-0">
            <div className="bg-mesh-1 p-10 text-center text-white">
              <BadgeCheck className="mx-auto h-14 w-14" />
              <h1 className="mt-3 font-display text-3xl font-bold">Certificate verified</h1>
              <p className="mt-1 text-white/80">This certificate is authentic and issued by LearnRift.</p>
            </div>
            <div className="space-y-5 p-8">
              <Row icon={<GraduationCap className="h-5 w-5" />} label="Awarded to" value={data.profiles?.display_name || "—"} />
              <Row icon={<GraduationCap className="h-5 w-5" />} label="Course" value={data.courses?.title || "—"} />
              <Row icon={<Calendar className="h-5 w-5" />} label="Date" value={new Date(data.issued_at).toLocaleDateString()} />
              <Row label="Verification ID" value={data.verification_token} mono />
            </div>
            {data.profiles?.username && (
              <div className="border-t border-border p-6 text-center">
                <Link href={`/u/${data.profiles.username}`} className="btn-ghost">View {data.profiles.display_name}'s profile</Link>
              </div>
            )}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

function Row({ icon, label, value, mono }: { icon?: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      {icon && <span className="mt-0.5 text-fg-dim">{icon}</span>}
      <div className="flex-1">
        <p className="text-xs uppercase tracking-widest text-fg-dim">{label}</p>
        <p className={`mt-0.5 ${mono ? "font-mono text-sm" : "font-display text-lg font-semibold"}`}>{value}</p>
      </div>
    </div>
  );
}
