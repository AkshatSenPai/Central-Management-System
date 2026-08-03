import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { searchEverything } from "@/lib/search-queries";
import { KIND_LABEL, groupHits, parseSearchQuery, rankHits, searchSummary } from "@/lib/search";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { cardClass } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import type { IconName } from "@/lib/icons";
import type { SearchKind } from "@/lib/search";

const KIND_ICON: Record<SearchKind, IconName> = {
  client: "business_center",
  project: "layers",
  task: "check_circle",
};

/** Global search — spec §6.2, the first Phase 6 item, and the one that fills
 * the hole left when the disabled "Search (coming soon)" box was removed.
 *
 * A page rather than a dropdown: it works without JavaScript, it is
 * linkable and shareable, and it uses the app's existing GET-form convention
 * instead of inventing a live-suggest surface with its own keyboard model. */
export default async function SearchPage(props: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const raw = await props.searchParams;
  const term = parseSearchQuery(raw.q);

  if (!term) {
    return (
      <div className="mx-auto max-w-[840px] space-y-5 px-6 pb-10 pt-5">
        <PageHeader title="Search" subtitle="Clients, projects and tasks." />
        <EmptyState message="Type at least two characters in the search box above." />
      </div>
    );
  }

  const hits = rankHits(await searchEverything(prisma, term), term);
  const grouped = groupHits(hits);

  return (
    <div className="mx-auto max-w-[840px] space-y-5 px-6 pb-10 pt-5">
      <PageHeader title="Search" subtitle={searchSummary(hits.length, term)} />

      {hits.length === 0 ? (
        <EmptyState message="Nothing matched. Search covers client, project and task names — not comments or notes yet." />
      ) : (
        (Object.keys(grouped) as SearchKind[])
          .filter((kind) => grouped[kind].length > 0)
          .map((kind) => (
            <section key={kind} className="space-y-2">
              <h2 className="text-[12.5px] font-bold uppercase tracking-wide text-[var(--text-2)]">
                {KIND_LABEL[kind]}
              </h2>
              <div className={cardClass({ className: "overflow-hidden" })}>
                {grouped[kind].map((hit) => (
                  <Link
                    key={`${hit.kind}-${hit.id}`}
                    href={hit.href}
                    transitionTypes={["nav-forward"]}
                    className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 transition-colors last:border-b-0 hover:bg-[var(--surface-2)]"
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-[var(--surface-3)] text-[var(--text-2)]"
                    >
                      <Icon name={KIND_ICON[hit.kind]} size="sm" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--text)]">
                        {hit.title}
                      </span>
                      <span className="block truncate text-xs text-[var(--text-3)]">
                        {hit.subtitle}
                      </span>
                    </span>
                    <Icon name="chevron_right" size="sm" className="text-[var(--text-3)]" />
                  </Link>
                ))}
              </div>
            </section>
          ))
      )}
    </div>
  );
}
