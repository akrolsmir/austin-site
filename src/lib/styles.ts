// Add a registry entry and a matching CSS scope to introduce another style.
export const styles = [
  { id: "4", label: "4", name: "Option 4" },
  { id: "5", label: "5", name: "Option 5" },
] as const;
export type SiteStyle = (typeof styles)[number]["id"];
export const defaultStyle: SiteStyle = "4";
export function validStyle(value: unknown): value is SiteStyle {
  return styles.some((style) => style.id === value);
}
