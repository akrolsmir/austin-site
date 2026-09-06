import Link from "next/link";
import { notFound } from "next/navigation";
import { getPost, getPosts } from "@/lib/writing";
import { NotionBlocks } from "@/components/notion-blocks";

export const revalidate = 300;
export const maxDuration = 120;
export function generateStaticParams() { return []; }
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = (await getPosts()).find((p) => p.id === id);
  return { title: post?.title ?? "writing" };
}
export default async function Article({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9]{32}$/.test(id)) notFound();
  const post = await getPost(id);
  if (!post) notFound();
  return <main id="content" className="article-wrap"><Link href="/#writing">writing</Link><article><header className="article-header"><h1>{post.title}</h1><div className="article-meta"><time dateTime={post.date}>{new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(post.date))}</time><a href={post.url}>Notion</a></div></header><div className="prose"><NotionBlocks blocks={post.blocks} sourceUrl={post.url} /></div></article></main>;
}
