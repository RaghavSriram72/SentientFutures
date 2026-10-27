import type { Post } from "@/lib/types";

// Posts have no sample flag in their frontmatter, so placeholder posts are
// marked by convention: their slug starts with "sample-".
export function isSamplePost(post: Post): boolean {
  return post.slug.startsWith("sample-");
}

// Newest first. Same-day posts fall back to slug order so builds are stable.
export function sortPosts(posts: Post[]): Post[] {
  const sorted = [...posts];
  sorted.sort((a, b) => {
    if (a.date !== b.date) {
      return a.date < b.date ? 1 : -1;
    }
    return a.slug.localeCompare(b.slug);
  });
  return sorted;
}
