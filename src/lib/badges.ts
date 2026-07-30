/** The badge vocabulary shared by every domain module and the <Badge>
 * primitive. Declared here rather than in client.ts or project.ts so neither
 * has to import from the other. */
export type BadgeKind = "ok" | "warn" | "bad" | "neutral" | "strong";
