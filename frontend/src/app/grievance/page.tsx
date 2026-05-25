import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Clock, ShieldCheck } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { SITE_NAME } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Grievance Redressal",
  description: `How to raise a grievance with ${SITE_NAME} under Indian IT and DPDP rules.`,
};

const EFFECTIVE = "May 25, 2026";

export default function GrievancePage() {
  return (
    <>
      <Navbar variant="public" />
      <main className="mx-auto max-w-3xl px-4 py-12 md:px-6">
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-fg-dim">Legal</p>
          <h1 className="heading-2 mt-1">Grievance Redressal</h1>
          <p className="mt-2 text-sm text-fg-dim">Effective {EFFECTIVE}</p>
        </header>

        <article className="markdown-view card">
          <p>
            {SITE_NAME} is committed to addressing every concern raised by our users in a fair and timely manner.
            This page describes how you can raise a grievance and how we respond.
          </p>

          <h2>When to use this page</h2>
          <ul>
            <li>Complaints about content on the Platform (objectionable, infringing, unlawful).</li>
            <li>Privacy concerns &mdash; including data access, correction, or deletion requests.</li>
            <li>Disputes about refunds, payments, or course access not resolved by ordinary support.</li>
            <li>Reports under Rule 3(2) of the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021.</li>
          </ul>

          <h2>Grievance Officer</h2>
          <div className="not-prose mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface-2 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4 text-brand" /> Designated Officer
              </div>
              <p className="mt-2 text-sm text-fg-dim">
                Grievance Officer
                <br />
                {SITE_NAME}
                <br />
                Bengaluru, Karnataka, India
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface-2 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Mail className="h-4 w-4 text-brand" /> Email
              </div>
              <p className="mt-2 break-all text-sm">
                <a href="mailto:grievance@cs-ranger.dev" className="text-brand underline">
                  grievance@cs-ranger.dev
                </a>
              </p>
              <p className="mt-1 text-xs text-fg-dim">
                Backup: <a href="mailto:support@cs-ranger.dev" className="underline">support@cs-ranger.dev</a>
              </p>
            </div>
          </div>

          <h2>What to include</h2>
          <ol>
            <li>Your full name and the email address linked to your account.</li>
            <li>A clear description of the grievance, with dates and the people / content involved.</li>
            <li>Any relevant URLs, course IDs, transaction IDs, or screenshots.</li>
            <li>The outcome you are looking for.</li>
            <li>A statement that the information provided is accurate to the best of your knowledge.</li>
          </ol>

          <h2>Response timelines</h2>
          <ul>
            <li>
              <Clock className="mb-0.5 mr-1 inline h-4 w-4 text-brand" />
              <strong>Acknowledgement:</strong> within <strong>24 hours</strong> of receipt.
            </li>
            <li>
              <Clock className="mb-0.5 mr-1 inline h-4 w-4 text-brand" />
              <strong>Resolution:</strong> within <strong>15 days</strong> for most grievances, and within{" "}
              <strong>72 hours</strong> for take-down requests concerning content that is unlawful on its face
              (per Rule 3(2)(b) of the Intermediary Rules).
            </li>
            <li>
              <Clock className="mb-0.5 mr-1 inline h-4 w-4 text-brand" />
              <strong>Privacy requests</strong> under the DPDP Act, 2023 are addressed within statutory timelines.
            </li>
          </ul>

          <h2>Escalation</h2>
          <p>
            If you are not satisfied with the resolution, you may write to{" "}
            <a href="mailto:grievance@cs-ranger.dev" className="underline">grievance@cs-ranger.dev</a> with
            &ldquo;ESCALATION&rdquo; in the subject line and a copy of the original ticket. We will route the
            matter to a senior team member.
          </p>
          <p>
            You may also approach the Grievance Appellate Committee constituted under Section 79 of the
            Information Technology Act, 2000 if your concern is not resolved within the prescribed timelines.
          </p>

          <h2>Related</h2>
          <ul>
            <li><Link href="/terms" className="underline">Terms and Conditions</Link></li>
            <li><Link href="/privacy" className="underline">Privacy Policy</Link></li>
            <li><Link href="/refund-policy" className="underline">Cancellation and Refund Policy</Link></li>
            <li><Link href="/contact" className="underline">Contact Us</Link></li>
          </ul>
        </article>
      </main>
      <Footer />
    </>
  );
}
