import { describe, it, expect } from "vitest";
import { buttonClass } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";

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

  // Three sizes, not two: `px-2 py-1 text-xs` appears in eight files, more
  // call sites than the danger and ghost variants combined. Folding it into
  // sm would inflate every dense row control in the app.
  it("switches padding and text size across all three sizes", () => {
    expect(buttonClass({ size: "xs" })).toContain("px-2 py-1 text-xs");
    expect(buttonClass({ size: "sm" })).toContain("px-3 py-1.5 text-sm");
    expect(buttonClass({ size: "md" })).toContain("px-4 py-2 text-sm");
  });

  it("declares text size exactly once, so xs is not overridden by the base", () => {
    for (const size of ["xs", "sm", "md"] as const) {
      expect(buttonClass({ size }).match(/text-(xs|sm)/g), size).toHaveLength(1);
    }
  });

  // `none` exists so a caller with a deliberate shape — the 32x32 icon
  // buttons in the topbar, the full-width rows in the account menu — states
  // its own geometry rather than layering a second px-* over this one and
  // trusting Tailwind's emission order to settle the tie.
  it("emits no padding or text size at all for size none", () => {
    const cls = buttonClass({ size: "none" });
    expect(cls).not.toMatch(/\bp[xy]?-/);
    expect(cls).not.toMatch(/\btext-(xs|sm)\b/);
    expect(cls).toContain("focus-visible:shadow-[var(--ring)]");
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

describe("fieldClass", () => {
  it("defaults to md, matching the form fields that dominate the codebase", () => {
    expect(fieldClass()).toContain("px-3 py-2");
  });

  it("switches padding and text size across all three sizes", () => {
    expect(fieldClass({ size: "xs" })).toContain("px-2 py-1 text-xs");
    expect(fieldClass({ size: "sm" })).toContain("px-3 py-1.5 text-sm");
    expect(fieldClass({ size: "md" })).toContain("px-3 py-2 text-sm");
  });

  it("declares text size exactly once, so xs is not overridden by the base", () => {
    for (const size of ["xs", "sm", "md"] as const) {
      expect(fieldClass({ size }).match(/text-(xs|sm)/g), size).toHaveLength(1);
    }
  });

  it("uses the surface and border tokens", () => {
    const cls = fieldClass();
    expect(cls).toContain("border-[var(--border)]");
    expect(cls).toContain("bg-[var(--surface)]");
    expect(cls).toContain("text-[var(--text)]");
  });

  it("carries a focus ring", () => {
    expect(fieldClass()).toContain("focus-visible:shadow-[var(--ring)]");
  });

  // The constants this replaces disagreed about width on purpose: form fields
  // were w-full, the bare selects in the project stat strip were not. Baking
  // w-full into the base stretches those selects and breaks that row.
  it("is not full-width by default — width belongs to the call site", () => {
    expect(fieldClass()).not.toContain("w-full");
    expect(fieldClass({ className: "w-full" })).toContain("w-full");
  });

  it("appends caller classes last so they can override", () => {
    expect(fieldClass({ className: "max-w-xs" }).endsWith("max-w-xs")).toBe(true);
  });

  it("emits no hardcoded colour", () => {
    expect(fieldClass()).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
