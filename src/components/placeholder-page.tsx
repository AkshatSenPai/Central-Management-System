import { Card } from "@/components/ui/card";

export function PlaceholderPage({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="p-8">
      <Card className="p-6">
        <h1 className="text-2xl font-semibold text-[var(--text)]">{title}</h1>
        <p className="mt-2 text-sm text-[var(--text-3)]">Coming in {phase}.</p>
      </Card>
    </div>
  );
}
