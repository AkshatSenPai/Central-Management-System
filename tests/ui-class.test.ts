import { describe, it, expect } from "vitest";
import { buttonClass } from "@/components/ui/button";

describe("buttonClass", () => {
  it("defaults to the secondary variant at sm, the codebase's dominant pair", () => {
    const cls = buttonClass();
    expect(cls).toContain("border-[var(--border)]");
    expect(cls).toContain("hover:bg-[var(--surface-2)]");
    expect(cls).toContain("px-3 py-1.5");
  });

  it("uses the button tokens for primary, never a raw colour", () => {
    const cls = buttonClass({ variant: "primary" });
    expect(cls).toContain("bg-[var(--btn)]");
    expect(cls).toContain("hover:bg-[var(--btn-h)]");
    expect(cls).toContain("text-[var(--on-btn)]");
    expect(cls).not.toContain("border-[var(--border)]");
  });

  it("uses the bad tokens for danger", () => {
    const cls = buttonClass({ variant: "danger" });
    expect(cls).toContain("border-[var(--bad-line)]");
    expect(cls).toContain("bg-[var(--bad-bg)]");
    expect(cls).toContain("text-[var(--bad)]");
  });

  it("gives ghost no border and no background", () => {
    const cls = buttonClass({ variant: "ghost" });
    expect(cls).not.toContain("border-[var(--border)]");
    expect(cls).not.toContain("bg-[var(--btn)]");
    expect(cls).toContain("hover:bg-[var(--surface-2)]");
  });

  it("switches padding on size", () => {
    expect(buttonClass({ size: "sm" })).toContain("px-3 py-1.5");
    expect(buttonClass({ size: "md" })).toContain("px-4 py-2");
  });

  // --ring was defined in Phase 1 and used zero times across 60 files. Every
  // variant carries focus styling or the app keeps its keyboard-accessibility
  // hole, which is the entire point of extracting this component.
  it("carries a focus ring on every variant", () => {
    for (const variant of ["primary", "secondary", "danger", "ghost"] as const) {
      expect(buttonClass({ variant }), variant).toContain("focus-visible:shadow-[var(--ring)]");
    }
  });

  it("carries the disabled treatment on every variant", () => {
    for (const variant of ["primary", "secondary", "danger", "ghost"] as const) {
      expect(buttonClass({ variant }), variant).toContain("disabled:opacity-50");
    }
  });

  it("appends caller classes last so they can override", () => {
    expect(buttonClass({ className: "w-full" }).endsWith("w-full")).toBe(true);
  });

  it("emits no hardcoded colour", () => {
    for (const variant of ["primary", "secondary", "danger", "ghost"] as const) {
      expect(buttonClass({ variant }), variant).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    }
  });
});
