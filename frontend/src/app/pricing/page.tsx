import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { SITE_NAME } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Pricing details for ${SITE_NAME} — how learners pay and how creators earn.`,
};

export default function PricingPage() {
  return (
    <>
      <Navbar variant="public" />
      <main className="mx-auto max-w-4xl px-4 py-12 md:px-6">
        <header className="mb-10 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-fg-dim">Pricing</p>
          <h1 className="heading-2 mt-1">Simple pricing. No surprises.</h1>
          <p className="mt-3 text-sm text-fg-dim">
            All prices are in Indian Rupees (INR) and inclusive of applicable GST.
          </p>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="card">
            <h3 className="font-display text-xl font-semibold">For Learners</h3>
            <p className="mt-1 text-sm text-fg-dim">Pay per course. Lifetime access.</p>
            <ul className="mt-4 space-y-2 text-sm">
              <li>• Free to sign up &mdash; browse the full catalog without paying.</li>
              <li>• Course prices are set by the creator. Typical range: <strong>&#8377;299 &ndash; &#8377;4,999</strong>.</li>
              <li>• One-time payment, lifetime access to all current content of that course.</li>
              <li>• Future updates to the same course are included free.</li>
              <li>• 7-day money-back guarantee &mdash; see <Link href="/refund-policy" className="underline">Refund Policy</Link>.</li>
            </ul>
          </div>

          <div className="card">
            <h3 className="font-display text-xl font-semibold">For Creators</h3>
            <p className="mt-1 text-sm text-fg-dim">Keep most of what you earn.</p>
            <ul className="mt-4 space-y-2 text-sm">
              <li>• Free to publish. No setup or listing fees.</li>
              <li>• Platform fee: <strong>15%</strong> of the net amount per sale.</li>
              <li>• Payment gateway fee (Razorpay): typically <strong>2%</strong> &mdash; passed through at cost.</li>
              <li>• GST is collected and remitted as required by law.</li>
              <li>• Payouts are processed weekly to your verified bank account.</li>
            </ul>
            <p className="mt-3 text-xs text-fg-dim">
              Example: on a &#8377;1,000 sale, the creator receives ~&#8377;830 after platform and gateway fees,
              before GST adjustments.
            </p>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="heading-3">What&rsquo;s included for everyone</h2>
          <div className="card mt-3 text-sm text-fg-dim">
            <ul className="space-y-2">
              <li>• Secure payments via Razorpay (UPI, cards, net banking, wallets).</li>
              <li>• Streaming video, downloadable resources, and inline doubts.</li>
              <li>• Progress tracking, bookmarks, and certificates of completion.</li>
              <li>• Email support within 24 hours on business days.</li>
            </ul>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="heading-3">Taxes</h2>
          <p className="mt-2 text-sm text-fg-dim">
            Prices shown at checkout are inclusive of GST where applicable. A tax invoice is issued for every
            transaction and is available from your <Link href="/transactions" className="underline">Transactions</Link>{" "}
            page.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="heading-3">Questions about pricing?</h2>
          <p className="mt-2 text-sm text-fg-dim">
            Email <a href="mailto:support@learnrift.dev" className="underline">support@learnrift.dev</a>. The full
            commercial terms live in our <Link href="/terms" className="underline">Terms and Conditions</Link>,{" "}
            <Link href="/learner-terms" className="underline">Learner Terms</Link>, and{" "}
            <Link href="/creator-terms" className="underline">Creator Terms</Link>.
          </p>
        </section>

        <p className="mt-10 text-center text-xs text-fg-dim">
          {SITE_NAME} reserves the right to revise pricing. Existing purchases are not affected by future price
          changes.
        </p>
      </main>
      <Footer />
    </>
  );
}
