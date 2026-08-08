import type { MetadataRoute } from "next";

/** The web app manifest, at `app/manifest.ts` — this version's file convention
 * for it (bundled docs: `01-app/03-api-reference/03-file-conventions/
 * 01-metadata/manifest.md`). Next serves it at `/manifest.webmanifest` and
 * links it from every page, so nothing has to be added to the root layout.
 *
 * Two reasons this exists, in order of how soon they matter:
 *
 * 1. **The team works from phones**, and after the mobile pass the app is
 *    worth keeping on a home screen rather than hunting for in a browser tab.
 *    `display: "standalone"` is what drops the address bar so it opens like an
 *    app.
 * 2. **iOS delivers Web Push only to a site installed to the home screen.**
 *    Without a manifest there is no install, so on iPhones this file is a hard
 *    prerequisite for notifications rather than a nicety.
 *
 * It is a Route Handler under the hood and is cached — it reads no
 * request-time API, so it prerenders and stays static. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Meridian Ops",
    short_name: "Meridian",
    description: "The studio's internal operations hub — clients, projects, tasks and the team.",

    // Both point at the app's real entry rather than "/": that route only
    // redirects to /my-tasks, and an installed app that opens on a redirect
    // shows a blank frame for a beat every single launch.
    start_url: "/my-tasks",
    scope: "/",

    display: "standalone",
    orientation: "portrait",

    // Matches the light theme's --bg and --btn. A manifest cannot read CSS
    // variables — it is JSON to the browser, parsed long before any stylesheet
    // — so these are necessarily literals, and the pairing is what stops the
    // splash screen flashing a colour the app never uses.
    background_color: "#f6f6f7",
    theme_color: "#4b53c9",

    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Separate from the plain 512 on purpose: a maskable icon may be cropped
      // to a circle by the launcher, so its mark is inset to survive that. The
      // full-bleed one would lose its corners.
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
