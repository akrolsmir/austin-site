import { Figtree, Inter, Instrument_Sans, Newsreader, Source_Serif_4 } from "next/font/google";

// One CSS variable per entry of the `fonts` registry in schema.ts. Only the default (Figtree) is preloaded; the others add an
// @font-face rule to the stylesheet and their files are fetched only by a page whose theme actually uses them.
const figtree = Figtree({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap", preload: false });
const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument-sans", display: "swap", preload: false });
const sourceSerif = Source_Serif_4({ subsets: ["latin"], variable: "--font-source-serif", display: "swap", preload: false });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", display: "swap", preload: false });
/** Class list for <html>: the theme's --font-body/--font-heading resolve these variables at :root. */
export const fontVars = [figtree, inter, instrument, sourceSerif, newsreader].map((font) => font.variable).join(" ");
