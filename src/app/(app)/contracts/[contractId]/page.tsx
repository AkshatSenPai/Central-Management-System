import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getContractDetail, listAgreementNumbers } from "@/lib/contract-queries";
import { factsFromRow, PROVISIONAL_AGREEMENT_NO } from "@/lib/contract-service";
import { loadRealEstateClauses, renderContract } from "@/lib/contract-template";
import {
  CONTRACT_KIND_LABEL,
  CONTRACT_STATUS_BADGE,
  CONTRACT_STATUS_LABEL,
  dealSummary,
  longDate,
  type ContractDeal,
} from "@/lib/contract";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/ui/section-card";
import { ContractForm } from "@/components/contracts/contract-form";
import {
  DiscardControl,
  DownloadPdfButton,
  IssueControl,
  VoidControl,
} from "@/components/contracts/contract-actions";

const CHIP = "text-xs text-[var(--text-3)]";
const FRAME_ID = "contract-preview";

/** One contract: the document itself, what it was built from, and the two or
 * three things you can do to it.
 *
 * The preview is an `<iframe>` pointing at `./print`, not the HTML inlined
 * into this page. Three reasons, in order of how much they cost to get wrong:
 *
 *   1. **The document has its own CSS, and it is not this app's.** A contract
 *      styles `html`, `h1`, `p` and a dozen classes with names like `.num`
 *      and `.sec`. Inlined, those rules would apply to the CMS around it. A
 *      frame is a document boundary, which is exactly what is wanted.
 *   2. **Printing the frame prints the contract**, with its A4 paged-media
 *      CSS and none of the sidebar — see `PrintButton`.
 *   3. **Nothing has to trust the HTML.** It would otherwise reach React as
 *      `dangerouslySetInnerHTML`, and while the substitution layer escapes
 *      every typed value, "the document is only safe because a function three
 *      files away escapes correctly" is a worse property than "the document
 *      is in its own origin-separated frame".
 */
export default async function ContractDetailPage(props: {
  params: Promise<{ contractId: string }>;
}) {
  const { contractId } = await props.params;
  const row = await getContractDetail(prisma, contractId);
  if (!row) notFound();

  const deal: ContractDeal = {
    kind: row.kind,
    trial: row.trial,
    plan: row.plan,
    ads: row.ads,
    websiteTier: row.websiteTier,
    realEstate: row.realEstate,
  };

  const [agreementNumbers, clauses] = await Promise.all([
    listAgreementNumbers(prisma, { clientId: row.clientId, excludeContractId: row.id }),
    loadRealEstateClauses(deal),
  ]);

  // The §05 checks, run against the document as it currently stands. For a
  // draft this is what the Issue button is gated on; for an issued contract
  // it is a fact about the past and is not shown.
  const preview = await renderContract(
    factsFromRow(row, row.agreementNo ?? PROVISIONAL_AGREEMENT_NO, clauses)
  );
  const isDraft = row.status === "DRAFT";

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <nav className={CHIP}>
        <Link href="/contracts" transitionTypes={["nav-back"]} className="hover:text-[var(--text-2)]">
          Contracts
        </Link>
        <span> / </span>
        <Link href={`/clients/${row.clientId}`} className="hover:text-[var(--text-2)]">
          {row.client.name}
        </Link>
        <span> / </span>
        <span className="text-[var(--text-2)]">{row.agreementNo ?? "Draft"}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-[var(--text)]">
              {row.agreementNo ?? CONTRACT_KIND_LABEL[deal.kind]}
            </h1>
            <Badge kind={CONTRACT_STATUS_BADGE[row.status]} dot>
              {CONTRACT_STATUS_LABEL[row.status]}
            </Badge>
            {deal.realEstate ? <Badge kind="neutral">Real estate</Badge> : null}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={CHIP}>{CONTRACT_KIND_LABEL[deal.kind]}</span>
            <span className={CHIP}>{dealSummary(deal)}</span>
            <span className={CHIP}>{row.projectName}</span>
            <span className={CHIP}>{longDate(row.documentDate)}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-2">
          <DownloadPdfButton href={`/contracts/${row.id}/pdf`} />
          {isDraft ? (
            <>
              <ContractForm
                clientId={row.clientId}
                client={{ name: row.client.name, sector: null }}
                contract={{
                  id: row.id,
                  kind: row.kind,
                  trial: row.trial,
                  plan: row.plan,
                  ads: row.ads,
                  websiteTier: row.websiteTier,
                  realEstate: row.realEstate,
                  clientName: row.clientName,
                  clientFirm: row.clientFirm,
                  clientPhone: row.clientPhone,
                  clientEmail: row.clientEmail,
                  projectName: row.projectName,
                  documentDate: row.documentDate,
                  timeline: row.timeline,
                  campaignStartDate: row.campaignStartDate,
                  gracePeriod: row.gracePeriod,
                  paidAmount: row.paidAmount,
                  paidDate: row.paidDate,
                  counterpartAgreementNo: row.counterpartAgreementNo,
                }}
                agreementNumbers={agreementNumbers}
              />
              <IssueControl
                contractId={row.id}
                clientId={row.clientId}
                blockedReason={
                  preview.problems.length > 0
                    ? `Not ready to issue — ${preview.problems
                        .map((p) => `${p.check}: ${p.detail}`)
                        .join("; ")}`
                    : null
                }
              />
            </>
          ) : null}
          {row.status === "ISSUED" ? (
            <VoidControl contractId={row.id} clientId={row.clientId} />
          ) : null}
        </div>
      </div>

      {isDraft && preview.problems.length > 0 ? (
        <SectionCard title="Before this can be issued">
          <ul className="space-y-2">
            {preview.problems.map((problem) => (
              <li key={problem.check} className="text-sm text-[var(--text-2)]">
                <b className="text-[var(--text)]">{problem.check}</b> — {problem.detail}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {row.status === "VOID" ? (
        <SectionCard title="Voided">
          <p className="text-sm text-[var(--text-2)]">
            Withdrawn {row.voidedAt ? longDate(row.voidedAt) : ""}
            {row.voidReason ? ` — ${row.voidReason}` : ""}. The number stays spent; the register
            never reuses one.
          </p>
        </SectionCard>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* The template path used to sit here as `meta` and was moved to the
            Trail card. At 375px it is 46 characters of filename beside a
            three-word title, and the title is what loses — "The issued
            document" rendered as "The issued …". It is provenance rather than
            a heading qualifier, so it belongs with drafted-by and issued-by. */}
        <SectionCard title={isDraft ? "Preview" : "The issued document"}>
          {/* 1123px is A4's height at 96dpi, so a page of the document is a
              page of the frame and the reader is not scrolling through a
              letterbox. `title` is what a screen reader announces before
              entering it.

              **`?v=` is load-bearing and is not cache-busting superstition.**
              A Server Action calls `router.refresh()`, which re-renders this
              server component — but an <iframe> whose `src` string is
              unchanged is not reloaded by that, so the frame goes on showing
              whatever it fetched first. Found in QA: issuing a contract left
              the preview displaying the draft, agreement number and all, so a
              freshly-numbered SO/MT/2026/001 appeared on screen as
              `SO/__/____/___`. The stored document was correct the whole
              time; only the frame lied — which is the worse failure, because
              the natural response is to issue it again and burn a second
              number.

              `updatedAt` changes on every write to the row, so the src
              changes exactly when the document does, and never otherwise. */}
          <iframe
            id={FRAME_ID}
            src={`/contracts/${row.id}/print?v=${row.updatedAt.getTime()}`}
            title={`${CONTRACT_KIND_LABEL[deal.kind]} for ${row.clientName}`}
            className="h-[1123px] w-full rounded-md border border-[var(--border)] bg-[var(--surface)]"
          />
        </SectionCard>

        <div className="space-y-6">
          <SectionCard title="What it says" className="h-fit">
            <dl className="space-y-2.5 text-sm">
              <Row label="Client" value={row.clientName} />
              <Row label="Firm" value={row.clientFirm} />
              <Row label="Project" value={row.projectName} />
              <Row label="Phone" value={row.clientPhone} />
              <Row label="Email" value={row.clientEmail} />
              <Row label="Dated" value={longDate(row.documentDate)} />
              <Row label="Timeline" value={row.timeline} />
              <Row
                label="Campaign starts"
                value={row.campaignStartDate ? longDate(row.campaignStartDate) : null}
              />
              <Row label="Grace period" value={row.gracePeriod} />
              <Row label="Amount paid" value={row.paidAmount} />
              <Row label="Date paid" value={row.paidDate ? longDate(row.paidDate) : null} />
              <Row label="Cross-reference" value={row.counterpartAgreementNo} />
            </dl>
          </SectionCard>

          <SectionCard title="Trail" className="h-fit">
            <dl className="space-y-2.5 text-sm">
              <Row label="Drafted by" value={row.createdBy.name} />
              <Row label="Drafted" value={longDate(row.createdAt)} />
              <Row label="Issued by" value={row.issuedBy?.name ?? null} />
              <Row label="Issued" value={row.issuedAt ? longDate(row.issuedAt) : null} />
              {/* Which of the 72 files produced this. Recorded at issue and
                  never re-derived, so it answers "what did we actually send"
                  even after the resolver changes. `break-all` because it is a
                  path with no spaces in it and would otherwise push the card
                  wider than the column on a phone. */}
              <Row
                label="Template"
                value={row.templatePath ?? preview.templatePath}
                className="break-all font-mono text-xs"
              />
            </dl>
            {isDraft ? (
              <div className="mt-4 border-t border-[var(--border)] pt-4">
                <DiscardControl
                  contractId={row.id}
                  clientId={row.clientId}
                  returnTo={`/clients/${row.clientId}`}
                />
              </div>
            ) : null}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

/** A field that is absent is left out entirely rather than rendered blank —
 * an empty row invites the reader to wonder whether the value is missing or
 * the field does not apply, and on a contract those are different problems. */
function Row({
  label,
  value,
  className,
}: {
  label: string;
  value: string | null;
  className?: string;
}) {
  if (!value) return null;
  return (
    <div className="flex gap-3">
      <dt className="w-28 flex-none text-[var(--text-3)]">{label}</dt>
      {/* `min-w-0` is what lets a long value wrap instead of forcing the flex
          row wider than its parent — an email address and a template path
          both overflowed the sidebar card without it. */}
      <dd className={`min-w-0 break-words text-[var(--text-2)]${className ? ` ${className}` : ""}`}>
        {value}
      </dd>
    </div>
  );
}
