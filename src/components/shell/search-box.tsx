"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";

/** The topbar search box, restored — this time attached to something.
 *
 * It shipped once as a disabled input reading "Search (coming soon)" on every
 * screen, and was removed for advertising a feature it refused to provide. It
 * comes back now that /search exists.
 *
 * A plain GET form, not a live-suggest dropdown: it works without JavaScript,
 * the result is a linkable URL, and it matches the filter convention used
 * everywhere else in the app rather than inventing a keyboard model of its
 * own. */
export function SearchBox() {
  const pathname = usePathname();
  const params = useSearchParams();
  // Keeps the term in the box after searching, so refining a search means
  // editing what you typed rather than retyping it.
  const current = pathname === "/search" ? (params.get("q") ?? "") : "";

  return (
    <form method="get" action="/search" className="flex flex-1 justify-center">
      <label className="relative flex w-full max-w-[400px] items-center">
        <Icon
          name="search"
          size="sm"
          className="pointer-events-none absolute left-2.5 text-[var(--text-3)]"
        />
        <Field
          size="sm"
          name="q"
          type="search"
          // key: remount when the term changes so the defaultValue is re-read
          // after a navigation, without making this a controlled input that
          // would fight the browser's own search-field behaviour.
          key={current}
          defaultValue={current}
          className="h-8 w-full bg-[var(--surface-2)] pl-[34px]"
          placeholder="Search clients, projects, tasks…"
          aria-label="Search"
        />
      </label>
    </form>
  );
}
