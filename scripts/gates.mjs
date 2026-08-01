import { execFileSync } from "node:child_process";

/** Node rather than shell because the team is on Windows; `npm run` hands
 * scripts to cmd.exe, where a .sh file needs a POSIX shell that may not be
 * on PATH. */
function grep(args) {
  try {
    return execFileSync("git", ["grep", "-nE", ...args], { encoding: "utf8" }).trim();
  } catch (e) {
    // git grep exits 1 with no output when nothing matches. That is success.
    if (e.status === 1 && !e.stdout.trim()) return "";
    throw e;
  }
}

const UI = "src/components/ui";
const TSX = "src/**/*.tsx";

const gates = [
  {
    name: "1. no dark: variant, no hardcoded colour outside globals.css",
    run: () => grep(["dark:|#[0-9a-fA-F]{3,6}", "--", TSX, "src/**/*.ts"]),
  },
  {
    name: "2. no raw <button> outside the Button primitive",
    run: () => grep(["<button", "--", TSX, `:!${UI}/button.tsx`]),
  },
  {
    // 60 hidden inputs carry every taskId/projectId/clientId in the app. They
    // have no styling and are not a design concern. A gate that flags all 60
    // on day one is a gate that gets deleted in week two.
    name: "3. no raw <input>/<select>/<textarea> outside ui/ (hidden inputs exempt)",
    run: () =>
      grep(["<(input|select|textarea)", "--", TSX, `:!${UI}/*`])
        .split("\n")
        .filter((l) => l && !l.includes('type="hidden"'))
        .join("\n"),
  },
  {
    name: "4. no FIELD/LABEL/CARD/BTN/SELECT class constants outside ui/",
    run: () => grep(["^ *const (FIELD|LABEL|CARD|BTN|SELECT) =", "--", TSX, `:!${UI}/*`]),
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
