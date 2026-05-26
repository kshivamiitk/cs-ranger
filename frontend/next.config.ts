import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
