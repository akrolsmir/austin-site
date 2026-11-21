import Image from "next/image";
import Link from "next/link";
import { getPosts } from "@/lib/posts";
import { lorem, Placeholder } from "@/components/site-shell";
import { photos } from "@/lib/photos";

export default async function Home() {
  const posts = await getPosts();
  const guide = posts.find((p) => p.title === "A guide to working with Austin");
  return <main id="content">
    <div className="intro-layout"><div className="intro"><p>{lorem}</p>{guide && <Link className="guide-link" prefetch={false} href={`/posts/${guide.slug}`}>{guide.title}</Link>}</div><Placeholder className="intro-photo" /></div>
    <div className="content-grid"><section id="writing" className="writing-section"><h1>Austin&apos;s Notes</h1><ul className="post-list">{posts.filter((p) => p.slug !== guide?.slug).slice(0, 8).map((post) => <li key={post.slug}><Link href={`/posts/${post.slug}`}>{post.title}</Link>{post.excerpt && <p className="post-excerpt">{post.excerpt}</p>}</li>)}</ul><Link className="archive-link" href="/posts">all posts <span aria-hidden="true">↗</span></Link></section>
    <aside className="projects-section" id="projects"><h2>projects</h2><div className="project-list">{["pianosu", "scanlate.io", "One Word", "Glowflow"].map((name) => <div key={name}><h3>{name}</h3><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p></div>)}</div><section id="work" className="work-section"><h2>work</h2><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p></section></aside><section className="album-photos" id="photos" aria-label="photos"><h2>photos</h2><div className="album-photo-stack">{photos.slice(0, 2).map((photo) => <Link key={photo.url} href="/photos" className="album-photo"><Image src={photo.url} alt={photo.alt} width={photo.width} height={photo.height} sizes="(max-width: 760px) 100vw, 360px" /></Link>)}</div><Link className="archive-link" href="/photos">all photos <span aria-hidden="true">↗</span></Link></section></div>
    <div className="bottom-band"><section id="links"><h2>links</h2><a href="https://akrolsmir.notion.site/">Austin&apos;s Notes</a></section></div>
  </main>;
}
