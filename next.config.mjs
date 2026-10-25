import { withSentryConfig } from "@sentry/nextjs/config";
import withPWAInit from "next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
  fallbacks: { document: "/offline" },
  // Only static assets are cached. Pages and API responses always come from the network,
  // so prices, invoices and payment status are never served stale from the service worker.
  runtimeCaching: [
    {
      urlPattern: /\/_next\/static\/.*/i,
      handler: "CacheFirst",
      options: { cacheName: "next-static", expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 } },
    },
    {
      urlPattern: /\.(?:png|jpg|jpeg|webp|svg|ico|woff2?)$/i,
      handler: "StaleWhileRevalidate",
      options: { cacheName: "assets", expiration: { maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 7 } },
    },
    // next-pwa attaches the offline fallback through `options`, so every rule needs one.
    { urlPattern: /.*/i, handler: "NetworkOnly", options: {} },
  ],
});

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Loaded from node_modules at runtime instead of bundled into every route (Sentry's OpenTelemetry tree is large).
    serverComponentsExternalPackages: ["@prisma/client", "@react-pdf/renderer", "@sentry/nextjs", "@sentry/node", "@sentry/opentelemetry"],
    // Order and payment status must never come from a stale client-side cache.
    staleTimes: { dynamic: 0 },
    instrumentationHook: true,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// The Sentry build plugin (source maps, auto-instrumentation) multiplies build time, so it only
// runs where it can upload maps. Without it, Sentry still starts from src/instrumentation.ts
// (server) and src/app/providers.tsx (browser), and API errors are reported by route().
export default process.env.SENTRY_AUTH_TOKEN
  ? withSentryConfig(withPWA(nextConfig), {
      silent: true,
      telemetry: false,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
    })
  : withPWA(nextConfig);
