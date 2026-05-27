import type { Metadata } from "next";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { SITE_NAME } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Cancellation and Refund Policy",
  description: `Cancellation and Refund Policy for ${SITE_NAME}.`,
};

export default function RefundPolicyPage() {
  return (
    <>
      <Navbar variant="public" />
      <main className="mx-auto max-w-3xl px-4 py-12 md:px-6">
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-fg-dim">Legal</p>
          <h1 className="heading-2 mt-1">Cancellation and Refund Policy</h1>
        </header>

        <article className="markdown-view card space-y-4">
          <p>LearnRift sells digital educational course access.</p>

          <h2>Refund Window</h2>
          <p>Users may request a refund within 7 days of purchase.</p>

          <h2>Refund Eligibility</h2>
          <p>A refund may be approved if:</p>
          <ul>
            <li>the user purchased the wrong course by mistake,</li>
            <li>course access was not provided after successful payment,</li>
            <li>duplicate payment was made,</li>
            <li>there was a technical issue preventing access.</li>
          </ul>

          <p>Refunds may be rejected if:</p>
          <ul>
            <li>the user has substantially consumed the course,</li>
            <li>the refund window has passed,</li>
            <li>the request appears abusive or fraudulent,</li>
            <li>the course clearly matched the description before purchase.</li>
          </ul>

          <h2>Refund Processing</h2>
          <p>
            Approved refunds will be processed to the original payment method through the payment
            gateway. Processing time may depend on the bank/payment provider.
          </p>

          <h2>Contact</h2>
          <p>
            <a href="mailto:support@learnrift.site" className="underline">
              support@learnrift.site
            </a>
          </p>
        </article>
      </main>
      <Footer />
    </>
  );
}
