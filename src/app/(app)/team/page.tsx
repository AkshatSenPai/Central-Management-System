import { prisma } from "@/lib/prisma";
import { listTeamCards } from "@/lib/team-queries";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { MemberCard } from "@/components/team/member-card";

export default async function TeamPage() {
  const cards = await listTeamCards(prisma);

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <PageHeader title="Team" subtitle="What everyone is working on right now." />

      {cards.length === 0 ? (
        <EmptyState message="No active members yet." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <MemberCard key={card.id} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}
