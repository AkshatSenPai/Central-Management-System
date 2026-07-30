import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isPublic =
        pathname.startsWith("/login") || pathname.startsWith("/invite");
      if (isPublic) return true;
      return !!auth?.user;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
