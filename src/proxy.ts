import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Next.js 16 renamed the `middleware.ts` file convention to `proxy.ts` (same
// request-interception mechanism, same lifecycle) — see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md.
// `NextAuth(authConfig).auth` still returns a (request, event) => Response
// function with the same shape Next.js expects here, so it plugs in directly.
export default NextAuth(authConfig).auth;

/** Everything not listed here is auth-gated.
 *
 * `manifest.webmanifest` and `icons/` are excluded because the PWA install
 * flow fetches them **without credentials**, and an auth redirect turns them
 * into the login page's HTML. The symptom is not an error anybody sees: the
 * browser simply never offers to install the app, or installs it wearing a
 * blank icon. Confirmed by fetching /manifest.webmanifest and getting the
 * sign-in page back.
 *
 * Nothing behind these paths is private — the manifest is the app's name,
 * colours and icon list, and the icons are a logo.
 *
 * **A service worker will need the same treatment when push lands.** A worker
 * must be served from the scope it controls and cannot sit behind a redirect,
 * so whatever path it takes must be added to this list in the same change. */
export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)"],
};
