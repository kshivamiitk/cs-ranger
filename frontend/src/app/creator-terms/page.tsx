import type { Metadata } from "next";
import { CommissionPct } from "@/components/common/PlatformRates";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { SITE_NAME } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Creator Terms",
  description: `Creator Terms for publishing courses on ${SITE_NAME}.`,
};

export default function CreatorTermsPage() {
  return (
    <>
      <Navbar variant="public" />
      <main className="mx-auto max-w-3xl px-4 py-12 md:px-6">
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-fg-dim">Legal</p>
          <h1 className="heading-2 mt-1">Creator Terms</h1>
        </header>

        <article className="markdown-view card space-y-4">
          <p>These Creator Terms apply to creators who publish courses on LearnRift.</p>

          <h2>1. Creator Responsibility</h2>
          <p>
            Creators are responsible for the accuracy, legality, quality, and originality of their
            course content.
          </p>

          <h2>2. Content Ownership</h2>
          <p>Creators must only upload content they own or have permission to use.</p>

          <h2>3. Course Review</h2>
          <p>
            LearnRift may review, approve, reject, suspend, or remove courses that violate platform
            rules.
          </p>

          <h2>4. Platform Commission</h2>
          <p>
            LearnRift may deduct a platform commission from course payments before calculating
            creator earnings.
          </p>
          <p>
            <strong>Current platform commission: <CommissionPct />%.</strong>
          </p>

          <h2>5. Payouts</h2>
          <p>
            Creator payouts may be made after KYC verification, minimum payout threshold, refund
            window checks, and internal review.
          </p>
          <p>
            <strong>Initial minimum payout threshold: ₹500.</strong>
          </p>

          <h2>6. Refunds and Adjustments</h2>
          <p>
            If a learner receives a refund, the creator&rsquo;s earnings may be adjusted
            accordingly.
          </p>

          <h2>7. Tax and Compliance</h2>
          <p>
            Creators are responsible for providing correct details and complying with applicable tax
            requirements.
          </p>

          <h2>8. Prohibited Content</h2>
          <p>
            Creators must not upload illegal, plagiarized, misleading, harmful, or abusive content.
          </p>

          <h2>9. Contact</h2>
          <p>
            For creator-related queries, contact{" "}
            <a href="mailto:support@learnrift.site" className="underline">
              support@learnrift.site
            </a>
            .
          </p>
        </article>
      </main>
      <Footer />
    </>
  );
}
