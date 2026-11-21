import { cache } from "react";
import { readPublishedOverlay } from "../lib/overlay";
import { resolveSite, slots, type ListItem } from "./schema";

export type Site = { values: Record<string, unknown>; dropped: string[]; text(id: string): string; value<T>(id: string): T; list(id: string): ListItem[]; order(id: string): string[] };
// Server-side read of the site's slots: code defaults with the published overlay applied, once per render.
export const getSite = cache(async (): Promise<Site> => {
  const { values, dropped } = resolveSite(await readPublishedOverlay());
  if (dropped.length) console.warn(`Ignored invalid overlay entries: ${dropped.join(", ")}`);
  const value = <T,>(id: string) => { if (!Object.hasOwn(slots, id)) throw new Error(`Unknown slot ${id}.`); return values[id] as T; };
  return { values, dropped, value, text: (id) => value<string>(id), list: (id) => value<ListItem[]>(id), order: (id) => value<string[]>(id) };
});
