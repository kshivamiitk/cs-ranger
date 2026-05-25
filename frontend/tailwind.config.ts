import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx,js,jsx,md,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        "surface-2": "var(--color-surface-2)",
        border: "var(--color-border)",
        muted: "var(--color-muted)",
        fg: "var(--color-fg)",
        "fg-dim": "var(--color-fg-dim)",
        brand: {
          DEFAULT: "var(--brand-primary)",
          accent: "var(--brand-accent)",
          glow: "var(--brand-glow)",
        },
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        danger: "var(--color-danger)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        display: ["var(--font-display)", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "brand-gradient":
          "linear-gradient(135deg, var(--brand-primary) 0%, var(--brand-accent) 100%)",
        "radial-fade":
          "radial-gradient(circle at 50% 0%, var(--brand-glow) 0%, transparent 60%)",
        "mesh-1":
          "radial-gradient(at 0% 0%, var(--brand-primary) 0px, transparent 50%), radial-gradient(at 100% 0%, var(--brand-accent) 0px, transparent 50%), radial-gradient(at 50% 100%, var(--brand-glow) 0px, transparent 50%)",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(255,255,255,0.06), 0 8px 32px -8px var(--brand-glow)",
        "glow-lg":
          "0 0 0 1px rgba(255,255,255,0.06), 0 24px 64px -16px var(--brand-glow)",
        glass:
          "inset 0 1px 0 0 rgba(255,255,255,0.05), 0 8px 24px -8px rgba(0,0,0,0.4)",
      },
      animation: {
        "fade-in": "fadeIn 0.4s ease-out",
        "slide-up": "slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
        shimmer: "shimmer 2.4s linear infinite",
        float: "float 6s ease-in-out infinite",
        "pulse-glow": "pulseGlow 3s ease-in-out infinite",
        "spin-slow": "spin 12s linear infinite",
      },
      keyframes: {
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        slideUp: {
          "0%": { transform: "translateY(12px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        pulseGlow: {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "0.9" },
        },
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};

export default config;
