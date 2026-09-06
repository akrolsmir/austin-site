import type { Metadata } from "next";
import Link from "next/link";
import { Figtree } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-shell";
import { styles, defaultStyle } from "@/lib/styles";

const sans = Figtree({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
export const metadata: Metadata = { title: { default: "Austin", template: "%s | Austin" }, description: "Austin's Notes" };
// Set the saved style before paint; CSS scopes keep article content server-rendered.
const themeScript = `try{var s=new URLSearchParams(location.search).get('style')||localStorage.getItem('austin-style');if(${JSON.stringify(styles.map((style) => style.id))}.includes(s)){document.documentElement.dataset.style=s;}}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-style={defaultStyle} suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head><body className={`${sans.variable} antialiased`}><div className="site-wrap"><SiteHeader />{children}<footer className="site-footer"><LinkHome /></footer></div></body></html>;
}
function LinkHome() { return <Link href="/">Austin</Link>; }
