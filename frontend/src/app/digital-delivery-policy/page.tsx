import type { Metadata } from "next";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { SITE_NAME } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Digital Delivery Policy",
  description: `How ${SITE_NAME} delivers digital course access after payment.`,
};

export default function DigitalDeliveryPolicyPage() {
  return (
    <>
      <Navbar variant="public" />
      <main className="mx-auto max-w-3xl px-4 py-12 md:px-6">
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-fg-dim">Legal</p>
          <h1 className="heading-2 mt-1">Digital Delivery Policy</h1>
        </header>

        <article className="markdown-view card space-y-4">
          <p>
            CS-Ranger provides digital educational content and online course access.
          </p>

          <p>
            After successful payment, users can access purchased courses through their CS-Ranger
            learner dashboard.
          </p>

          <p>
            <strong>No physical product is shipped.</strong>
          </p>

          <p>
            Course access is usually activated instantly after successful payment confirmation. In
            rare cases, activation may take additional time due to payment gateway confirmation or
            technical issues.
          </p>

          <p>
            For access-related issues, contact:{" "}
            <a href="mailto:support@cs-ranger.in" className="underline">
              support@cs-ranger.in
            </a>
          </p>
        </article>
      </main>
      <Footer />
    </>
  );
}
