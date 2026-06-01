import type { NextConfig } from "next";
import path from "node:path";

// NEXT_PUBLIC_* values are inlined into the browser bundle at build time. Warn
// loudly (but don't fail the build) if a production build would ship a bundle
// that calls localhost — the correct production value is "/api" (same-origin,
// proxied to the gateway via the rewrite below) or the public API URL.
if (process.env.NODE_ENV === "production") {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (apiUrl && /localhost|127\.0\.0\.1/.test(apiUrl)) {
    console.warn(
      `⚠ NEXT_PUBLIC_API_URL="${apiUrl}" points at localhost. Production browsers ` +
        `will call localhost. Set NEXT_PUBLIC_API_URL=/api (or your public API URL) before building.`,
    );
  }
}

const nextConfig: NextConfig = {
  // Pin the file-tracing root to this app. The repo now has lockfiles at the
  // root and in frontend/, so Next.js can no longer unambiguously infer the
  // workspace root — set it explicitly to silence the warning.
  outputFileTracingRoot: path.join(__dirname),
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "api.dicebear.com" },
      { protocol: "https", hostname: "img.youtube.com" },
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "framer-motion"],
  },
  async redirects() {
    return [
      { source: "/refunds", destination: "/refund-policy", permanent: true },
      { source: "/delivery", destination: "/digital-delivery-policy", permanent: true },
    ];
  },
  async rewrites() {
    const apiGateway = process.env.API_GATEWAY_URL || "http://localhost:4000";
    return [
      { source: "/api/:path*", destination: `${apiGateway}/api/:path*` },
    ];
  },
};

export default nextConfig;
