import Link from "next/link";
import { StyleSwitch } from "./style-switch";

export function SiteHeader() {
  return <header className="site-header">
    <a href="#content" className="skip-link">writing</a>
    <Link href="/" className="wordmark" aria-label="Austin">Austin<span className="asterisk" aria-hidden="true">✳</span></Link>
    <nav aria-label="Main navigation" className="main-nav"><Link href="/#writing">writing</Link><Link href="/#projects">projects</Link><Link href="/#work">work</Link><Link href="/#links">links</Link><Link href="/#photos">photos</Link></nav>
    <StyleSwitch />
  </header>;
}

export function Placeholder({ className = "" }: { className?: string }) {
  return <div className={`photo-placeholder ${className}`} aria-label="Photo placeholder"><span>Lorem ipsum</span></div>;
}
export const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla cursus, sapien nec posuere bibendum, lacus augue interdum nunc, vitae luctus purus velit vitae ligula.";
