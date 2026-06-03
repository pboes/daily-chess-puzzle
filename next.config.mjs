/** @type {import('next').NextConfig} */

// The Circles host embeds the mini-app in an iframe and serves it from
// *.gnosis.io. We must allow being framed there, and relax CSP so the
// embedded page can talk to the Circles RPC / score-groups backend / Lichess.
const ContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://rpc.aboutcircles.com https://rpc.staging.aboutcircles.com https://lichess.org https://*.gnosis.io https://*.upstash.io",
  "frame-ancestors 'self' https://*.gnosis.io https://*.aboutcircles.com",
].join("; ");

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: ContentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
