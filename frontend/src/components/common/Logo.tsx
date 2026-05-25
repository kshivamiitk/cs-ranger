import Link from "next/link";
import { SITE_NAME } from "@/lib/utils";

export function Logo({ size = 28, showText = true, href = "/" }: { size?: number; showText?: boolean; href?: string }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-2.5">
      <span
        className="relative inline-flex items-center justify-center rounded-xl"
        style={{ width: size, height: size }}
      >
        <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
          <defs>
            <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--brand-primary)" />
              <stop offset="1" stopColor="var(--brand-accent)" />
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="28" height="28" rx="9" fill="url(#lg)" />
          <path
            d="M9 21V11l5 6 5-6v10"
            stroke="white"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <circle cx="23" cy="11" r="1.6" fill="white" />
        </svg>
        <span className="pointer-events-none absolute -inset-1 rounded-2xl bg-brand/40 opacity-0 blur-xl transition group-hover:opacity-100" />
      </span>
      {showText && (
        <span className="font-display text-base font-semibold tracking-tight md:text-lg">
          <span className="gradient-text">{SITE_NAME}</span>
        </span>
      )}
    </Link>
  );
}
