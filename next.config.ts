import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @sparticuz/chromium ships a binary in node_modules/@sparticuz/chromium/bin
  // which gets relocated/lost if bundled. Externalize so Vercel keeps it.
  serverExternalPackages: ['@sparticuz/chromium', 'playwright-core'],
};

export default nextConfig;
