import Link from "next/link";
import { SITE_NAME } from "@/lib/utils";

export function Logo({ size = 28, showText = true, href = "/" }: { size?: number; showText?: boolean; href?: string }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-2.5">
      <span
        className="relative inline-flex shrink-0 items-center justify-center rounded-xl"
        style={{ width: size, height: size }}
      >
        <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden role="img">
          <defs>
            <linearGradient id="lr-logo" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--brand-primary)" />
              <stop offset="1" stopColor="var(--brand-accent)" />
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="28" height="28" rx="8.5" fill="url(#lr-logo)" />
          {/* Upward arrowhead = "rise" (learning/growth); the gap in the shaft = the "rift". */}
          <path d="M9.5 15 L16 8.5 L22.5 15" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M16 12.2 L16 15.4" stroke="white" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M16 18.6 L16 23.2" stroke="white" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
        <span className="pointer-events-none absolute -inset-1 rounded-2xl bg-brand/40 opacity-0 blur-xl transition group-hover:opacity-100" />
      </span>
      {showText && (
        <span className="font-display text-base font-semibold leading-none tracking-tight md:text-lg">
          <span className="gradient-text">{SITE_NAME}</span>
        </span>
      )}
    </Link>
  );
}
