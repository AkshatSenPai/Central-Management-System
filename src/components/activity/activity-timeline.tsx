import { describeActivity, type ActivityEntry } from "@/lib/activity";
import { relativeTime } from "@/lib/dates";
import { clientInitials } from "@/lib/client";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { EmptyState } from "@/components/ui/empty-state";

export function ActivityTimeline({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) {
    return <EmptyState message="Nothing has happened here yet." />;
  }

  return (
    <ul className="flex flex-col gap-3">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-start gap-3">
          <InitialsAvatar initials={clientInitials(entry.actorName)} shape="circle" size={26} />
          <p className="flex-1 text-sm text-[var(--text-2)]">{describeActivity(entry)}</p>
          <span className="flex-none text-xs text-[var(--text-3)]">{relativeTime(entry.at)}</span>
        </li>
      ))}
    </ul>
  );
}
