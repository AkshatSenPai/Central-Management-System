# Deploying Meridian Ops

Written 2026-08-02, for the first deploy. Everything here was checked against the repo, not recalled.

## What you need before you start

| Thing | Why | Where |
|---|---|---|
| A domain | Auth callbacks and invite links need a stable URL | Wherever you buy it |
| Vercel account, **Pro** | The free tier is licensed non-commercial and this is a company tool | $20/month, one seat |
| The Neon connection string | Already in your local `.env` as `DATABASE_URL` | Neon dashboard |
| `AUTH_SECRET` | Signs session cookies. **Do not reuse the local one** | `openssl rand -base64 32` |

Google sign-in is optional — the app works with email + password alone. Skip `AUTH_GOOGLE_*` if you would rather not set it up today.

## Region

Your Neon database is in **`ap-southeast-1` (Singapore)** — Neon has no Mumbai region, so that is the closest there is.

Set Vercel's function region to **Singapore (`sin1`)** so the app sits beside the database. Left on the default (Washington DC), every page load makes a round trip halfway around the world and back, several times. This is the single largest thing you can do for perceived speed, and it costs nothing.

Vercel → Project → Settings → Functions → Region → `sin1`.

## Environment variables

Set these in Vercel → Settings → Environment Variables, for **Production**:

```
DATABASE_URL          your Neon pooled connection string
AUTH_SECRET           a NEW secret, not the local one
AUTH_URL              https://your-domain.com
NEXT_PUBLIC_APP_URL   https://your-domain.com
```

`NEXT_PUBLIC_APP_URL` is not optional in production — `createInviteAction` refuses to generate invite links without it and says so, rather than emitting a broken link.

If you are enabling Google sign-in, add `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`, and add `https://your-domain.com/api/auth/callback/google` to the authorised redirect URIs in the Google Cloud console. Google sign-in is invite-only by design: it only admits an email that already belongs to an active member (`src/lib/google-gate.ts`).

## The build

`package.json` was changed for this deploy:

```
"postinstall": "prisma generate"
"build":       "prisma migrate deploy && next build"
"build:local": "next build"
```

Both were genuine blockers. Vercel installs into a clean `node_modules`, so without `postinstall` the generated Prisma client does not exist and the build fails with *"@prisma/client did not initialize yet"*. And without `migrate deploy` the new code would run against a database missing the tables it expects.

`migrate deploy` is the production-safe command: it applies pending migrations and will never generate, reset, or prompt.

Use `npm run build:local` when you want to build without touching the database.

## First run

1. Deploy.
2. Visit `https://your-domain.com` — you will be redirected to `/login`.
3. Sign in with your existing account. The database already has your user, your clients, your projects and your eight tasks; deploying does not reset anything.
4. Invite the team from **Settings → Members**. Invite links are copy-and-paste for now — email is not wired yet, so you will send them yourself via WhatsApp or wherever.

## What will not work on day one

Not broken — not built. Listed so nobody reports them as bugs:

- **No email.** Invites are copied by hand. Notifications appear in the bell only. Needs a Resend key and a verified domain.
- **No reminders and no recurring tasks.** Both need a cron, which needs this deployment to exist first.
- **No file attachments.** Needs Cloudflare R2. The table is already migrated, so it is code-only when you want it.
- **No global search.** The box was removed rather than left disabled.
- **Vault, Announcements, Invoices** are placeholder pages, and say so.

## After it is up

The cron for reminders and recurring tasks needs a live URL, so it is the natural first thing to build once this is deployed.
