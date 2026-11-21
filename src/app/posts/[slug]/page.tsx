import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, getPost, getPosts } from "@/lib/posts";
import { Prose } from "@/components/prose";

// Every post is prerendered from data/posts at build time; unknown slugs are 404s.
export const dynamicParams = false;
export function generateStaticParams() { return getPosts().map(({ slug }) => ({ slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const post = getPost((await params).slug);
  return { title: post?.title ?? "posts", description: post?.excerpt || undefined };
}
export default async function Article({ params }: { params: Promise<{ slug: string }> }) {
  const post = getPost((await params).slug);
  if (!post) notFound();
  return <main id="content" className="article-wrap"><Link href="/posts">posts</Link><article><header className="article-header"><h1>{post.title}</h1><div className="article-meta"><time dateTime={post.date}>{formatDate(post.date)}</time><a href={post.url}>Notion</a></div></header><Prose body={post.body} /></article></main>;
}
