/** The app's entire icon vocabulary, and the single source of truth for it.
 *
 * Three things read this list:
 *   1. `<Icon>` — `IconName` is derived from it, so a typo is a type error.
 *   2. `scripts/fetch-icon-font.mjs` — asks Google for a woff2 subset
 *      containing exactly these glyphs and nothing else. 27 icons is 4.7 KB;
 *      the unsubsetted family is several megabytes.
 *   3. `npm run gates` — gate 7 fails if a name here is used nowhere, and
 *      gate 8 fails if the font file is stale with respect to this list.
 *
 * That third point is the reason this file exists rather than a loose union.
 * `--ico` shipped once before as an invented colour, went unused, and was
 * deleted for being unused — the right action for the wrong reason. An icon
 * that nothing renders is now a failing gate rather than a silent passenger.
 *
 * Adding an icon: add the name here, run `node scripts/fetch-icon-font.mjs`,
 * use it. Removing one: delete the usage, run the script, delete the name.
 * Names are Material Symbols identifiers — https://fonts.google.com/icons.
 */
export const ICON_NAMES = [
  // Sidebar navigation, one per route, in nav order.
  "space_dashboard",
  "check_circle",
  "business_center",
  "layers",
  "calendar_month",
  "groups",
  "lock",
  "campaign",
  "receipt_long",
  "settings",
  // Shell chrome.
  "search",
  "expand_more",
  "light_mode",
  "dark_mode",
  "logout",
  "person",
  // Actions.
  "add",
  "edit",
  "delete",
  "close",
  "person_add",
  "filter_list",
  // Content and state.
  "error",
  "event",
  "chevron_right",
  "drag_indicator",
  "mail",
  "call",
  "alternate_email",
] as const;

/* Deliberately absent, having been tried and removed rather than overlooked:
 *
 *   more_horiz     — the design uses it for row overflow menus. This app has
 *                    no overflow menus; member row actions are two labelled
 *                    buttons, which is better at that count.
 *   notifications  — Phase 4.
 *   push_pin, schedule, attach_file — Phases 3c and 6.
 *
 * Each was on this list until gate 7 asked where it was rendered and there
 * was no honest answer. That is the gate working, not the gate being
 * inconvenient: an icon in the font that nothing draws is the same dead
 * weight --ico was the first time round. */

export type IconName = (typeof ICON_NAMES)[number];
