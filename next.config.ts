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
};

export default nextConfig;
