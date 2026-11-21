import Link from "next/link";
import { notFound } from "next/navigation";
import { getPost, getPosts } from "@/lib/posts";
import { Prose } from "@/components/prose";

// Posts are prerendered at build and cached (ISR); /api/sync revalidates changed slugs. Slugs published after the build
// render on first request, and removed ones revalidate to 404.
export const dynamicParams = true;
export async function generateStaticParams() { return (await getPosts()).map(({ slug }) => ({ slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const post = await getPost((await params).slug);
  return { title: post?.title ?? "posts", description: post?.excerpt || undefined };
}
export default async function Article({ params }: { params: Promise<{ slug: string }> }) {
  const post = await getPost((await params).slug);
  if (!post) notFound();
  return <main id="content" className="article-wrap"><Link href="/#writing">posts</Link><article><header className="article-header"><h1>{post.title}</h1><div className="article-meta"><time dateTime={post.date}>{new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(post.date))}</time><a href={post.url}>Notion</a></div></header><Prose body={post.body} /></article></main>;
}
