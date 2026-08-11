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

## The open question: PDF

**The app does not produce a PDF. It produces the document, and the browser
prints it.** `/contracts/{id}/print` serves the contract as standalone HTML
with its own A4 paged-media CSS; the detail page frames it and the Print button
calls `print()` on the frame, so Save-as-PDF gives an A4 PDF of the contract
with none of the app around it.

**What this loses, and it is worth a decision:** the templates use CSS margin
boxes — `@top-left`, `@bottom-right`, `counter(page)`, `string(prepfor)` — to
draw the running header, the running footer and the **page numbers**.
**Chromium does not implement margin boxes.** WeasyPrint and PrinceXML do;
Chrome and wkhtmltopdf do not. So a browser-printed contract has the right
content, the right typography and the right page breaks, and no "Page 3 of 7".

Three ways forward, in increasing cost:

1. **Accept it.** The body is complete and correct; page numbers are a
   nicety on a document that is e-signed rather than shuffled on a desk.
2. **Paged.js** — an MIT JavaScript polyfill for exactly these features,
   injected into the print route. Cheapest real fix, but it repaginates the
   document client-side and would need checking against all 72 templates
   before going anywhere near a client.
3. **A real paged-media engine.** WeasyPrint as a small Python function
   renders these templates as designed. Most faithful, and a new runtime.

Nothing in the code assumes the answer: `renderContract` returns HTML and the
print route is the only thing that turns it into pixels.

**Fonts are handled.** Spec §01 warns that Playfair Display and Source Serif 4
must be "installed on the rendering server, or the output will fall back to
system fonts and look wrong", and the self-contained templates ship none.
`scripts/fetch-contract-fonts.mjs` downloads them and the print route injects
an `@font-face` block, which is this app's version of installing them. The
stored document is not modified.

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
