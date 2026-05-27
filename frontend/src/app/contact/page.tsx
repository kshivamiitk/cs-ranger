import type { Metadata } from "next";
import { Mail, Scale, Globe, Building2, Clock } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { SITE_NAME } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Contact LearnRift",
  description: `Get in touch with ${SITE_NAME} — learner support, legal queries, and business contact information.`,
};

export default function ContactPage() {
  return (
    <>
      <Navbar variant="public" />
      <main className="mx-auto max-w-3xl px-4 py-12 md:px-6">
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-fg-dim">Contact</p>
          <h1 className="heading-2 mt-1">Contact LearnRift</h1>
          <p className="mt-3 text-base text-fg-dim">
            LearnRift is an online learning platform for digital courses.
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="card">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-brand" />
              <h3 className="font-display text-lg font-semibold">For learner support</h3>
            </div>
            <a
              href="mailto:support@learnrift.site"
              className="mt-3 inline-flex break-all text-sm font-medium text-brand"
            >
              support@learnrift.site
            </a>
          </div>

          <div className="card">
            <div className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-brand" />
              <h3 className="font-display text-lg font-semibold">For legal, policy, or business queries</h3>
            </div>
            <a
              href="mailto:legal@learnrift.site"
              className="mt-3 inline-flex break-all text-sm font-medium text-brand"
            >
              legal@learnrift.site
            </a>
          </div>

          <div className="card">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-brand" />
              <h3 className="font-display text-lg font-semibold">Website</h3>
            </div>
            <a
              href="https://learnrift.site"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex break-all text-sm font-medium text-brand"
            >
              https://learnrift.site
            </a>
          </div>

          <div className="card">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-brand" />
              <h3 className="font-display text-lg font-semibold">Business Type</h3>
            </div>
            <p className="mt-3 text-sm text-fg">Sole Proprietorship</p>
          </div>

          <div className="card md:col-span-2">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-brand" />
              <h3 className="font-display text-lg font-semibold">Response Time</h3>
            </div>
            <p className="mt-3 text-sm text-fg-dim">
              We usually respond within 2–3 working days.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
