# Internal CMS — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running Next.js + Postgres app with invite-only authentication (email/password + optional Google), Admin/Member roles, member profiles, member administration, and the sidebar app shell — the foundation every later phase builds on.

**Architecture:** Modular monolith Next.js (App Router) with Server Actions for all mutations. Postgres via Prisma. Auth.js v5 with JWT sessions (required for the Credentials provider), a Prisma adapter for Google account linking, and a split config so middleware stays edge-safe. Business logic lives in `src/lib/*` as pure-ish functions taking a `db` parameter so it can be unit-tested with fake DB objects.

**Tech Stack:** Next.js 15 (App Router, TypeScript, Tailwind v4) · Prisma + Postgres (Neon) · next-auth@beta (Auth.js v5) + @auth/prisma-adapter · @node-rs/argon2 · zod · next-themes · Vitest.

**Spec:** `docs/superpowers/specs/2026-07-29-internal-cms-design.md` (§5.1 Team & Auth, §8 Security, §10 Phase 1)

## Global Constraints

- TypeScript strict mode; App Router only (no pages router).
- All Server Actions return `ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }` (from `src/lib/action-result.ts`) — never throw to the client, never fail silently.
- Passwords hashed with argon2id via `@node-rs/argon2`. Plaintext passwords never logged or stored.
- Roles: Prisma enum `Role { ADMIN, MEMBER }`. Members are **deactivated, never deleted**.
- Registration is **invite-only**. Invite tokens: 32 random bytes base64url, TTL 7 days, single-use.
- Google sign-in is allowed **only** for emails that already have a User row (created via invite) — enforced in the `signIn` callback.
- Session: JWT strategy, `maxAge` 7 days, carries `user.id` and `user.role`.
- Secrets live in `.env` (gitignored); `.env.example` is tracked and lists every variable with placeholder values.
- Path alias `@/*` → `src/*`. Tests live in `tests/`, run with `npm test` (Vitest).
- Styling in this phase is deliberately plain Tailwind — the visual design arrives later from the Claude Design hand-off. Do not invest in polish; invest in structure.
- Commands shown as `npx`/`npm` run the same in PowerShell; PowerShell-specific syntax is called out where it differs.

---

### Task 1: Project Scaffold + Test Runner

**Files:**
- Create: entire Next.js scaffold at repo root (`src/app/*`, `package.json`, `tsconfig.json`, etc.)
- Create: `vitest.config.ts`, `tests/smoke.test.ts`, `.env.example`
- Modify: `.gitignore` (allow `.env.example`), `package.json` (scripts)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a running `npm run dev` app; `npm test` runs Vitest; `@/*` alias works in app and tests. All later tasks assume dependencies installed here: `next-auth@beta`, `@auth/prisma-adapter`, `@node-rs/argon2`, `zod`, `next-themes`, `prisma`, `@prisma/client`, `vitest`, `tsx`.

- [ ] **Step 1: Scaffold Next.js**

The repo root is `Internal CMS` (spaces/capitals break npm name validation), so scaffold into a temp folder and move the contents up. From repo root in PowerShell:

```powershell
npx create-next-app@latest internal-cms --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --disable-git
Get-ChildItem -Force internal-cms | Where-Object { $_.Name -ne ".git" } | Move-Item -Destination .
Remove-Item -Recurse -Force internal-cms
```

- [ ] **Step 2: Verify dev server**

Run: `npm run dev` → open http://localhost:3000
Expected: default Next.js welcome page renders. Stop the server.

- [ ] **Step 3: Install all Phase 1 dependencies**

```bash
npm install next-auth@beta @auth/prisma-adapter @node-rs/argon2 zod next-themes @prisma/client
npm install -D prisma vitest tsx
```

- [ ] **Step 4: Configure Vitest with a smoke test**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

Create `tests/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("test runner", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Add scripts to `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Run tests to verify the runner works**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 6: Environment plumbing**

Create `.env.example`:

```
# Postgres connection string (Neon: use the DIRECT connection string, not the pooler)
DATABASE_URL="postgresql://user:password@host/dbname?sslmode=require"

# Auth.js — generate with: npx auth secret
AUTH_SECRET="replace-me"

# Google OAuth (optional in dev; app works without it)
AUTH_GOOGLE_ID=""
AUTH_GOOGLE_SECRET=""

# First admin account, consumed by `npx prisma db seed`
ADMIN_EMAIL="admin@example.com"
ADMIN_NAME="Admin"
ADMIN_PASSWORD="change-me-min-8-chars"

# Base URL used to build invite links
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

Append to `.gitignore` (create-next-app's `.env*` pattern would hide the example file):

```
!.env.example
```

Copy `.env.example` to `.env` (values filled in during Task 2).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js app with Vitest and env plumbing"
```

---

### Task 2: Database Schema, Prisma Client, Admin Seed

**Files:**
- Create: `prisma/schema.prisma`, `prisma/seed.ts`, `src/lib/prisma.ts`, `src/lib/password.ts` (stub only — real implementation is Task 3)
- Modify: `package.json` (prisma seed hook), `.env` (DATABASE_URL, ADMIN_*)

**Interfaces:**
- Consumes: deps from Task 1
- Produces: `prisma` singleton (`import { prisma } from "@/lib/prisma"`), Prisma models `User`, `Invite`, `Account`, `Session`, `VerificationToken`, enum `Role`; a seeded ADMIN user. Later tasks call `prisma.user.*`, `prisma.invite.*`.

- [ ] **Step 1: Provision a Postgres database**

Create a free project at https://neon.tech → copy the **direct** connection string (not the pooled one) → paste into `DATABASE_URL` in `.env`. Also set real values for `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` (8+ chars).

- [ ] **Step 2: Write the schema**

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  ADMIN
  MEMBER
}

model User {
  id             String    @id @default(cuid())
  email          String    @unique
  name           String
  passwordHash   String?
  role           Role      @default(MEMBER)
  active         Boolean   @default(true)
  title          String?
  phone          String?
  avatarUrl      String?
  emailVerified  DateTime?
  image          String?
  accounts       Account[]
  sessions       Session[]
  invitesCreated Invite[]  @relation("InviteCreator")
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
}

model Invite {
  id          String    @id @default(cuid())
  email       String
  role        Role      @default(MEMBER)
  token       String    @unique
  expiresAt   DateTime
  acceptedAt  DateTime?
  createdBy   User      @relation("InviteCreator", fields: [createdById], references: [id])
  createdById String
  createdAt   DateTime  @default(now())
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}
```

- [ ] **Step 3: Run the migration**

Run: `npx prisma migrate dev --name init`
Expected: "Your database is now in sync with your schema" and a generated client.

- [ ] **Step 4: Prisma client singleton**

Create `src/lib/prisma.ts` (singleton prevents connection exhaustion from Next.js hot reload):

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 5: Seed the first admin**

The seed needs password hashing. Create `src/lib/password.ts` now with the real signatures (Task 3 adds its tests):

```ts
import { hash, verify } from "@node-rs/argon2";

export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export async function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plain);
  } catch {
    return false;
  }
}
```

Create `prisma/seed.ts`:

```ts
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? "Admin";
  if (!email || !password) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD in .env before seeding");
  }
  const passwordHash = await hashPassword(password);
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, passwordHash, role: "ADMIN" },
  });
  console.log(`Admin user ready: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

Add to `package.json` (top level, next to "scripts"):

```json
"prisma": {
  "seed": "tsx prisma/seed.ts"
}
```

- [ ] **Step 6: Run the seed and verify**

Run: `npx prisma db seed`
Expected: `Admin user ready: <your email>`.
Then run `npx prisma studio`, open the User table, confirm one row with role `ADMIN`, `active` true, and a `passwordHash` starting with `$argon2`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add Prisma schema, client singleton, and admin seed"
```

---

### Task 3: Password Hashing Module (TDD)

**Files:**
- Test: `tests/password.test.ts`
- Already created in Task 2: `src/lib/password.ts` (this task locks its behavior with tests)

**Interfaces:**
- Consumes: `@node-rs/argon2`
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(passwordHash: string, plain: string): Promise<boolean>` — used by seed (Task 2), credentials auth (Task 5), invite redemption (Task 9).

- [ ] **Step 1: Write the tests**

Create `tests/password.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("password hashing", () => {
  it("verifies a correct password against its hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "wrong password")).toBe(false);
  });

  it("produces argon2 hashes, never plaintext", async () => {
    const hash = await hashPassword("secret123");
    expect(hash).toMatch(/^\$argon2/);
    expect(hash).not.toContain("secret123");
  });

  it("returns false (not throws) for a malformed hash", async () => {
    expect(await verifyPassword("not-a-real-hash", "anything")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm test`
Expected: all pass (implementation exists from Task 2). If any fail, fix `src/lib/password.ts` — do not change the tests.

- [ ] **Step 3: Commit**

```bash
git add tests/password.test.ts
git commit -m "test: lock password hashing behavior"
```

---

### Task 4: Invite Token & Status Module (TDD)

**Files:**
- Create: `src/lib/invites.ts`, `src/lib/action-result.ts`
- Test: `tests/invites.test.ts`

**Interfaces:**
- Consumes: node `crypto`
- Produces:
  - `generateInviteToken(): string` (32 bytes, base64url)
  - `inviteStatus(invite: { expiresAt: Date; acceptedAt: Date | null }, now?: Date): "valid" | "expired" | "used"`
  - `inviteExpiry(from?: Date): Date` and `INVITE_TTL_DAYS = 7`
  - `ActionResult<T>` + helpers `ok(data)`, `err(message)` — the return convention for ALL Server Actions and service functions in later tasks.

- [ ] **Step 1: Write the failing tests**

Create `tests/invites.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  generateInviteToken,
  inviteStatus,
  inviteExpiry,
  INVITE_TTL_DAYS,
} from "@/lib/invites";

describe("generateInviteToken", () => {
  it("is url-safe and long enough", () => {
    const token = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
  });

  it("is unique across calls", () => {
    const tokens = new Set(Array.from({ length: 100 }, generateInviteToken));
    expect(tokens.size).toBe(100);
  });
});

describe("inviteStatus", () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);

  it("is valid when unexpired and unaccepted", () => {
    expect(inviteStatus({ expiresAt: future, acceptedAt: null })).toBe("valid");
  });

  it("is expired past expiresAt", () => {
    expect(inviteStatus({ expiresAt: past, acceptedAt: null })).toBe("expired");
  });

  it("is used once accepted — even if also expired", () => {
    expect(inviteStatus({ expiresAt: past, acceptedAt: past })).toBe("used");
  });
});

describe("inviteExpiry", () => {
  it(`is ${INVITE_TTL_DAYS} days out`, () => {
    const from = new Date("2026-07-29T00:00:00Z");
    expect(inviteExpiry(from).toISOString()).toBe("2026-08-05T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — "Cannot find module '@/lib/invites'".

- [ ] **Step 3: Implement**

Create `src/lib/invites.ts`:

```ts
import { randomBytes } from "crypto";

export const INVITE_TTL_DAYS = 7;

export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export type InviteStatus = "valid" | "expired" | "used";

export function inviteStatus(
  invite: { expiresAt: Date; acceptedAt: Date | null },
  now: Date = new Date()
): InviteStatus {
  if (invite.acceptedAt) return "used";
  if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}

export function inviteExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}
```

Create `src/lib/action-result.ts`:

```ts
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function err<T = void>(error: string): ActionResult<T> {
  return { ok: false, error };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/invites.ts src/lib/action-result.ts tests/invites.test.ts
git commit -m "feat: invite token/status helpers and ActionResult convention"
```

---

### Task 5: Credentials Authorization (TDD)

**Files:**
- Create: `src/lib/credentials.ts`
- Test: `tests/credentials.test.ts`

**Interfaces:**
- Consumes: `verifyPassword` (Task 3), `PrismaClient` type
- Produces: `authorizeUser(db: PrismaClient, email: string, password: string): Promise<AuthorizedUser | null>` with `type AuthorizedUser = { id: string; email: string; name: string; role: "ADMIN" | "MEMBER" }`. Task 6's Credentials provider calls this. Returns `null` (never throws) on any failure — Auth.js treats null as invalid login.

- [ ] **Step 1: Write the failing tests**

Create `tests/credentials.test.ts`. Fake-DB pattern used throughout the codebase's tests: build an object with just the delegates the function touches and cast it.

```ts
import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { authorizeUser } from "@/lib/credentials";
import { hashPassword } from "@/lib/password";

function fakeDb(user: unknown): PrismaClient {
  return {
    user: { findUnique: async () => user },
  } as unknown as PrismaClient;
}

const baseUser = async () => ({
  id: "u1",
  email: "jo@example.com",
  name: "Jo",
  role: "MEMBER" as const,
  active: true,
  passwordHash: await hashPassword("right-password"),
});

describe("authorizeUser", () => {
  it("returns the safe user shape on correct credentials", async () => {
    const db = fakeDb(await baseUser());
    const result = await authorizeUser(db, "jo@example.com", "right-password");
    expect(result).toEqual({ id: "u1", email: "jo@example.com", name: "Jo", role: "MEMBER" });
  });

  it("normalizes email case/whitespace before lookup", async () => {
    let lookedUp = "";
    const user = await baseUser();
    const db = {
      user: {
        findUnique: async (args: { where: { email: string } }) => {
          lookedUp = args.where.email;
          return user;
        },
      },
    } as unknown as PrismaClient;
    await authorizeUser(db, "  Jo@Example.COM ", "right-password");
    expect(lookedUp).toBe("jo@example.com");
  });

  it("rejects a wrong password", async () => {
    const db = fakeDb(await baseUser());
    expect(await authorizeUser(db, "jo@example.com", "wrong")).toBeNull();
  });

  it("rejects an unknown email", async () => {
    const db = fakeDb(null);
    expect(await authorizeUser(db, "ghost@example.com", "whatever")).toBeNull();
  });

  it("rejects a deactivated user even with the right password", async () => {
    const db = fakeDb({ ...(await baseUser()), active: false });
    expect(await authorizeUser(db, "jo@example.com", "right-password")).toBeNull();
  });

  it("rejects a Google-only user (no passwordHash)", async () => {
    const db = fakeDb({ ...(await baseUser()), passwordHash: null });
    expect(await authorizeUser(db, "jo@example.com", "anything")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — "Cannot find module '@/lib/credentials'".

- [ ] **Step 3: Implement**

Create `src/lib/credentials.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { verifyPassword } from "@/lib/password";

export type AuthorizedUser = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "MEMBER";
};

export async function authorizeUser(
  db: PrismaClient,
  email: string,
  password: string
): Promise<AuthorizedUser | null> {
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });
  if (!user || !user.active || !user.passwordHash) return null;
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/credentials.ts tests/credentials.test.ts
git commit -m "feat: credentials authorization with active/hash guards"
```

---

### Task 6: Auth.js Wiring + Login Page

**Files:**
- Create: `src/auth.config.ts`, `src/auth.ts`, `src/middleware.ts`, `src/types/next-auth.d.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/(auth)/login/page.tsx`, `src/app/(app)/dashboard/page.tsx`
- Modify: `.env` (AUTH_SECRET)

**Interfaces:**
- Consumes: `authorizeUser` (Task 5), `prisma` (Task 2)
- Produces: `auth()`, `signIn()`, `signOut()`, `handlers` exported from `@/auth`. `session.user` is `{ id: string; role: "ADMIN" | "MEMBER"; name; email }`. Middleware redirects unauthenticated visitors of any non-public route to `/login`. Public routes: `/login`, `/invite/*`. Every later task's protected page relies on this.

- [ ] **Step 1: Generate the auth secret**

Run: `npx auth secret`
It writes `AUTH_SECRET` to `.env.local` — move that line into `.env` and delete `.env.local` (single env file policy).

- [ ] **Step 2: Session type augmentation**

Create `src/types/next-auth.d.ts`:

```ts
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "ADMIN" | "MEMBER";
    } & DefaultSession["user"];
  }
  interface User {
    role?: "ADMIN" | "MEMBER";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: "ADMIN" | "MEMBER";
  }
}
```

- [ ] **Step 3: Edge-safe config + full config**

Create `src/auth.config.ts` (imported by middleware — must not import Prisma or argon2, which don't run on the edge):

```ts
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
```

Create `src/auth.ts`:

```ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import type { Provider } from "next-auth/providers";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { authorizeUser } from "@/lib/credentials";
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
  adapter: PrismaAdapter(prisma),
  providers,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      // Invite-only: Google may only sign in emails that already exist as active members.
      if (account?.provider === "google") {
        const existing = await prisma.user.findUnique({
          where: { email: user.email?.toLowerCase() ?? "" },
        });
        return !!existing && existing.active;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: "ADMIN" | "MEMBER" }).role ?? "MEMBER";
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = (token.role as "ADMIN" | "MEMBER") ?? "MEMBER";
      return session;
    },
  },
});
```

- [ ] **Step 4: Route handler + middleware**

Create `src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

Create `src/middleware.ts`:

```ts
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 5: Login page**

Create `src/app/(auth)/login/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn, googleEnabled } from "@/auth";

const ERRORS: Record<string, string> = {
  invalid: "Invalid email or password.",
  AccessDenied:
    "That Google account isn't a member of this workspace. Ask an admin for an invite.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; welcome?: string }>;
}) {
  if (await auth()) redirect("/dashboard");
  const params = await searchParams;
  const error = params.error ? (ERRORS[params.error] ?? "Sign-in failed.") : null;

  async function loginAction(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: "/dashboard",
      });
    } catch (e) {
      if (e instanceof AuthError) redirect("/login?error=invalid");
      throw e; // NEXT_REDIRECT must propagate
    }
  }

  async function googleAction() {
    "use server";
    await signIn("google", { redirectTo: "/dashboard" });
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        {params.welcome && (
          <p className="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
            Account created — sign in to get started.
          </p>
        )}
        {error && (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}
        <form action={loginAction} className="space-y-4">
          <label className="block text-sm">
            Email
            <input
              name="email"
              type="email"
              required
              className="mt-1 w-full rounded-md border px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            Password
            <input
              name="password"
              type="password"
              required
              className="mt-1 w-full rounded-md border px-3 py-2"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
          >
            Sign in
          </button>
        </form>
        {googleEnabled && (
          <form action={googleAction}>
            <button
              type="submit"
              className="w-full rounded-md border px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-900"
            >
              Continue with Google
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Minimal dashboard page (shell arrives in Task 7)**

Create `src/app/(app)/dashboard/page.tsx`:

```tsx
import { auth } from "@/auth";

export default async function DashboardPage() {
  const session = await auth();
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-sm text-gray-500">
        Signed in as {session?.user.name} ({session?.user.role})
      </p>
    </div>
  );
}
```

- [ ] **Step 7: Manual verification**

Run: `npm run dev`, then check each:
1. http://localhost:3000/dashboard while signed out → redirected to `/login`.
2. Sign in with the seeded admin email + password → lands on `/dashboard`, shows name and `ADMIN`.
3. Sign in with a wrong password → back on `/login` with "Invalid email or password."
4. `npm test` still passes; `npx tsc --noEmit` reports no errors.

(Optional, only if you set Google env vars: create OAuth credentials at https://console.cloud.google.com → APIs & Services → Credentials → OAuth client ID → Web application → authorized redirect URI `http://localhost:3000/api/auth/callback/google`, then verify a non-invited Google account is rejected with the AccessDenied message.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: Auth.js v5 wiring with invite-only Google and login page"
```

---

### Task 7: App Shell — Sidebar, Topbar, Theme Toggle, Placeholder Routes

**Files:**
- Create: `src/components/theme-provider.tsx`, `src/components/shell/sidebar.tsx`, `src/components/shell/topbar.tsx`, `src/components/placeholder-page.tsx`, `src/app/(app)/layout.tsx`, placeholder pages (listed in Step 4)
- Modify: `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`

**Interfaces:**
- Consumes: `auth()`, `signOut` (Task 6)
- Produces: `(app)` route-group layout that renders every protected page inside the shell; `NAV_ITEMS` in `sidebar.tsx`; dark mode via `class` strategy (next-themes). Tasks 8–11 create pages under `src/app/(app)/...` and appear inside this shell automatically.

- [ ] **Step 1: Theme support**

Append to `src/app/globals.css` (Tailwind v4 needs an explicit class-based dark variant):

```css
@custom-variant dark (&:where(.dark, .dark *));
```

Create `src/components/theme-provider.tsx`:

```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </NextThemesProvider>
  );
}
```

Replace `src/app/layout.tsx` body wrapper (keep the font setup create-next-app generated; the key changes are `suppressHydrationWarning` and the provider):

```tsx
import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Internal CMS",
  description: "Internal operations hub",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-white text-gray-900 antialiased dark:bg-gray-950 dark:text-gray-100">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Sidebar and topbar**

Create `src/components/shell/sidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/my-tasks", label: "My Tasks" },
  { href: "/clients", label: "Clients" },
  { href: "/projects", label: "Projects" },
  { href: "/calendar", label: "Calendar" },
  { href: "/team", label: "Team" },
  { href: "/vault", label: "Vault" },
  { href: "/announcements", label: "Announcements" },
  { href: "/invoices", label: "Invoices" },
  { href: "/settings", label: "Settings" },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-gray-200 dark:border-gray-800">
      <div className="px-4 py-5 text-lg font-semibold">Internal CMS</div>
      <nav className="flex-1 space-y-1 px-2">
        {NAV_ITEMS.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-md px-3 py-2 text-sm ${
                active
                  ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-900"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

Create `src/components/shell/topbar.tsx`:

```tsx
"use client";

import { useTheme } from "next-themes";

export function Topbar({
  userName,
  signOutAction,
}: {
  userName: string;
  signOutAction: () => Promise<void>;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const initials = userName
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-200 px-4 dark:border-gray-800">
      <input
        placeholder="Search (coming soon)"
        disabled
        className="w-64 rounded-md border border-gray-200 px-3 py-1.5 text-sm dark:border-gray-800"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="rounded-md border border-gray-200 px-2 py-1 text-sm dark:border-gray-800"
        >
          {resolvedTheme === "dark" ? "Light" : "Dark"}
        </button>
        <span
          title={userName}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-medium text-white"
        >
          {initials}
        </span>
        <form action={signOutAction}>
          <button type="submit" className="text-sm text-gray-500 hover:underline">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Protected layout**

Create `src/app/(app)/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar userName={session.user.name ?? ""} signOutAction={signOutAction} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Placeholder pages + root redirect**

Create `src/components/placeholder-page.tsx`:

```tsx
export function PlaceholderPage({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-gray-500">Coming in {phase}.</p>
    </div>
  );
}
```

Create each file below with the shown content:

`src/app/(app)/my-tasks/page.tsx`
```tsx
import { PlaceholderPage } from "@/components/placeholder-page";
export default function MyTasksPage() {
  return <PlaceholderPage title="My Tasks" phase="Phase 3" />;
}
```

`src/app/(app)/clients/page.tsx`
```tsx
import { PlaceholderPage } from "@/components/placeholder-page";
export default function ClientsPage() {
  return <PlaceholderPage title="Clients" phase="Phase 2" />;
}
```

`src/app/(app)/projects/page.tsx`
```tsx
import { PlaceholderPage } from "@/components/placeholder-page";
export default function ProjectsPage() {
  return <PlaceholderPage title="Projects" phase="Phase 2" />;
}
```

`src/app/(app)/calendar/page.tsx`
```tsx
import { PlaceholderPage } from "@/components/placeholder-page";
export default function CalendarPage() {
  return <PlaceholderPage title="Calendar" phase="Phase 4" />;
}
```

`src/app/(app)/team/page.tsx`
```tsx
import { PlaceholderPage } from "@/components/placeholder-page";
export default function TeamPage() {
  return <PlaceholderPage title="Team" phase="Phase 3" />;
}
```

`src/app/(app)/vault/page.tsx`
```tsx
import { PlaceholderPage } from "@/components/placeholder-page";
export default function VaultPage() {
  return <PlaceholderPage title="Vault" phase="Phase 5" />;
}
```

`src/app/(app)/announcements/page.tsx`
```tsx
import { PlaceholderPage } from "@/components/placeholder-page";
export default function AnnouncementsPage() {
  return <PlaceholderPage title="Announcements" phase="Phase 6" />;
}
```

`src/app/(app)/invoices/page.tsx`
```tsx
import { PlaceholderPage } from "@/components/placeholder-page";
export default function InvoicesPage() {
  return <PlaceholderPage title="Invoices" phase="Phase 7" />;
}
```

`src/app/(app)/settings/page.tsx`
```tsx
import Link from "next/link";
import { auth } from "@/auth";

export default async function SettingsPage() {
  const session = await auth();
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <ul className="mt-4 space-y-2 text-sm">
        <li>
          <Link href="/settings/profile" className="text-indigo-600 hover:underline">
            My profile
          </Link>
        </li>
        {session?.user.role === "ADMIN" && (
          <li>
            <Link href="/settings/members" className="text-indigo-600 hover:underline">
              Members
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}
```

Replace `src/app/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/dashboard");
}
```

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, signed in as admin:
1. `/` redirects to `/dashboard`; sidebar + topbar render around it.
2. Every sidebar item navigates; active item is highlighted; placeholders show their phase.
3. Theme toggle flips light/dark and persists across reloads.
4. Sign out returns to `/login`; visiting `/team` afterward redirects to `/login`.
5. `npx tsc --noEmit` clean; `npm test` passes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: app shell with sidebar nav, topbar, theme toggle, placeholders"
```

---

### Task 8: Invite Creation + Members Admin Page

**Files:**
- Create: `src/lib/invite-service.ts`, `src/server/guards.ts`, `src/server/actions/invites.ts`, `src/app/(app)/settings/members/page.tsx`, `src/components/members/invite-form.tsx`
- Test: `tests/invite-service.test.ts`

**Interfaces:**
- Consumes: `generateInviteToken`, `inviteExpiry` (Task 4), `ActionResult`/`ok`/`err` (Task 4), `auth()` (Task 6)
- Produces:
  - `createInviteRecord(db: PrismaClient, input: { email: string; role: "ADMIN" | "MEMBER"; createdById: string }): Promise<ActionResult<{ token: string }>>`
  - `requireUser(): Promise<{ id: string; role: "ADMIN" | "MEMBER"; name?: string | null; email?: string | null }>` and `requireAdmin()` (same shape; throws `AuthError` if not admin) in `src/server/guards.ts` — used by every later admin/user action.
  - Server action `createInviteAction(prev: ActionResult<{ inviteUrl: string }> | null, formData: FormData): Promise<ActionResult<{ inviteUrl: string }>>`
  - Members page at `/settings/members`.

- [ ] **Step 1: Write the failing tests**

Create `tests/invite-service.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createInviteRecord } from "@/lib/invite-service";

type FakeParts = {
  existingUser?: unknown;
  pendingInvite?: unknown;
};

function fakeDb(parts: FakeParts) {
  const created: unknown[] = [];
  const db = {
    user: { findUnique: async () => parts.existingUser ?? null },
    invite: {
      findFirst: async () => parts.pendingInvite ?? null,
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return args.data;
      },
    },
  } as unknown as PrismaClient;
  return { db, created };
}

describe("createInviteRecord", () => {
  const input = { email: "New@Example.com ", role: "MEMBER" as const, createdById: "admin1" };

  it("rejects when a member with that email already exists", async () => {
    const { db } = fakeDb({ existingUser: { id: "u1" } });
    const result = await createInviteRecord(db, input);
    expect(result).toEqual({ ok: false, error: "A member with this email already exists" });
  });

  it("rejects when a pending invite already exists", async () => {
    const { db } = fakeDb({ pendingInvite: { id: "i1" } });
    const result = await createInviteRecord(db, input);
    expect(result).toEqual({ ok: false, error: "A pending invite for this email already exists" });
  });

  it("creates an invite with normalized email and returns the token", async () => {
    const { db, created } = fakeDb({});
    const result = await createInviteRecord(db, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      email: "new@example.com",
      role: "MEMBER",
      createdById: "admin1",
      token: result.data.token,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — "Cannot find module '@/lib/invite-service'".

- [ ] **Step 3: Implement the service**

Create `src/lib/invite-service.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { generateInviteToken, inviteExpiry } from "@/lib/invites";
import { ActionResult, ok, err } from "@/lib/action-result";

export async function createInviteRecord(
  db: PrismaClient,
  input: { email: string; role: "ADMIN" | "MEMBER"; createdById: string }
): Promise<ActionResult<{ token: string }>> {
  const email = input.email.toLowerCase().trim();
  const existingUser = await db.user.findUnique({ where: { email } });
  if (existingUser) return err("A member with this email already exists");

  const pending = await db.invite.findFirst({
    where: { email, acceptedAt: null, expiresAt: { gt: new Date() } },
  });
  if (pending) return err("A pending invite for this email already exists");

  const token = generateInviteToken();
  await db.invite.create({
    data: {
      email,
      role: input.role,
      token,
      expiresAt: inviteExpiry(),
      createdById: input.createdById,
    },
  });
  return ok({ token });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Guards and the server action**

Create `src/server/guards.ts`:

```ts
import { auth } from "@/auth";

export class AuthError extends Error {}

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new AuthError("Not signed in");
  return session.user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new AuthError("Admin access required");
  return user;
}
```

Create `src/server/actions/invites.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createInviteRecord } from "@/lib/invite-service";
import { ActionResult, ok, err } from "@/lib/action-result";
import { requireAdmin, AuthError } from "@/server/guards";

export async function createInviteAction(
  _prev: ActionResult<{ inviteUrl: string }> | null,
  formData: FormData
): Promise<ActionResult<{ inviteUrl: string }>> {
  try {
    const admin = await requireAdmin();
    const email = String(formData.get("email") ?? "").trim();
    const role = formData.get("role") === "ADMIN" ? "ADMIN" : "MEMBER";
    if (!email) return err("Email is required");

    const result = await createInviteRecord(prisma, {
      email,
      role,
      createdById: admin.id,
    });
    if (!result.ok) return result as ActionResult<{ inviteUrl: string }>;

    const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    revalidatePath("/settings/members");
    return ok({ inviteUrl: `${base}/invite/${result.data.token}` });
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}
```

- [ ] **Step 6: Invite form component**

Create `src/components/members/invite-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { createInviteAction } from "@/server/actions/invites";

export function InviteForm() {
  const [state, formAction, pending] = useActionState(createInviteAction, null);

  return (
    <div className="max-w-md space-y-3">
      <form action={formAction} className="flex gap-2">
        <input
          name="email"
          type="email"
          required
          placeholder="teammate@company.com"
          className="flex-1 rounded-md border px-3 py-2 text-sm"
        />
        <select name="role" className="rounded-md border px-2 py-2 text-sm">
          <option value="MEMBER">Member</option>
          <option value="ADMIN">Admin</option>
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {pending ? "Inviting…" : "Invite"}
        </button>
      </form>
      {state && !state.ok && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && (
        <div className="rounded-md border p-3 text-sm">
          <p className="mb-2">Invite created — share this link (valid 7 days):</p>
          <code className="block break-all text-xs">{state.data.inviteUrl}</code>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(state.data.inviteUrl)}
            className="mt-2 rounded-md border px-2 py-1 text-xs"
          >
            Copy link
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Members page**

Create `src/app/(app)/settings/members/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { InviteForm } from "@/components/members/invite-form";

export default async function MembersPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/settings");

  const [members, pendingInvites] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.invite.findMany({
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="space-y-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Members</h1>
        <p className="mt-1 text-sm text-gray-500">Invite and manage your team.</p>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-medium">Invite someone</h2>
        <InviteForm />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Team ({members.length})</h2>
        <table className="w-full max-w-3xl text-left text-sm">
          <thead className="border-b text-gray-500">
            <tr>
              <th className="py-2">Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-gray-100 dark:border-gray-900">
                <td className="py-2">{m.name}</td>
                <td>{m.email}</td>
                <td>{m.role}</td>
                <td>{m.active ? "Active" : "Deactivated"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {pendingInvites.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-medium">
            Pending invites ({pendingInvites.length})
          </h2>
          <ul className="max-w-3xl space-y-1 text-sm text-gray-600 dark:text-gray-400">
            {pendingInvites.map((i) => (
              <li key={i.id}>
                {i.email} — {i.role} — expires {i.expiresAt.toLocaleDateString()}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Manual verification**

Run: `npm run dev` as admin:
1. `/settings/members` shows the seeded admin in the team table.
2. Invite a test email → invite link appears, Copy works, pending list shows it.
3. Inviting the same email again → "A pending invite for this email already exists".
4. Inviting the admin's own email → "A member with this email already exists".
5. `npm test` and `npx tsc --noEmit` pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: invite creation and members admin page"
```

---

### Task 9: Invite Acceptance Flow (TDD)

**Files:**
- Create: `src/app/(auth)/invite/[token]/page.tsx`, `src/server/actions/accept-invite.ts`
- Modify: `src/lib/invite-service.ts` (add `redeemInvite`)
- Test: `tests/redeem-invite.test.ts`

**Interfaces:**
- Consumes: `inviteStatus` (Task 4), `hashPassword` (Task 3), `ActionResult` (Task 4)
- Produces: `redeemInvite(db: PrismaClient, input: { token: string; name: string; password: string }): Promise<ActionResult>` — creates the User (role from invite) and marks the invite accepted, atomically. Server action `acceptInviteAction(token: string, formData: FormData)` redirects to `/login?welcome=1` on success.

- [ ] **Step 1: Write the failing tests**

Create `tests/redeem-invite.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { redeemInvite } from "@/lib/invite-service";

type FakeParts = {
  invite?: unknown;
  existingUser?: unknown;
};

function fakeDb(parts: FakeParts) {
  const userCreates: Record<string, unknown>[] = [];
  const inviteUpdates: Record<string, unknown>[] = [];
  const db = {
    invite: {
      findUnique: async () => parts.invite ?? null,
      update: async (args: { data: Record<string, unknown> }) => {
        inviteUpdates.push(args.data);
        return args.data;
      },
    },
    user: {
      findUnique: async () => parts.existingUser ?? null,
      create: async (args: { data: Record<string, unknown> }) => {
        userCreates.push(args.data);
        return args.data;
      },
    },
    $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
  } as unknown as PrismaClient;
  return { db, userCreates, inviteUpdates };
}

const validInvite = {
  id: "i1",
  email: "new@example.com",
  role: "MEMBER",
  expiresAt: new Date(Date.now() + 60_000),
  acceptedAt: null,
};

const goodInput = { token: "tok", name: "  New Person ", password: "longenough" };

describe("redeemInvite", () => {
  it("rejects an unknown token", async () => {
    const { db } = fakeDb({});
    expect(await redeemInvite(db, goodInput)).toEqual({ ok: false, error: "Invalid invite link" });
  });

  it("rejects a used invite", async () => {
    const { db } = fakeDb({ invite: { ...validInvite, acceptedAt: new Date() } });
    expect(await redeemInvite(db, goodInput)).toEqual({
      ok: false,
      error: "This invite has already been used",
    });
  });

  it("rejects an expired invite", async () => {
    const { db } = fakeDb({
      invite: { ...validInvite, expiresAt: new Date(Date.now() - 60_000) },
    });
    expect(await redeemInvite(db, goodInput)).toEqual({
      ok: false,
      error: "This invite has expired",
    });
  });

  it("rejects a short password", async () => {
    const { db } = fakeDb({ invite: validInvite });
    expect(await redeemInvite(db, { ...goodInput, password: "short" })).toEqual({
      ok: false,
      error: "Password must be at least 8 characters",
    });
  });

  it("rejects a blank name", async () => {
    const { db } = fakeDb({ invite: validInvite });
    expect(await redeemInvite(db, { ...goodInput, name: "   " })).toEqual({
      ok: false,
      error: "Name is required",
    });
  });

  it("rejects when the email already became a user", async () => {
    const { db } = fakeDb({ invite: validInvite, existingUser: { id: "u9" } });
    expect(await redeemInvite(db, goodInput)).toEqual({
      ok: false,
      error: "A member with this email already exists",
    });
  });

  it("creates the user with the invite's role and marks the invite used", async () => {
    const { db, userCreates, inviteUpdates } = fakeDb({ invite: validInvite });
    const result = await redeemInvite(db, goodInput);
    expect(result).toEqual({ ok: true, data: undefined });
    expect(userCreates).toHaveLength(1);
    expect(userCreates[0]).toMatchObject({
      email: "new@example.com",
      name: "New Person",
      role: "MEMBER",
    });
    expect(String(userCreates[0].passwordHash)).toMatch(/^\$argon2/);
    expect(inviteUpdates[0]).toHaveProperty("acceptedAt");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — "redeemInvite is not exported".

- [ ] **Step 3: Implement**

Append to `src/lib/invite-service.ts`:

```ts
import { inviteStatus } from "@/lib/invites";
import { hashPassword } from "@/lib/password";

export async function redeemInvite(
  db: PrismaClient,
  input: { token: string; name: string; password: string }
): Promise<ActionResult> {
  const invite = await db.invite.findUnique({ where: { token: input.token } });
  if (!invite) return err("Invalid invite link");

  const status = inviteStatus(invite);
  if (status === "used") return err("This invite has already been used");
  if (status === "expired") return err("This invite has expired");

  const name = input.name.trim();
  if (!name) return err("Name is required");
  if (input.password.length < 8) return err("Password must be at least 8 characters");

  const existing = await db.user.findUnique({ where: { email: invite.email } });
  if (existing) return err("A member with this email already exists");

  const passwordHash = await hashPassword(input.password);
  await db.$transaction([
    db.user.create({
      data: { email: invite.email, name, passwordHash, role: invite.role },
    }),
    db.invite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    }),
  ]);
  return ok(undefined);
}
```

(Move the two new imports to the top of the file with the existing ones.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Server action and acceptance page**

Create `src/server/actions/accept-invite.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { redeemInvite } from "@/lib/invite-service";

export async function acceptInviteAction(token: string, formData: FormData) {
  const result = await redeemInvite(prisma, {
    token,
    name: String(formData.get("name") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!result.ok) {
    redirect(`/invite/${token}?error=${encodeURIComponent(result.error)}`);
  }
  redirect("/login?welcome=1");
}
```

Create `src/app/(auth)/invite/[token]/page.tsx`:

```tsx
import { prisma } from "@/lib/prisma";
import { inviteStatus } from "@/lib/invites";
import { acceptInviteAction } from "@/server/actions/accept-invite";

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  const invite = await prisma.invite.findUnique({ where: { token } });
  const status = invite ? inviteStatus(invite) : null;

  if (!invite || status !== "valid") {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-semibold">Invite not valid</h1>
          <p className="mt-2 text-sm text-gray-500">
            {status === "used"
              ? "This invite has already been used."
              : status === "expired"
                ? "This invite has expired. Ask an admin to send a new one."
                : "This invite link is not valid."}
          </p>
        </div>
      </main>
    );
  }

  const action = acceptInviteAction.bind(null, token);

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Join the workspace</h1>
          <p className="mt-1 text-sm text-gray-500">
            Creating an account for <strong>{invite.email}</strong>
          </p>
        </div>
        {error && (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}
        <form action={action} className="space-y-4">
          <label className="block text-sm">
            Your name
            <input
              name="name"
              required
              className="mt-1 w-full rounded-md border px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            Password (min 8 characters)
            <input
              name="password"
              type="password"
              required
              minLength={8}
              className="mt-1 w-full rounded-md border px-3 py-2"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
          >
            Create account
          </button>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Manual verification — the full invite loop**

1. As admin: create an invite at `/settings/members`, copy the link.
2. Open the link in a private/incognito window → acceptance form shows the invited email.
3. Submit with a 3-character password → HTML validation blocks; bypassing it server-side also returns the error via redirect.
4. Accept properly → redirected to `/login?welcome=1` with the green banner → sign in as the new member.
5. As the new MEMBER: `/settings` hides the Members link; visiting `/settings/members` directly redirects to `/settings`.
6. Re-open the invite link → "already been used".
7. `npm test` and `npx tsc --noEmit` pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: invite acceptance flow with atomic user creation"
```

---

### Task 10: Member Management — Deactivate/Reactivate, Role Change (TDD)

**Files:**
- Create: `src/lib/member-service.ts`, `src/server/actions/members.ts`, `src/components/members/member-row-actions.tsx`
- Modify: `src/app/(app)/settings/members/page.tsx` (add actions column)
- Test: `tests/member-service.test.ts`

**Interfaces:**
- Consumes: `ActionResult`/`ok`/`err` (Task 4), `requireAdmin` (Task 8), `prisma` (Task 2)
- Produces:
  - `setMemberActive(db: PrismaClient, input: { targetId: string; active: boolean; actorId: string }): Promise<ActionResult>`
  - `setMemberRole(db: PrismaClient, input: { targetId: string; role: "ADMIN" | "MEMBER" }): Promise<ActionResult>`
  - Server actions `toggleMemberActiveAction(formData)`, `setMemberRoleAction(formData)` reading hidden fields `userId`, `active`/`role`.

- [ ] **Step 1: Write the failing tests**

Create `tests/member-service.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { setMemberActive, setMemberRole } from "@/lib/member-service";

type FakeParts = {
  target?: unknown;
  activeAdminCount?: number;
};

function fakeDb(parts: FakeParts) {
  const updates: Record<string, unknown>[] = [];
  const db = {
    user: {
      findUnique: async () => parts.target ?? null,
      count: async () => parts.activeAdminCount ?? 1,
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return args.data;
      },
    },
  } as unknown as PrismaClient;
  return { db, updates };
}

const member = { id: "m1", role: "MEMBER", active: true };
const admin = { id: "a1", role: "ADMIN", active: true };

describe("setMemberActive", () => {
  it("blocks deactivating yourself", async () => {
    const { db } = fakeDb({ target: admin });
    const result = await setMemberActive(db, { targetId: "a1", active: false, actorId: "a1" });
    expect(result).toEqual({ ok: false, error: "You cannot deactivate your own account" });
  });

  it("blocks deactivating the last active admin", async () => {
    const { db } = fakeDb({ target: admin, activeAdminCount: 1 });
    const result = await setMemberActive(db, { targetId: "a1", active: false, actorId: "x" });
    expect(result).toEqual({ ok: false, error: "Cannot deactivate the last active admin" });
  });

  it("deactivates a regular member", async () => {
    const { db, updates } = fakeDb({ target: member });
    const result = await setMemberActive(db, { targetId: "m1", active: false, actorId: "a1" });
    expect(result.ok).toBe(true);
    expect(updates[0]).toEqual({ active: false });
  });

  it("reactivates a deactivated member", async () => {
    const { db, updates } = fakeDb({ target: { ...member, active: false } });
    const result = await setMemberActive(db, { targetId: "m1", active: true, actorId: "a1" });
    expect(result.ok).toBe(true);
    expect(updates[0]).toEqual({ active: true });
  });

  it("errors on unknown member", async () => {
    const { db } = fakeDb({});
    const result = await setMemberActive(db, { targetId: "ghost", active: false, actorId: "a1" });
    expect(result).toEqual({ ok: false, error: "Member not found" });
  });
});

describe("setMemberRole", () => {
  it("blocks demoting the last active admin", async () => {
    const { db } = fakeDb({ target: admin, activeAdminCount: 1 });
    const result = await setMemberRole(db, { targetId: "a1", role: "MEMBER" });
    expect(result).toEqual({ ok: false, error: "Cannot demote the last active admin" });
  });

  it("promotes a member to admin", async () => {
    const { db, updates } = fakeDb({ target: member });
    const result = await setMemberRole(db, { targetId: "m1", role: "ADMIN" });
    expect(result.ok).toBe(true);
    expect(updates[0]).toEqual({ role: "ADMIN" });
  });

  it("demotes an admin when another active admin exists", async () => {
    const { db, updates } = fakeDb({ target: admin, activeAdminCount: 2 });
    const result = await setMemberRole(db, { targetId: "a1", role: "MEMBER" });
    expect(result.ok).toBe(true);
    expect(updates[0]).toEqual({ role: "MEMBER" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — "Cannot find module '@/lib/member-service'".

- [ ] **Step 3: Implement**

Create `src/lib/member-service.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { ActionResult, ok, err } from "@/lib/action-result";

async function countActiveAdmins(db: PrismaClient): Promise<number> {
  return db.user.count({ where: { role: "ADMIN", active: true } });
}

export async function setMemberActive(
  db: PrismaClient,
  input: { targetId: string; active: boolean; actorId: string }
): Promise<ActionResult> {
  if (!input.active && input.targetId === input.actorId) {
    return err("You cannot deactivate your own account");
  }
  const target = await db.user.findUnique({ where: { id: input.targetId } });
  if (!target) return err("Member not found");
  if (!input.active && target.role === "ADMIN" && target.active) {
    if ((await countActiveAdmins(db)) <= 1) {
      return err("Cannot deactivate the last active admin");
    }
  }
  await db.user.update({
    where: { id: input.targetId },
    data: { active: input.active },
  });
  return ok(undefined);
}

export async function setMemberRole(
  db: PrismaClient,
  input: { targetId: string; role: "ADMIN" | "MEMBER" }
): Promise<ActionResult> {
  const target = await db.user.findUnique({ where: { id: input.targetId } });
  if (!target) return err("Member not found");
  if (target.role === "ADMIN" && input.role === "MEMBER" && target.active) {
    if ((await countActiveAdmins(db)) <= 1) {
      return err("Cannot demote the last active admin");
    }
  }
  await db.user.update({
    where: { id: input.targetId },
    data: { role: input.role },
  });
  return ok(undefined);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Server actions and row actions UI**

Create `src/server/actions/members.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { setMemberActive, setMemberRole } from "@/lib/member-service";
import { ActionResult, err } from "@/lib/action-result";
import { requireAdmin, AuthError } from "@/server/guards";

export async function toggleMemberActiveAction(
  formData: FormData
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const result = await setMemberActive(prisma, {
      targetId: String(formData.get("userId") ?? ""),
      active: formData.get("active") === "true",
      actorId: admin.id,
    });
    revalidatePath("/settings/members");
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}

export async function setMemberRoleAction(
  formData: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const result = await setMemberRole(prisma, {
      targetId: String(formData.get("userId") ?? ""),
      role: formData.get("role") === "ADMIN" ? "ADMIN" : "MEMBER",
    });
    revalidatePath("/settings/members");
    return result;
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}
```

Create `src/components/members/member-row-actions.tsx`:

```tsx
"use client";

import { useState } from "react";
import {
  toggleMemberActiveAction,
  setMemberRoleAction,
} from "@/server/actions/members";

export function MemberRowActions({
  userId,
  role,
  active,
  isSelf,
}: {
  userId: string;
  role: "ADMIN" | "MEMBER";
  active: boolean;
  isSelf: boolean;
}) {
  const [error, setError] = useState<string | null>(null);

  async function run(action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, fd: FormData) {
    setError(null);
    const result = await action(fd);
    if (!result.ok && result.error) setError(result.error);
  }

  const btn = "rounded-md border px-2 py-1 text-xs hover:bg-gray-50 dark:hover:bg-gray-900";

  return (
    <div className="flex items-center gap-2">
      <form
        action={(fd) => run(setMemberRoleAction, fd)}
      >
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="role" value={role === "ADMIN" ? "MEMBER" : "ADMIN"} />
        <button type="submit" className={btn}>
          {role === "ADMIN" ? "Make Member" : "Make Admin"}
        </button>
      </form>
      {!isSelf && (
        <form action={(fd) => run(toggleMemberActiveAction, fd)}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="active" value={active ? "false" : "true"} />
          <button type="submit" className={btn}>
            {active ? "Deactivate" : "Reactivate"}
          </button>
        </form>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 6: Wire into the members table**

In `src/app/(app)/settings/members/page.tsx`: import the component, add an `Actions` header cell, and add to each member row:

```tsx
<td>
  <MemberRowActions
    userId={m.id}
    role={m.role}
    active={m.active}
    isSelf={m.id === session.user.id}
  />
</td>
```

(`session` is non-null past the admin redirect; TypeScript may need `session!.user.id` or an early-return pattern — use whichever keeps `tsc` clean.)

- [ ] **Step 7: Manual verification**

1. As admin at `/settings/members`: promote the test member → role flips to ADMIN; demote back → MEMBER.
2. Try demoting yourself while sole admin → inline error "Cannot demote the last active admin".
3. Deactivate the test member → status shows Deactivated; that member's credentials login now fails with "Invalid email or password."; reactivate → login works again.
4. No Deactivate button on your own row.
5. `npm test` and `npx tsc --noEmit` pass.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: member deactivation and role management with last-admin guard"
```

---

### Task 11: Member Profile Page (TDD)

**Files:**
- Create: `src/lib/profile.ts`, `src/server/actions/profile.ts`, `src/app/(app)/settings/profile/page.tsx`, `src/components/profile-form.tsx`
- Test: `tests/profile.test.ts`

**Interfaces:**
- Consumes: `zod`, `requireUser` (Task 8), `ActionResult` (Task 4)
- Produces: `profileSchema` (zod) with parsed shape `{ name: string; title?: string; phone?: string; avatarUrl?: string }`; server action `updateProfileAction(prev: ActionResult | null, formData: FormData): Promise<ActionResult>`. Phase 3's Team page will read these profile fields.

- [ ] **Step 1: Write the failing tests**

Create `tests/profile.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { profileSchema } from "@/lib/profile";

describe("profileSchema", () => {
  it("accepts a full valid profile", () => {
    const result = profileSchema.safeParse({
      name: "  Jo Smith ",
      title: "Designer",
      phone: "+91 98765 43210",
      avatarUrl: "https://example.com/a.png",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("Jo Smith");
  });

  it("accepts empty optional fields", () => {
    const result = profileSchema.safeParse({
      name: "Jo",
      title: "",
      phone: "",
      avatarUrl: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a blank name", () => {
    expect(profileSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("rejects a non-URL avatar", () => {
    expect(
      profileSchema.safeParse({ name: "Jo", avatarUrl: "not-a-url" }).success
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — "Cannot find module '@/lib/profile'".

- [ ] **Step 3: Implement the schema**

Create `src/lib/profile.ts`:

```ts
import { z } from "zod";

export const profileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  title: z.string().trim().max(100).optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  avatarUrl: z
    .string()
    .trim()
    .url("Avatar must be a valid URL")
    .optional()
    .or(z.literal("")),
});

export type ProfileInput = z.infer<typeof profileSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Server action and profile page**

Create `src/server/actions/profile.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { profileSchema } from "@/lib/profile";
import { ActionResult, ok, err } from "@/lib/action-result";
import { requireUser, AuthError } from "@/server/guards";

export async function updateProfileAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = profileSchema.safeParse({
      name: formData.get("name"),
      title: formData.get("title"),
      phone: formData.get("phone"),
      avatarUrl: formData.get("avatarUrl"),
    });
    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const { name, title, phone, avatarUrl } = parsed.data;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        name,
        title: title || null,
        phone: phone || null,
        avatarUrl: avatarUrl || null,
      },
    });
    revalidatePath("/settings/profile");
    return ok(undefined);
  } catch (e) {
    if (e instanceof AuthError) return err(e.message);
    throw e;
  }
}
```

Create `src/components/profile-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { updateProfileAction } from "@/server/actions/profile";

export function ProfileForm({
  defaults,
}: {
  defaults: { name: string; title: string; phone: string; avatarUrl: string };
}) {
  const [state, formAction, pending] = useActionState(updateProfileAction, null);

  const field = "mt-1 w-full rounded-md border px-3 py-2 text-sm";

  return (
    <form action={formAction} className="max-w-md space-y-4">
      {state && !state.ok && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-600">Profile saved.</p>}
      <label className="block text-sm">
        Name
        <input name="name" required defaultValue={defaults.name} className={field} />
      </label>
      <label className="block text-sm">
        Job title
        <input name="title" defaultValue={defaults.title} className={field} />
      </label>
      <label className="block text-sm">
        Phone
        <input name="phone" defaultValue={defaults.phone} className={field} />
      </label>
      <label className="block text-sm">
        Avatar URL
        <input name="avatarUrl" defaultValue={defaults.avatarUrl} className={field} />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
```

Create `src/app/(app)/settings/profile/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ProfileForm } from "@/components/profile-form";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) redirect("/login");

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">My profile</h1>
      <p className="mt-1 text-sm text-gray-500">{user.email}</p>
      <div className="mt-6">
        <ProfileForm
          defaults={{
            name: user.name,
            title: user.title ?? "",
            phone: user.phone ?? "",
            avatarUrl: user.avatarUrl ?? "",
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Manual verification**

1. `/settings/profile` shows your email and prefilled name.
2. Save with a job title → "Profile saved."; reload → value persists.
3. Clear the name and save → server error "Name is required" (bypass HTML `required` via devtools if needed).
4. Enter `not-a-url` as avatar → "Avatar must be a valid URL".
5. `npm test` and `npx tsc --noEmit` pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: member profile page with validated updates"
```

---

## Amendment (2026-07-29): Design hand-off arrived before execution

The Claude Design output now lives at `docs/design/meridian-ops/` (`desktop.html`, `mobile.html`). It defines the complete token system: CSS variables for light (`:root`) and dark (`[data-theme="dark"]`) themes near the top of `desktop.html` — surfaces, borders, 3-step text ramp, one indigo accent (`--accent`, `--btn`), status colors (`--ok`/`--warn`/`--bad` with `-bg`/`-line` variants), shadows, and fonts (Public Sans for UI, IBM Plex Mono for numbers).

**Impact on tasks (applies to Tasks 6, 7, 8, 9, 11 — any task rendering UI):**

- The product name in the sidebar and `<title>` is **"Meridian Ops"** (not "Internal CMS").
- In Task 7 Step 1, additionally: copy the `:root` and `[data-theme="dark"]` CSS-variable blocks from `docs/design/meridian-ops/desktop.html` into `globals.css`, and load Public Sans via `next/font/google` in the root layout.
- next-themes must use `attribute="data-theme"` (matching the design's `[data-theme="dark"]` selector) instead of `attribute="class"`, and the Tailwind dark variant in `globals.css` becomes `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));`.
- Where task code hardcodes colors (e.g. `bg-indigo-600`, `border-gray-200`), prefer the design tokens via arbitrary values: `bg-[var(--btn)]`, `text-[var(--text-2)]`, `border-[var(--border)]`, `bg-[var(--bg)]`, etc. Exact visual parity with the mockup is NOT required in Phase 1 — token wiring is, so later phases inherit the right palette automatically.

## Phase 1 Done Criteria

- [ ] Fresh clone + `.env` from `.env.example` + `npx prisma migrate dev` + `npx prisma db seed` + `npm run dev` gives a working app.
- [ ] Admin can invite; invitee can join via link; Google sign-in works only for invited members (when configured).
- [ ] Deactivated members cannot sign in by any method; last-admin rules hold.
- [ ] All Vitest suites pass (`npm test`); `npx tsc --noEmit` is clean.
- [ ] Every protected page renders inside the sidebar shell with working light/dark toggle.
