import type { NextConfig } from "next";
import pkg from "./package.json";

/**
 * basePath: configurable for GitHub Pages subpath deployment.
 *
 * - Self-hosting at root domain (e.g. modbus.example.com): leave empty.
 * - GitHub Pages project site (e.g. user.github.io/modbus-analyzer):
 *   set NEXT_PUBLIC_BASE_PATH=/modbus-analyzer at build time.
 *
 * The trailing slash must NOT be present.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, '') || '';

const nextConfig: NextConfig = {
  // Static export for GitHub Pages / any static host (Cloudflare Pages,
  // Netlify, nginx, Caddy, S3+CloudFront, etc).
  output: "export",
  // GitHub Pages serves /index.html for directory roots.
  trailingSlash: true,
  // basePath must be set both at build-time and runtime for static export.
  basePath,
  assetPrefix: basePath || undefined,
  // Disable server-side image optimization (we use SVG icons only).
  images: {
    unoptimized: true,
  },
  // Expose app version to client-side code as a build-time constant.
  // This avoids fragile JSON imports — Next.js inlines the value at build.
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_APP_NAME: pkg.name,
  },
  typescript: {
    // Type errors are caught by `tsc --noEmit` in CI; build should still
    // succeed so users can deploy even with minor type issues.
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
