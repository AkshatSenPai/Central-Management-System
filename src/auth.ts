import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import type { Provider } from "next-auth/providers";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { withNormalizedEmail } from "@/lib/auth-adapter";
import { authorizeUser } from "@/lib/credentials";
import { googleSignInAllowed } from "@/lib/google-gate";
import { refreshTokenFromDb } from "@/lib/session-freshness";
import { authConfig } from "@/auth.config";

const providers: Provider[] = [
  Credentials({
    credentials: { email: {}, password: {} },
    async authorize(credentials) {
      const email = typeof credentials?.email === "string" ? credentials.email : "";
      const password =
        typeof credentials?.password === "string" ? credentials.password : "";
      if (!email || !password) return null;
      return authorizeUser(prisma, email, password);
    },
  }),
];

export const googleEnabled = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
);
if (googleEnabled) {
  // Safe because Google verifies email ownership; lets an invited member who
  // set a password also sign in with Google on the same account.
  providers.push(Google({ allowDangerousEmailAccountLinking: true }));
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // Normalized so allowDangerousEmailAccountLinking's getUserByEmail lookup
  // matches stored lowercase emails even when Google reports mixed case.
  adapter: withNormalizedEmail(PrismaAdapter(prisma)),
  providers,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      // Invite-only: Google may only sign in emails that already exist as active members.
      if (account?.provider === "google") {
        return googleSignInAllowed(prisma, user.email);
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: "ADMIN" | "MEMBER" }).role ?? "MEMBER";
      }
      // Re-verify role/active against the DB on every invocation (not just
      // first sign-in) so revocation (deactivation/demotion/promotion)
      // takes effect on the next request instead of lagging up to the
      // session's 7-day maxAge. Returning null here invalidates the
      // session — see src/lib/session-freshness.ts for the evidence.
      return refreshTokenFromDb(prisma, token);
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = (token.role as "ADMIN" | "MEMBER") ?? "MEMBER";
      return session;
    },
  },
});
