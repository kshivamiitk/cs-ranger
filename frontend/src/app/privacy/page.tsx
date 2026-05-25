import type { Metadata } from "next";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { SITE_NAME } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `Privacy Policy for ${SITE_NAME}.`,
};

export default function PrivacyPage() {
  return (
    <>
      <Navbar variant="public" />
      <main className="mx-auto max-w-3xl px-4 py-12 md:px-6">
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-fg-dim">Legal</p>
          <h1 className="heading-2 mt-1">Privacy Policy</h1>
        </header>

        <article className="markdown-view card space-y-4">
          <p>CS-Ranger respects user privacy.</p>

          <h2>1. Information We Collect</h2>
          <p>
            We may collect name, email address, phone number, profile information, course activity,
            payment status, support messages, and technical usage data.
          </p>

          <h2>2. How We Use Information</h2>
          <p>
            We use information to create accounts, provide course access, process payments, manage
            support, improve the platform, prevent fraud, and send important notifications.
          </p>

          <h2>3. Payments</h2>
          <p>
            Payments are processed through third-party payment gateway providers. CS-Ranger does not
            directly store sensitive card or banking details.
          </p>

          <h2>4. Cookies and Analytics</h2>
          <p>
            We may use cookies or analytics tools to improve user experience and platform
            performance.
          </p>

          <h2>5. Data Sharing</h2>
          <p>
            We may share limited data with service providers required for payments, email, hosting,
            analytics, support, and legal compliance.
          </p>

          <h2>6. Data Security</h2>
          <p>We use reasonable security measures to protect user information.</p>

          <h2>7. User Requests</h2>
          <p>Users may contact us for account, privacy, or data-related requests.</p>

          <h2>8. Contact</h2>
          <p>
            For privacy-related questions, contact{" "}
            <a href="mailto:legal@cs-ranger.in" className="underline">
              legal@cs-ranger.in
            </a>
            .
          </p>
        </article>
      </main>
      <Footer />
    </>
  );
}
