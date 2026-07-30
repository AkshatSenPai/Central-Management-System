# npm audit triage — 2026-07-30

Follow-up item 1 from [phase-1-followups](../superpowers/plans/phase-1-followups.md):
confirm none of the 12 high-severity findings sit in the production runtime chain
before first deploy.

Toolchain: `next@16.2.12`, npm lockfile v3. Commands run: `npm audit`,
`npm audit --omit=dev`, `npm audit fix --dry-run`.

## Verdict

**No finding is reachable in the production runtime chain. No action taken;
no non-breaking fix exists** (`npm audit fix` offers nothing; `--force` would
downgrade to `next@9.3.3`, which is not a real fix).

## Cluster 1 — eslint toolchain (9 findings, dev-only)

`brace-expansion` DoS ([GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg))
reached via `minimatch` → `@eslint/config-array`, `@eslint/eslintrc`, `eslint`,
`eslint-plugin-import`, `eslint-plugin-jsx-a11y`, `eslint-plugin-react`,
`eslint-config-next`.

- All are `devDependencies`; `npm audit --omit=dev` drops every one of them.
- Exploitation requires linting attacker-controlled glob patterns — not a
  scenario in this repo's lint setup (first-party config, first-party sources).

## Cluster 2 — postcss + sharp inside next (3 findings)

These survive `--omit=dev` because `next` is a production dependency, but
neither sits on a request-serving path with attacker-controlled input:

- **postcss ≤ 8.5.17** (Next's vendored copy at `node_modules/next/node_modules/postcss`;
  XSS in stringify output, sourceMappingURL file disclosure). postcss runs at
  **build time** over first-party CSS (Tailwind). No user-supplied CSS is ever
  processed, at build or runtime.
- **sharp < 0.35.0** (inherited libvips CVEs). sharp only executes inside the
  `/_next/image` optimizer. This app never uses `next/image` (verified: zero
  `next/image` imports in `src/`), `images.remotePatterns` is unset so the
  optimizer rejects remote URLs, and there is no user image upload — member
  `avatarUrl` is a stored http(s) URL rendered by the browser, never proxied
  through the optimizer. sharp never sees attacker-controlled bytes.
- **next 9.3.4-canary.0 – 16.3.0-preview.7** is flagged only for depending on
  the two above; every current stable Next release is in this range, so there
  is no upgrade target that clears it today.

## Re-triage triggers

- A Next release outside the flagged range ships (bumps its postcss/sharp) —
  upgrade and re-run `npm audit`.
- Avatars (or any user-supplied image) start rendering through `next/image` /
  `images.remotePatterns` — the sharp/libvips CVEs become runtime-relevant and
  this acceptance no longer holds.
- Any new `dependencies` entry appears in a future audit's `--omit=dev` output.
