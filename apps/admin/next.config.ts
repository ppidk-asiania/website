import path from "node:path";
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const standalone: NextConfig =
  process.env["NEXT_OUTPUT"] === "standalone"
    ? { output: "standalone", outputFileTracingRoot: path.resolve(import.meta.dirname, "../..") }
    : {};

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  cacheComponents: true,
  experimental: { authInterrupts: true },
  transpilePackages: [
    "@website/audit",
    "@website/auth",
    "@website/config",
    "@website/db",
    "@website/domain",
    "@website/email",
    "@website/observability",
    "@website/permissions",
    "@website/ui",
  ],
  serverExternalPackages: ["mysql2"],
  ...standalone,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The door scanner is the one page that may use the camera (N1.4); a later rule overrides the first.
      {
        source: "/events/:id/scan",
        headers: [
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
