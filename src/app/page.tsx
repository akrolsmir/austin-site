import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { formatDate, getPosts } from "@/lib/posts";
import { photos } from "@/lib/photos";
import { getSite } from "@/site";
import { E } from "@/site/e";
import { slots } from "@/site/schema";

const more = (id: string, href: string) => <Link className="archive-link" href={href}><E id={id} /> <span aria-hidden="true">↗</span></Link>;
export default async function Home() {
  const [posts, site] = await Promise.all([getPosts(), getSite()]);
  const guide = posts.find((p) => p.title === "A guide to working with Austin");
  const sections: Record<string, { className: string; label?: string; body: ReactNode }> = {
    writing: { className: "writing-section", body: <><E id="home.writing.heading" as="h1" /><ul className="post-list">{posts.filter((p) => p.slug !== guide?.slug).slice(0, 8).map((post) => <li key={post.slug}><Link href={`/posts/${post.slug}`}>{post.title}</Link> <time className="post-date" dateTime={post.date}>{formatDate(post.date)}</time>{post.excerpt && <p className="post-excerpt">{post.excerpt}</p>}</li>)}</ul>{more("home.writing.more", "/posts")}</> },
    photos: { className: "album-photos", label: site.text("home.photos.heading"), body: <><E id="home.photos.heading" as="h2" /><div className="album-photo-stack">{photos.slice(0, 2).map((photo) => <Link key={photo.url} href="/photos" className="album-photo"><Image src={photo.url} alt={photo.alt} width={photo.width} height={photo.height} sizes="(max-width: 760px) 100vw, 360px" /></Link>)}</div>{more("home.photos.more", "/photos")}</> },
    projects: { className: "projects-section", body: <><E id="home.projects.heading" as="h2" /><div className="project-list" data-e-list="home.projects.items">{site.list("home.projects.items").map((p) => <div key={p.id} data-e-item={p.id}><h3>{p.url ? <a href={p.url} data-e-field="name" data-e-field-href="url">{p.name}</a> : <span data-e-field="name">{p.name}</span>}</h3><p data-e-field="blurb">{p.blurb}</p></div>)}</div></> },
    work: { className: "work-section", body: <><E id="home.work.heading" as="h2" /><E id="home.work.body" as="p" /></> },
    links: { className: "links-section", body: <><E id="home.links.heading" as="h2" /><ul className="link-list" data-e-list="home.links.items">{site.list("home.links.items").map((link) => <li key={link.id} data-e-item={link.id}><a href={link.url} data-e-field="label" data-e-field-href="url">{link.label}</a></li>)}</ul></> },
  };
  // Sections render in `home.order` order; an item left out of the slot is hidden but stays in the DOM (after the visible
  // ones) so the editor can bring it back. How the order becomes a layout is in globals.css under ".sections".
  const order = site.order("home.order"), def = slots["home.order"], all = def.kind === "order" ? def.items : [];
  return <main id="content">
    <div className="intro"><E id="home.intro" as="p" />{guide && <Link className="guide-link" prefetch={false} href={`/posts/${guide.slug}`}>{guide.title}</Link>}</div>
    <div className="sections" data-e-order="home.order">{[...order, ...all.filter((id) => !order.includes(id))].map((id) => <section key={id} id={id} data-section={id} className={sections[id].className} aria-label={sections[id].label} hidden={!order.includes(id)}>{sections[id].body}</section>)}</div>
  </main>;
}
