# Contracts

Generating a client document — proposal, one-time agreement, maintenance
agreement, or either agreement with a trial first month — from the Shape
Odyssey template package.

The source of truth for the domain is the owner's own build spec, delivered as
`CMS_Implementation_Spec.pdf` with `ShapeOdyssey_CMS_Templates_v4.zip` on
2026-08-11. Section numbers quoted in the code (`§03`, `§05 check 2`) are that
document's. **Keep a copy of the PDF with the package** — the code cites it
constantly and it is not reproduced here in full.

## Where things are

| File | What it is |
|---|---|
| `src/contract-templates/` | The 72 templates and 2 clause snippets, vendored verbatim |
| `src/lib/contract.ts` | Pure domain — the deal, the filename resolver, the register format, dates |
| `src/lib/contract-render.ts` | Pure — token substitution and the validation checks |
| `src/lib/contract-template.ts` | Reads the template files; composes a finished document |
| `src/lib/contract-service.ts` | Draft, edit, issue, void, discard. The register allocator |
| `src/lib/contract-queries.ts` | Reads |
| `src/lib/contract-print.ts` | The `@font-face` block injected before printing |
| `src/server/actions/contracts.ts` | The action layer |
| `src/app/(app)/contracts/` | The register, one contract, and the print route |
| `scripts/fetch-contract-fonts.mjs` | Downloads the two document fonts |

## The decisions, and why

**Templates are code, not data.** Spec §06 is a section titled DO NOT CHANGE
and closes with "Do not edit the templates … Request a new package rather than
patching files." A database table is an edit box; putting 72 documents whose
defining property is that nobody may edit them behind an admin form would build
the exact affordance the spec spends a page forbidding. The cost is that a new
pricing package needs a deploy. That is the right trade for a legal document.

**There is no price column anywhere.** Spec §03: prices are baked into each
file and choosing the right file is how the price is set. A price column would
be a second source of truth for a number each document states three times over
— figures, words, and the liability cap. `paidAmount` is not a price; it is a
receipt of what arrived.

**An issued contract is frozen, in a column.** `TODO.md` §O ruled that a
document sent to a client must not silently change, so the rendered output is
the record rather than a re-render. It lives in `Contract.issuedHtml` rather
than R2 because issuing must allocate a number *and* freeze a document in one
transaction, and a bucket cannot join a Postgres transaction. Documents are
30–90 KB and Postgres TOASTs them out of the row.

**The register never has holes.** Numbers are allocated max-plus-one inside the
issuing transaction, guarded by a unique index on `(kind, year, sequence)` and
retried on a race. A Postgres sequence was rejected: sequences are not
transactional, so a rolled-back issue would burn a number. A voided contract
keeps its number, and a client with contracts cannot be deleted.

**Dates that must agree are derived from one input.** Spec §05 check 5 wants
`DUE_DATE_DAY` to match the campaign start and the trial to end the day before
one month on. Rather than ask for three dates and check them, the form asks for
the campaign start and derives the rest — so the check cannot fail. The trial
end clamps at a short month (31 Jan → 27 Feb) rather than rolling over to
3 March, which would sell a 31-day trial as a one-month one.

## Two departures from the spec

**1. Check 2 does not catch what it was written to catch.** §04 and §05 both
say that using the wrong real-estate snippet "produces duplicate clause
numbers". Against this package it does not. A one-time agreement numbers its
lettered sub-clauses 10A–10E and its snippet continues 10F–10L; maintenance
runs 12A–12E and continues 12F–12L. Cross them over and a maintenance agreement
gains clauses 10F–10L beside its existing `10` and `10A`, colliding with
neither — `duplicateClauseNumbers` returns nothing while seven clauses sit
under the wrong block, cross-referencing a "Clause 10C" that does not exist in
a maintenance agreement.

Added **check 2b**: a lettered clause run may not have a gap. `10F` without
`10E` is either the wrong snippet or a template that lost a clause. Both
directions are asserted in `tests/contract-template.test.ts`, including a test
that the spec's own check misses it — if that test ever starts failing, a new
package has changed the numbering and this note needs revisiting.

Check 2 is kept and still runs. It is cheap and catches a different failure.

**2. The unpaid blank uses the template's own class.** §02 prints an inline
`style="…"` for the dotted rule that replaces an unpaid amount. Every one-time
template already defines exactly that rule as `.blank`, so `BLANK_FILL` emits
`<span class="blank">`. The blank comes out at the template's 45mm rather than
the prose's 28mm, the colour stays defined in one place, and no colour literal
has to live in this app's source — which gate 1 forbids and which has exactly
two standing exemptions that this was not good enough to join.

## PDF: the app renders it, the browser never does

**`/contracts/{id}/pdf` runs headless Chromium server-side and returns a
finished A4 file.** `src/lib/contract-pdf.ts` does the work;
`@sparticuz/chromium` supplies the browser on Vercel and a locally-installed
Chrome does it in `next dev`. About two seconds.

**This replaced a print button, and the replacement was not optional.** The
first version served the document and let the operator print it. The first
real export came back on **US Letter** — so every page break landed wrong —
with `http://localhost:3000/…` and a timestamp stamped across every page of a
client agreement, at 6.5 MB, with font encoding mangled badly enough that WPS
Office refused to open the file. The print dialog's destination had been
"Microsoft Print to PDF", a virtual *printer*, which uses its own paper size
and ignores `@page { size: A4 }` entirely.

The lesson was not "choose the other destination". A legal document cannot
depend on four settings being right in an OS dialog. Same contract, before and
after:

| | print dialog | server-side |
|---|---|---|
| paper | 215.9 × 279.4 mm (Letter) | 209.9 × 297.0 mm (A4) |
| size | 6.45 MB | 0.19 MB |
| localhost URL on every page | yes | no |
| fonts | `/CIDFont+F1`, `/CIDFont+F2` | real named subsets |

Two settings in `renderContractPdf` are load-bearing and must not be removed:
`printBackground: true`, without which the navy cover and every shaded table
print white; and `preferCSSPageSize: true`, which takes A4 from the templates'
own `@page` rather than asserting it here, so a future package that changes
paper is not silently overridden.

`/contracts/{id}/print` still exists and still serves HTML — it is what the
preview iframe displays. Both routes read the same two sources: the frozen
`issuedHtml` for an issued contract, a live render for a draft. What is
approved and what is sent are the same bytes through two renderers.

### Page numbers and running headers do render

**Chromium implements the `@page` margin boxes.** The running header
(`@top-left`), the running footer (`@bottom-left`) and the page number
(`@bottom-right`, `counter(page) " / " counter(pages)`) all come out — page 2
of a rendered contract reads "2 / 10" in gold, verified by rasterising it.

This document previously said the opposite, and so did the code and two
handoffs. The claim came from checking the *end* of a page's extracted text
for a footer and finding body text. PDF text extraction emits margin-box
content **first**, so the footer had been there all along. It cost a
WeasyPrint-versus-Chromium decision that never needed making. Recorded here
because the failure was not the wrong answer, it was a single weak probe
treated as proof.

### The cover has to be bled deliberately

`.cover` gets its full-bleed navy by cancelling the page margin with
`margin: -18mm -17mm 0 -17mm`. That is correct paged-media CSS and it works in
WeasyPrint. **Chromium clips page content to the margin box**, so the overhang
is discarded and the paper shows through — the cover printed as a navy panel
with a white border.

`COVER_BLEED_CSS` in `contract-pdf.ts` fixes it with three rules, and all
three are needed:

| rule | why |
|---|---|
| `body { margin: 0 }` | No template sets a `body` rule, so the UA default 8px applies. 8px is enough to keep the cover off the paper edge whatever the page margin is — zeroing the page margin alone changes nothing visible |
| `@page :first { margin: 0 }` | Gives the cover a full-sheet page box. Body pages keep their margins |
| `.cover { margin: 0; min-height: 100vh }` | Stops the negative margin pulling it off the sheet, and fills the full 297mm — the template's `263mm` is the *content box* height and leaves 34mm white at the bottom once the margins are gone |

Removing `body { margin: 0 }` narrows body pages by ~2mm a side and changes
pagination — this document is 10 pages with it and 9 without. Both are
correct; the 10-page version is the one with the working cover.

**To verify after changing the templates or this CSS:** render a contract,
rasterise page 1, and sample the four corners — all four must be `#16263d`.
Sampling pixels is the only check that has ever caught this class of bug; unit
tests, types, lint, gates and a production build were green through every one
of them.

### Fonts

Spec §01 warns the fonts must be "installed on the rendering server, or the
output will fall back to system fonts and look wrong", and the self-contained
templates ship none. `scripts/fetch-contract-fonts.mjs` downloads them;
`contract-print.ts` declares them once and serves them two ways — by URL for
the browser preview, inlined as `data:` URIs for the renderer, which therefore
makes no network request at all.

**The rupee sign needed its own fix.** Neither Source Serif 4 nor Playfair
Display contains U+20B9 in any subset Google serves — their latin range lists
U+20AC (€) and U+2122 (™) and omits ₹ — so every figure in every contract was
falling through to the generic serif and rendering in Times New Roman. A
rupee-only cut of Noto Serif (852 bytes) is declared under both family names
with `unicode-range: U+20B9`, which wins for exactly that codepoint and
disturbs nothing else. No template edit. It was found by reading the font list
out of a rendered PDF — on screen it looks like a slightly odd rupee sign and
nothing more, which is worth remembering next time something "looks fine".

## A smaller observation

The template CSS declares `string-set: prepfor attr(data-prepfor)` and uses
`string(prepfor)` for the footer, but no template sets a `data-prepfor`
attribute — only `data-title`. That footer resolves to empty in any engine that
supports margin boxes at all. Harmless today, since Chromium ignores the whole
mechanism; worth mentioning to whoever generates the next package.

## Testing

`tests/contract-template.test.ts` renders **all 72 templates in both
real-estate states** and asserts no unsubstituted tokens, no duplicate clause
numbers and no lettering gaps. It also asserts that `tokensFor` matches what
each file actually contains, that every combination the resolver can produce
has a file, and that every file is reachable.

That is the check to run when a new package arrives. If it passes, the package
is compatible; if it fails, it names the file and the problem.
