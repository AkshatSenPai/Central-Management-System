import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Next.js 16 renamed the `middleware.ts` file convention to `proxy.ts` (same
// request-interception mechanism, same lifecycle) — see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md.
// `NextAuth(authConfig).auth` still returns a (request, event) => Response
// function with the same shape Next.js expects here, so it plugs in directly.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
