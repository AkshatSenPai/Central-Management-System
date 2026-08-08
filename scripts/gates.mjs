import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readIconNames } from "./icon-names.mjs";

/** A hidden input is frequently written across several lines, so the
 * `type="hidden"` sits below the `<input`. Line-based filtering misses those
 * and reports them as violations — milestone-strip.tsx has one. Read forward
 * from the match to the end of the opening tag and judge the whole tag. */
function tagIsHidden(match) {
  const m = match.match(/^([^:]*):(\d+):/);
  if (!m) return false;
  try {
    const lines = readFileSync(m[1], "utf8").split("\n");
    const tag = lines.slice(Number(m[2]) - 1, Number(m[2]) + 8).join("\n");
    return tag.slice(0, tag.indexOf(">") + 1).includes('type="hidden"');
  } catch {
    return false;
  }
}

/** Node rather than shell because the team is on Windows; `npm run` hands
 * scripts to cmd.exe, where a .sh file needs a POSIX shell that may not be
 * on PATH.
 *
 * `--untracked` matters more than it looks. Without it `git grep` sees only
 * files already in the index, so a brand-new component is invisible to every
 * gate until the moment it is committed — which is exactly one commit too
 * late for a check that exists to run before committing. Found when gate 7
 * reported five icons as unused while the file rendering them sat untracked
 * in the working tree. Ignored files stay excluded, so node_modules and
 * .next are still out of scope. */
function grep(args) {
  try {
    return execFileSync("git", ["grep", "--untracked", "-nE", ...args], { encoding: "utf8" }).trim();
  } catch (e) {
    // git grep exits 1 with no output when nothing matches. That is success.
    if (e.status === 1 && !e.stdout.trim()) return "";
    throw e;
  }
}

/** Drops matches inside line comments. client-form.tsx explains a React 19
 * quirk with the words "but a <select> does not", which is indistinguishable
 * from JSX to a regex. A gate that fails on prose teaches people to ignore
 * it, so the prose is filtered rather than the comment reworded. */
function stripComments(output) {
  return output
    .split("\n")
    .filter((line) => {
      const code = line.replace(/^[^:]*:\d+:/, "");
      return line && !/^\s*(\/\/|\*|\/\*)/.test(code);
    })
    .join("\n");
}

const UI = "src/components/ui";
const TSX = "src/**/*.tsx";

const gates = [
  {
    // Two files are exempt, and only two. Both are cases where the colour is
    // consumed somewhere a stylesheet does not reach, so a token is not merely
    // inconvenient but impossible:
    //
    //   email-templates.ts — mail clients strip <style> blocks and never load
    //     external CSS, so a colour must be a literal hex in a style attribute.
    //   app/manifest.ts — the manifest is JSON handed to the browser and
    //     parsed before any stylesheet exists; background_color and theme_color
    //     paint the install splash screen, and var() there is not a colour.
    //
    // The alternative in both cases is a permanently red gate, which is a gate
    // somebody eventually deletes. Keep this list at two unless a third has the
    // same "no stylesheet can reach it" property — "it was easier" does not
    // qualify.
    name: "1. no dark: variant, no hardcoded colour outside globals.css (email + manifest exempt)",
    run: () =>
      grep([
        "dark:|#[0-9a-fA-F]{3,6}",
        "--",
        TSX,
        "src/**/*.ts",
        ":!src/lib/email-templates.ts",
        ":!src/app/manifest.ts",
      ]),
  },
  {
    name: "2. no raw <button> outside the Button primitive",
    run: () => stripComments(grep(["<button", "--", TSX, `:!${UI}/button.tsx`])),
  },
  {
    // 60 hidden inputs carry every taskId/projectId/clientId in the app. They
    // have no styling and are not a design concern. A gate that flags all 60
    // on day one is a gate that gets deleted in week two.
    name: "3. no raw <input>/<select>/<textarea> outside ui/ (hidden inputs exempt)",
    run: () =>
      stripComments(grep(["<(input|select|textarea)", "--", TSX, `:!${UI}/*`]))
        .split("\n")
        .filter((l) => l && !tagIsHidden(l))
        .join("\n"),
  },
  {
    name: "4. no FIELD/LABEL/CARD/BTN/SELECT class constants outside ui/",
    run: () => grep(["^ *const (FIELD|LABEL|CARD|BTN|SELECT) =", "--", TSX, `:!${UI}/*`]),
  },
  {
    // Tailwind's own shadow-lg is a fixed value; the shadow tokens differ
    // sharply between themes (rgba(16,17,26,.14) light vs rgba(3,5,10,.7)
    // dark). The quick-add popover shipped with the Tailwind one, so it read
    // identically in both themes. Gate 1 cannot see it — no hex is involved.
    //
    // NOTE: this file must never contain a literal arbitrary-value class such
    // as the bracketed shadow-token syntax. Tailwind v4 scans the whole
    // project for class candidates, including scripts/, and an earlier
    // version of this very description was emitted as a real utility with an
    // invalid var() name, which broke the CSS build. Patterns here are built
    // from fragments for that reason.
    name: "6. built-in Tailwind shadow utilities — use the shadow tokens instead",
    run: () => stripComments(grep(["(^|[\"' ])" + "shadow-" + "(sm|md|lg|xl|2xl)([\"' ]|$)", "--", TSX])),
  },
  {
    name: "5. every interactive primitive carries focus-visible styling",
    run: () => {
      const missing = ["button.tsx", "field.tsx", "checkbox.tsx"].filter(
        (f) => grep(["focus-visible:shadow-\\[var\\(--ring\\)\\]", "--", `${UI}/${f}`]) === ""
      );
      return missing.length ? `missing focus-visible ring: ${missing.join(", ")}` : "";
    },
  },
  {
    // The precise failure this exists to prevent, from Phase 3b's postmortem:
    // --ico was added, never consumed, and later deleted for being unused.
    // An icon nobody renders is dead weight in the font subset and a lie in
    // the vocabulary. Listing one is now a commitment to using it.
    name: "7. every icon in src/lib/icons.ts is used somewhere",
    run: () => {
      const unused = readIconNames().filter(
        (n) => grep([`"${n}"`, "--", TSX, "src/**/*.ts", ":!src/lib/icons.ts"]) === ""
      );
      return unused.length ? `declared but never rendered: ${unused.join(", ")}` : "";
    },
  },
  {
    name: "8. the committed icon font matches src/lib/icons.ts",
    run: () => {
      try {
        execFileSync("node", ["scripts/fetch-icon-font.mjs", "--check"], { encoding: "utf8" });
        return "";
      } catch (e) {
        return (e.stderr || e.stdout || String(e)).trim();
      }
    },
  },
  {
    // Same contract as gate 8, for the PWA icons: the mark lives in the
    // generator script, the PNGs are committed, and this is what stops the two
    // drifting. A stale home-screen icon is invisible in development — nobody
    // installs the app to check — and only shows up on somebody's phone weeks
    // later, still wearing the old logo.
    name: "10. the committed app icons match scripts/generate-app-icons.mjs",
    run: () => {
      try {
        execFileSync("node", ["scripts/generate-app-icons.mjs", "--check"], { encoding: "utf8" });
        return "";
      } catch (e) {
        return (e.stderr || e.stdout || String(e)).trim();
      }
    },
  },
  {
    // Icons go through <Icon>, the way colours go through tokens. A raw
    // ligature span skips the aria-hidden that stops screen readers reading
    // "check underscore circle", and skips the text-transform guards that
    // stop the glyph decaying back into visible text.
    name: "9. no raw icon spans — use the Icon primitive",
    run: () =>
      stripComments(
        grep(["Material Symbols|class(Name)?=\"ico(-s)?\"", "--", TSX, `:!${UI}/icon.tsx`])
      ),
  },
];

let failed = 0;
for (const gate of gates) {
  const output = gate.run();
  if (output) {
    failed++;
    const lines = output.split("\n");
    console.error(`FAIL ${gate.name}  (${lines.length})`);
    console.error(output.split("\n").slice(0, 40).join("\n"));
    if (lines.length > 40) console.error(`  … and ${lines.length - 40} more`);
    console.error("");
  } else {
    console.log(`ok   ${gate.name}`);
  }
}
process.exit(failed ? 1 : 0);
