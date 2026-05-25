import Link from "next/link";
import { Github, Linkedin, Twitter, Instagram } from "lucide-react";
import { Logo } from "./Logo";
import { SITE_NAME } from "@/lib/utils";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border bg-surface/40 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 py-12 md:px-6">
        <div className="grid gap-10 md:grid-cols-4">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-sm text-fg-dim">
              Learn CS from people who just got it. Teach what you know. Get paid.
            </p>
            <div className="mt-4 flex gap-2">
              {[Twitter, Linkedin, Github, Instagram].map((Icon, i) => (
                <a
                  key={i}
                  href="#"
                  aria-label="social"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-2 text-fg-dim transition hover:border-brand hover:text-fg"
                >
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>
          <FooterCol title="Platform" links={[["Browse Courses", "/catalog"], ["Creators", "/creators"], ["Become a Creator", "/signup"], ["Pricing", "/pricing"]]} />
          <FooterCol
            title="Legal & Policies"
            links={[
              ["Terms and Conditions", "/terms"],
              ["Privacy Policy", "/privacy"],
              ["Refund Policy", "/refund-policy"],
              ["Digital Delivery Policy", "/digital-delivery-policy"],
              ["Contact Us", "/contact"],
              ["Creator Terms", "/creator-terms"],
              ["Learner Terms", "/learner-terms"],
            ]}
          />
          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fg-dim">CS-Ranger</h4>
            <ul className="space-y-2 text-sm">
              <li className="text-fg-dim">
                Website:{" "}
                <a
                  href="https://cs-ranger.in"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-fg-dim transition hover:text-fg"
                >
                  https://cs-ranger.in
                </a>
              </li>
              <li className="text-fg-dim">
                Support:{" "}
                <a href="mailto:support@cs-ranger.in" className="text-fg-dim transition hover:text-fg">
                  support@cs-ranger.in
                </a>
              </li>
              <li className="text-fg-dim">
                Legal:{" "}
                <a href="mailto:legal@cs-ranger.in" className="text-fg-dim transition hover:text-fg">
                  legal@cs-ranger.in
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 text-xs text-fg-dim md:flex-row">
          <p>© {new Date().getFullYear()} {SITE_NAME}. All rights reserved.</p>
          <p>Made with care for students, in India.</p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fg-dim">{title}</h4>
      <ul className="space-y-2 text-sm">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="text-fg-dim transition hover:text-fg">{label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
