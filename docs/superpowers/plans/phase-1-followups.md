# Phase 1 — Post-merge Follow-ups

Carried out of the Phase 1 final whole-branch review (branch `phase-1-foundation`, final commit `611c1b6`). None block the merge; batch these as a polish pass early in Phase 2.

## Fix soon (small, worthwhile)

1. **npm audit triage** — 12 high-severity findings inherited from the create-next-app dependency tree. Run `npm audit`, confirm none sit in the production runtime chain before first deploy.
2. **`DATABASE_URL` fast-fail** — `src/lib/prisma.ts` silently falls back to pg defaults when the env var is unset; throw a clear "DATABASE_URL missing" error instead (fresh-clone DX).
3. **Serializable isolation on last-admin backstops** — `src/lib/member-service.ts` has two interactive transactions guarding the last-active-admin invariant; under default READ COMMITTED a mutual-demotion race remains theoretically possible. Add `isolationLevel: "Serializable"` to both.
4. **Invite-page error allowlist** — `src/app/(auth)/invite/[token]/page.tsx` renders arbitrary `?error=` text in its styled banner (inert, React-escaped, but a phishing-text surface on a public page). Allowlist the known service error strings.
5. **Clipboard feedback** — `src/components/members/invite-form.tsx` "Copy link" is fire-and-forget; add `.catch` + a "Copied" confirmation.
6. **Dashboard tokenization** — `src/app/(app)/dashboard/page.tsx` still uses `text-gray-500`; swap to `text-[var(--text-2)]` (the dashboard gets rebuilt properly in later phases anyway).
7. **Login error mapping** — all `AuthError`s render as "Invalid email or password" (`src/app/(auth)/login/page.tsx`); distinguish configuration errors to save future debugging time.
8. **`NEXT_PUBLIC_APP_URL` in production** — invite links fall back to `http://localhost:3000` if unset; set it in the deploy environment.
9. **Server-side email validation on invites** — `createInviteAction` trusts the client's `type="email"`; add a zod email check server-side.
10. **Google linking case-mismatch** — the PrismaAdapter's `getUserByEmail` (used by `allowDangerousEmailAccountLinking`) sees the raw profile email while our gate normalizes; cover with a test / normalize before the adapter when enabling Google.
11. **Delete unused `public/` SVGs** from the create-next-app scaffold.

## Accepted (no action planned)

- AGENTS.md/CLAUDE.md scaffold files (useful Next 16 docs pointer).
- Theme-toggle one-frame FOUC + related Topbar hydration warning (standard next-themes behavior; polish only).
- Uncontrolled profile inputs show un-trimmed value until reload (cosmetic, DB value correct).
- CFA-fragile session narrowing in members page (tsc-gated; refactor opportunistically).
- No pending-invite uniqueness constraint (race resolved at redemption via P2002; harmless at this scale).
- Shell behavior tests deferred to the planned Playwright smoke suite.

## Deploy notes

- Use `prisma migrate deploy` (not `migrate dev`) in the deploy pipeline.
- Required production env: `DATABASE_URL`, `AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`, optional `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` (Google redirect URI must be updated to the production domain).
