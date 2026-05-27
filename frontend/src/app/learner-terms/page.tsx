import type { Metadata } from "next";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { SITE_NAME } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Learner Terms",
  description: `Learner Terms for accessing courses on ${SITE_NAME}.`,
};

export default function LearnerTermsPage() {
  return (
    <>
      <Navbar variant="public" />
      <main className="mx-auto max-w-3xl px-4 py-12 md:px-6">
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-fg-dim">Legal</p>
          <h1 className="heading-2 mt-1">Learner Terms</h1>
        </header>

        <article className="markdown-view card space-y-4">
          <p>These Learner Terms apply to users who access courses on LearnRift.</p>

          <h2>1. Course Access</h2>
          <p>
            Learners can access enrolled or purchased courses through their dashboard.
          </p>

          <h2>2. Personal Use</h2>
          <p>
            Course access is for personal learning use only. Sharing login credentials or
            redistributing paid content is not allowed.
          </p>

          <h2>3. Payments</h2>
          <p>Paid course access is activated after successful payment confirmation.</p>

          <h2>4. Refunds</h2>
          <p>
            Refunds are handled according to the{" "}
            <a href="/refund-policy" className="underline">
              Cancellation and Refund Policy
            </a>
            .
          </p>

          <h2>5. Doubts, Comments, and Conduct</h2>
          <p>
            Learners must communicate respectfully and must not post spam, abuse, illegal content,
            or harassment.
          </p>

          <h2>6. Account Suspension</h2>
          <p>
            LearnRift may suspend accounts involved in misuse, fraud, abuse, or policy violations.
          </p>

          <h2>7. Contact</h2>
          <p>
            For learner support, contact{" "}
            <a href="mailto:support@learnrift.in" className="underline">
              support@learnrift.in
            </a>
            .
          </p>
        </article>
      </main>
      <Footer />
    </>
  );
}
