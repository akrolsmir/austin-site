import Link from "next/link";
import { formatDate, getPosts } from "@/lib/posts";
import { E } from "@/site/e";

export const metadata = { title: "posts" };
export default async function Posts() {
  const posts = await getPosts();
  const years = [...new Set(posts.map((post) => post.date.slice(0, 4)))];
  return <main id="content" className="archive"><E id="posts.heading" as="h1" />{years.map((year) => <section key={year} className="archive-year"><h2>{year}</h2><ul className="post-list">{posts.filter((post) => post.date.startsWith(year)).map((post) => <li key={post.slug}><Link href={`/posts/${post.slug}`}>{post.title}</Link> <time className="post-date" dateTime={post.date}>{formatDate(post.date)}</time></li>)}</ul></section>)}</main>;
}
