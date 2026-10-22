import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Emits .next/standalone with a self-contained server.js; the Dockerfile copies only that.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
