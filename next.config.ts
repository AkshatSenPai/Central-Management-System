import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Enables React's <ViewTransition>. The component itself is typed in
   * @types/react/canary.d.ts, not index.d.ts — it resolves only because
   * tsconfig.json sets no `compilerOptions.types`, so TypeScript auto-includes
   * every @types package and canary.d.ts lands in the program.
   *
   * Setting `compilerOptions.types` would therefore break every
   * `import { ViewTransition } from "react"` in the app. If you ever need that
   * key, add "react/canary" to the array.
   */
  experimental: {
    viewTransition: true,
  },

  /**
   * The 74 contract templates.
   *
   * File tracing works by following `import` statements, and
   * `contract-template.ts` reads these files by a path it builds at runtime
   * from the deal — which is the whole point of spec §03's "build it from the
   * deal, don't hardcode a lookup table", and is also invisible to the
   * tracer. Without this entry the directory is simply absent from the
   * deployment: every contract renders in `next dev` and every one throws
   * ENOENT in production.
   *
   * `/*` rather than a narrower route glob because three server entry points
   * reach the templates — the register page, the contract detail page and the
   * print route — and a list of three globs is three chances for the next
   * page that renders a contract to be the one nobody remembered to add.
   * 2.2 MB, and the deployment is not sensitive to it.
   */
  outputFileTracingIncludes: {
    "/*": ["src/contract-templates/**/*"],
  },

  /**
   * The service worker must never be cached.
   *
   * A worker is fetched by the browser, not by the page, and whatever copy it
   * holds keeps running until it fetches a byte-different one. Let a CDN or
   * the browser hold `sw.js` for its default lifetime and a fixed push bug
   * sits behind the old worker for hours — on devices whose owners have no way
   * to know, and cannot fix by reloading the page. `no-store` costs one small
   * request per navigation and removes that entire class of problem.
   *
   * The explicit content-type is belt-and-braces: a worker served as anything
   * other than a JavaScript MIME type is rejected at registration, and the
   * failure surfaces only in the console of whoever happens to look.
   */
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
