import Link from "next/link";
import { getPosts } from "@/lib/writing";

export const revalidate = 300;
export const metadata = { title: "writing" };
export default async function Writing() {
  const posts = await getPosts();
  const years = [...new Set(posts.map((post) => post.date.slice(0, 4)))];
  return <main id="content" className="archive"><h1>writing</h1>{years.map((year) => <section key={year} className="archive-year"><h2>{year}</h2><ul className="post-list">{posts.filter((post) => post.date.startsWith(year)).map((post) => <li key={post.id}><Link href={`/writing/${post.id}`}>{post.title}</Link></li>)}</ul></section>)}</main>;
}
