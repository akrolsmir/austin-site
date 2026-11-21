import type { Metadata } from "next";
import "./globals.css";
import { EditorLoader } from "@/components/editor-loader";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { getSite } from "@/site";
import { fontVars } from "@/site/fonts";
import { themeCss } from "@/site/schema";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite(), title = site.text("site.title");
  return { title: { default: title, template: `%s | ${title}` }, description: site.text("site.description") };
}
// Design tokens reach globals.css as CSS variables from this one <style>; the editor previews a token by overriding its variable on <html>.
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const site = await getSite();
  return <html lang="en" className={fontVars}><head><style id="site-theme">{themeCss(site.values)}</style></head><body className="antialiased"><div className="site-wrap"><SiteHeader />{children}<SiteFooter /></div><EditorLoader /></body></html>;
}
