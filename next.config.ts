import type { NextConfig } from "next";

// `npm run build:pages` sets this to build the Cloudflare Pages site: a static
// export, with the API served by Pages Functions (functions/api) instead.
const pagesExport = process.env.PAGES_EXPORT === "1";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  turbopack: { root: process.cwd() },
  // Lets the dev server answer requests through a Cloudflare quick tunnel.
  allowedDevOrigins: ["*.trycloudflare.com"],
  ...(pagesExport && {
    output: "export",
    // Only .tsx counts as a route, so the route.ts handlers stay out of the
    // export; functions/api/[[path]].ts serves them on Pages.
    pageExtensions: ["tsx"],
    images: { unoptimized: true },
  }),
};

export default nextConfig;
