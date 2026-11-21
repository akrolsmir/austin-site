import Link from "next/link";
import { getSite } from "@/site";
import { E } from "@/site/e";

// Nav hrefs are code, labels are slots. A link to a homepage section hidden by `home.order` is rendered with `hidden`.
const NAV = [["writing", "/posts"], ["projects", "/#projects"], ["work", "/#work"], ["links", "/#links"], ["photos", "/#photos"]];
export async function SiteHeader() {
  const site = await getSite(), shown = site.order("home.order");
  return <header className="site-header">
    <a href="#content" className="skip-link">{site.text("nav.writing")}</a>
    <Link href="/" className="wordmark" aria-label={site.text("site.wordmark")}><E id="site.wordmark" /><span className="asterisk" aria-hidden="true">✳</span></Link>
    <nav aria-label="Main navigation" className="main-nav">{NAV.map(([item, href]) => <E key={item} id={`nav.${item}`} as={Link} href={href} data-nav-for={item} hidden={href.startsWith("/#") && !shown.includes(item)} />)}</nav>
  </header>;
}
export function SiteFooter() { return <footer className="site-footer"><E id="site.footer" as={Link} href="/" /><Link href="/studio" className="site-footer-studio">Studio</Link></footer>; }
