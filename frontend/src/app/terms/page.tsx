import type { Metadata } from "next";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { SITE_NAME } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Terms and Conditions",
  description: `Terms and Conditions for using ${SITE_NAME}.`,
};

export default function TermsPage() {
  return (
    <>
      <Navbar variant="public" />
      <main className="mx-auto max-w-3xl px-4 py-12 md:px-6">
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-fg-dim">Legal</p>
          <h1 className="heading-2 mt-1">Terms and Conditions</h1>
        </header>

        <article className="markdown-view card space-y-4">
          <p>Welcome to LearnRift.</p>
          <p>By using LearnRift, you agree to these Terms and Conditions.</p>

          <h2>1. About LearnRift</h2>
          <p>
            LearnRift is an online education platform where learners can access digital courses and
            educational content.
          </p>

          <h2>2. User Accounts</h2>
          <p>
            Users are responsible for maintaining the confidentiality of their login credentials.
          </p>

          <h2>3. Course Access</h2>
          <p>
            Paid course access is provided digitally through the learner dashboard after successful
            payment.
          </p>

          <h2>4. Payments</h2>
          <p>
            Payments are processed through third-party payment gateway providers. LearnRift does not
            store card, UPI, or banking details directly.
          </p>

          <h2>5. Refunds</h2>
          <p>
            Refunds are governed by the{" "}
            <a href="/refund-policy" className="underline">
              Cancellation and Refund Policy
            </a>{" "}
            available on the website.
          </p>

          <h2>6. Creator Content</h2>
          <p>
            Courses may be created by independent creators. LearnRift may review, approve, reject,
            suspend, or remove content that violates platform rules.
          </p>

          <h2>7. Prohibited Use</h2>
          <p>
            Users must not misuse the platform, copy paid content, share unauthorized access, upload
            harmful content, or violate applicable laws.
          </p>

          <h2>8. Account Suspension</h2>
          <p>
            LearnRift may suspend accounts involved in fraud, abuse, policy violation, or illegal
            activity.
          </p>

          <h2>9. Changes to Terms</h2>
          <p>LearnRift may update these terms from time to time.</p>

          <h2>10. Contact</h2>
          <p>
            For questions, contact{" "}
            <a href="mailto:legal@learnrift.site" className="underline">
              legal@learnrift.site
            </a>
            .
          </p>
        </article>
      </main>
      <Footer />
    </>
  );
}
