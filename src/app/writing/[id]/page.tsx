import { notFound, permanentRedirect } from "next/navigation";
import { getPosts } from "@/lib/posts";

// Legacy /writing/<notion id> links resolve to the post's current slug.
export default async function LegacyArticle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = getPosts().find((post) => post.notion === id.replaceAll("-", ""));
  if (!post) notFound();
  permanentRedirect(`/posts/${post.slug}`);
}
