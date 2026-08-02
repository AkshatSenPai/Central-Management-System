import type { Metadata } from "next";
import { Public_Sans, IBM_Plex_Mono } from "next/font/google";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

/** Numerals that need to line up or be read character by character —
 * checklist ratios, stat figures, activity timestamps. Two weights because
 * the mockup uses 500 for figures and 400 for meta text. */
const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

/** Material Symbols is not in next/font/google's catalogue, so it comes from
 * `next/font/local` over a committed file. `scripts/fetch-icon-font.mjs`
 * produces that file as a subset of exactly the icons in `src/lib/icons.ts`.
 *
 * `display: "block"` rather than the default "swap": an icon font renders
 * through ligatures, so a swap period shows the literal text `check_circle`
 * in the UI until the font arrives. Block shows nothing instead — a brief
 * gap is a far smaller failure than a screen of raw identifiers.
 *
 * `adjustFontFallback: false` because the synthetic fallback metrics Next
 * computes are for text; there is no sensible Arial approximation of an icon,
 * and letting it generate one only widens the gap it is meant to close.
 *
 * `weight: "400"` is a matching key, not a description. The subsetter already
 * baked wght 300 into the glyphs; declaring 400 means the `font` shorthand in
 * --ico, which resets font-weight to normal, matches this face exactly rather
 * than provoking synthetic bolding. */
const materialSymbols = localFont({
  src: "../../public/fonts/material-symbols-outlined.woff2",
  variable: "--font-material-symbols",
  display: "block",
  adjustFontFallback: false,
  weight: "400",
  style: "normal",
});

export const metadata: Metadata = {
  title: "Meridian Ops",
  description: "Internal operations hub",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} ${ibmPlexMono.variable} ${materialSymbols.variable}`}
      suppressHydrationWarning
    >
      <body className="bg-[var(--bg)] text-[var(--text)] antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
