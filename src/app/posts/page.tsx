import Link from "next/link";
import { getPosts } from "@/lib/posts";

export const metadata = { title: "posts" };
export default function Posts() {
  const posts = getPosts();
  const years = [...new Set(posts.map((post) => post.date.slice(0, 4)))];
  return <main id="content" className="archive"><h1>posts</h1>{years.map((year) => <section key={year} className="archive-year"><h2>{year}</h2><ul className="post-list">{posts.filter((post) => post.date.startsWith(year)).map((post) => <li key={post.slug}><Link href={`/posts/${post.slug}`}>{post.title}</Link></li>)}</ul></section>)}</main>;
}
