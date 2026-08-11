/** The only file that reads the 74 vendored template files, and the one that
 * composes a finished contract out of `contract.ts` and `contract-render.ts`.
 *
 * Same split as `attachment.ts` / `r2.ts`: the pure, heavily-tested layer and
 * the layer that touches the world never share a file.
 *
 * ## Why the templates are in the repo and not the database
 *
 * `TODO.md` §O asked the question — "are the templates data or code?" — and
 * the answer the package itself gives is code. Spec §06 is a section titled
 * DO NOT CHANGE: clause text, prices, clause numbering, payment mode and
 * jurisdiction are all listed as things that must not be edited per-contract,
 * and it closes with "Do not edit the templates ... Request a new package
 * rather than patching files."
 *
 * A database table is an edit box. Putting 72 documents whose defining
 * property is that nobody may edit them behind an admin form would be
 * building the exact affordance the spec spends a page forbidding — with no
 * review, no diff and no way back. In the repo they are versioned, a change
 * shows up in a pull request, and replacing the set is one commit.
 *
 * The cost is honest and worth stating: a new pricing package needs a deploy.
 * That is the same cost as any other correctness-critical constant in this
 * app, and pricing changes are not a weekly event.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  resolveSnippetPath,
  resolveTemplatePath,
  tokensFor,
  type ContractDeal,
} from "@/lib/contract";
import {
  buildTokens,
  substitute,
  validateRendered,
  type ContractFacts,
  type RenderProblem,
} from "@/lib/contract-render";

/** Resolved from `process.cwd()`, which Next sets to the project root in both
 * `next dev` and a serverless invocation. The directory is pulled into the
 * deployment by `outputFileTracingIncludes` in `next.config.ts` — file
 * tracing follows `import` statements and cannot see a path built at runtime,
 * so without that entry these files exist locally and 404 in production.
 * If a contract renders in dev and throws ENOENT on Vercel, that config line
 * is the first thing to check. */
const TEMPLATE_ROOT = path.join(process.cwd(), "src", "contract-templates");

/** Read once per process. The files are immutable by policy (spec §06) and
 * total 2.2 MB across 74 of them, of which a given deployment realistically
 * touches a handful — so this is a small cache that never needs invalidating,
 * not a memory risk. A dev-mode edit to a template needs a server restart,
 * which is the same contract as `.env`. */
const cache = new Map<string, string>();

/** `relativePath` is always built by `resolveTemplatePath` or
 * `resolveSnippetPath` from closed unions, so it can never contain user text.
 * The containment check is a backstop against a future caller that forgets
 * that — cheap, and the alternative is trusting every future edit to this
 * file's callers. */
async function load(relativePath: string): Promise<string> {
  const cached = cache.get(relativePath);
  if (cached !== undefined) return cached;

  const absolute = path.join(TEMPLATE_ROOT, relativePath);
  if (!absolute.startsWith(TEMPLATE_ROOT + path.sep)) {
    throw new Error(`contract-template: refusing to read outside the template root: ${relativePath}`);
  }

  let html: string;
  try {
    html = await readFile(absolute, "utf8");
  } catch (cause) {
    throw new Error(
      `contract-template: ${relativePath} is missing from src/contract-templates. ` +
        `If this is production, check outputFileTracingIncludes in next.config.ts.`,
      { cause }
    );
  }
  cache.set(relativePath, html);
  return html;
}

/** The real-estate clause block for this document family, or null when the
 * deal is not a real-estate one. Spec §04's "use the matching snippet" is
 * `resolveSnippetPath`'s job; this just reads what it picked. */
export async function loadRealEstateClauses(deal: ContractDeal): Promise<string | null> {
  if (!deal.realEstate) return null;
  const snippet = resolveSnippetPath(deal.kind);
  if (!snippet) return null;
  return load(snippet);
}

export type RenderedContract = {
  html: string;
  templatePath: string;
  problems: RenderProblem[];
};

/** Substitute, then check. Spec §07 steps 4-6.
 *
 * Problems are *returned*, not thrown. Every one of them is something a
 * person can fix by editing a field — a blank phone number, a due date that
 * disagrees with a campaign start — and a thrown error would lose the
 * half-rendered document they were about to look at. The service is what
 * refuses to *issue* a contract with problems; a draft preview is allowed to
 * show them next to the document that has them. */
export async function renderContract(facts: ContractFacts): Promise<RenderedContract> {
  const templatePath = resolveTemplatePath(facts.deal);
  const template = await load(templatePath);
  const { text, raw } = buildTokens(facts);
  const html = substitute(template, text, raw);
  return { html, templatePath, problems: validateRendered(html, text, facts.deal) };
}

/** Reads the tokens a template actually contains. Used only by
 * `tests/contract-template.test.ts`, which asserts this against `tokensFor`
 * for all 74 files — the check that stops the hand-written declaration in
 * `contract.ts` from drifting when a new template package lands.
 *
 * Exported from here rather than duplicated in the test so that the test
 * reads the files the same way the app does, through the same root and the
 * same containment check. */
export async function tokensInTemplate(relativePath: string): Promise<string[]> {
  const html = await load(relativePath);
  const found = new Set<string>();
  for (const match of html.matchAll(/\{\{([A-Z_]+)\}\}/g)) found.add(match[1]);
  return [...found].sort();
}

/** Every template path the resolver can produce, for the same drift test.
 * Built by walking the same unions `resolveTemplatePath` walks, so a
 * combination the resolver can reach is a combination the test covers. */
export function everyTemplatePath(): { path: string; deal: ContractDeal }[] {
  const out: { path: string; deal: ContractDeal }[] = [];
  const kinds = ["PROPOSAL", "ONE_TIME", "MAINTENANCE"] as const;
  const plans = ["STARTER", "STANDARD", "ADVANCED"] as const;
  const adSetups = ["NONE", "META", "GOOGLE", "BOTH"] as const;
  const websiteTiers = ["BUSINESS", "PREMIUM", "FLAGSHIP"] as const;

  for (const kind of kinds) {
    for (const trial of [false, true]) {
      if (trial && kind === "PROPOSAL") continue;
      for (const plan of plans) {
        for (const ads of adSetups) {
          const deal: ContractDeal = { kind, trial, plan, ads, websiteTier: null, realEstate: false };
          out.push({ path: resolveTemplatePath(deal), deal });
        }
      }
      if (kind === "PROPOSAL") continue;
      for (const websiteTier of websiteTiers) {
        const deal: ContractDeal = {
          kind,
          trial,
          plan: "WEBSITE",
          ads: "NONE",
          websiteTier,
          realEstate: false,
        };
        out.push({ path: resolveTemplatePath(deal), deal });
      }
    }
  }
  return out;
}

/** Re-exported so callers do not need three imports to render one contract. */
export { tokensFor };
