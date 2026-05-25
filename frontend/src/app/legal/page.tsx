import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { SITE_NAME } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Legal",
  description: `All legal and policy pages for ${SITE_NAME}.`,
};

const SECTIONS: Array<{ title: string; items: Array<[label: string, href: string, blurb: string]> }> = [
  {
    title: "Core policies",
    items: [
      ["Terms and Conditions", "/terms", "The contract you agree to when using the Platform."],
      ["Privacy Policy", "/privacy", "What data we collect and how we use it."],
      ["Cancellation and Refund Policy", "/refund-policy", "When and how you can get a refund."],
      ["Digital Delivery Policy", "/digital-delivery-policy", "How our digital products are delivered."],
      ["Pricing", "/pricing", "How learners pay and how creators earn."],
    ],
  },
  {
    title: "Role-specific terms",
    items: [
      ["Creator Terms", "/creator-terms", "If you publish courses, this is for you."],
      ["Learner Terms", "/learner-terms", "If you buy or take courses, this is for you."],
    ],
  },
  {
    title: "Reach us",
    items: [
      ["Contact Us", "/contact", "Email, support, and mailing address."],
      ["Grievance", "/grievance", "Formal complaints and the grievance officer."],
    ],
  },
];

export default function LegalIndexPage() {
  return (
    <>
      <Navbar variant="public" />
      <main className="mx-auto max-w-4xl px-4 py-12 md:px-6">
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-fg-dim">Legal</p>
          <h1 className="heading-2 mt-1">Policies &amp; terms</h1>
          <p className="mt-2 text-sm text-fg-dim">
            Every policy that governs your use of {SITE_NAME}, in one place.
          </p>
        </header>

        <div className="space-y-10">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fg-dim">{s.title}</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {s.items.map(([label, href, blurb]) => (
                  <Link
                    key={href}
                    href={href}
                    className="card transition hover:border-brand/40 hover:shadow-glow"
                  >
                    <p className="font-display text-base font-semibold">{label}</p>
                    <p className="mt-1 text-sm text-fg-dim">{blurb}</p>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}
