import type { Post } from "@/lib/types";

// Posts have no sample flag in their frontmatter, so placeholder posts are
// marked by convention: their slug starts with "sample-".
export function isSamplePost(post: Post): boolean {
  return post.slug.startsWith("sample-");
}

// The author a post names, or null for the team's own posts ("The team", in
// any case): anything unmarked on the site is the team's, so those show no
// byline at all.
export function postAuthor(post: Post): string | null {
  const author = post.author.trim();
  if (author === "" || author.toLowerCase() === "the team") {
    return null;
  }
  return author;
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
