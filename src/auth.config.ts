import type { NextAuthConfig } from "next-auth";
import { isPublicPath } from "@/lib/public-paths";

export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (isPublicPath(pathname)) return true;
      return !!auth?.user;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
