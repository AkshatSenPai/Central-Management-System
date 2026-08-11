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
  "checklist",
  "business_center",
  "layers",
  "calendar_month",
  "groups",
  "lock",
  "campaign",
  "feedback",
  "description",
  "receipt_long",
  "settings",
  // Shell chrome.
  "menu",
  "search",
  "notifications",
  "schedule",
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
  "attach_file",
  "download",
  "print",
  "visibility",
  "visibility_off",
  // Content and state.
  "error",
  "event",
  "chevron_left",
  "chevron_right",
  "drag_indicator",
  "mail",
  "call",
  "alternate_email",
  "left_panel_close",
  "right_panel_open",
] as const;

/* Deliberately absent, having been tried and removed rather than overlooked:
 *
 *   more_horiz     — the design uses it for row overflow menus. This app has
 *                    no overflow menus; member row actions are two labelled
 *                    buttons, which is better at that count.
 *   push_pin       — Phase 3c.
 *
 * `notifications`, `search` and `attach_file` were all on this list and have
 * since earned their place back, as the features they label were built. The
 * list is a record of what was considered, not a permanent exclusion.
 * `attach_file` is the clearest case of that rule working as intended: it
 * was written into the Phase 3c spec's vocabulary lock alongside
 * `alternate_email`, and stayed out of the font for four days while the
 * comments half of that phase shipped and the attachments half was parked.
 * It arrives now, in the same commit as the upload control and the file list
 * that render it and `download`, because gate 7 would have failed on either
 * of them a moment sooner.
 *
 * `schedule` is the same story with a longer gap: listed here for Phase 6's
 * time tracking, removed when that never came, and earned back on 2026-08-07
 * by attendance — which is emphatically not the feature it was first reserved
 * for. Per-task timers were dropped; this labels a punch clock.
 *
 * Each was on this list until gate 7 asked where it was rendered and there
 * was no honest answer. That is the gate working, not the gate being
 * inconvenient: an icon in the font that nothing draws is the same dead
 * weight --ico was the first time round. */

export type IconName = (typeof ICON_NAMES)[number];
