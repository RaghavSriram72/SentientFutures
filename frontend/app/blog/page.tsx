import type { Metadata } from "next";

import { sortPosts } from "@/components/blog/posts";
import { PostCard } from "@/components/blog/PostCard";
import { PageHeader } from "@/components/common/PageHeader";
import { getPosts } from "@/lib/data";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Blog",
  description: "Notes from the team on the research, new evidence and changes to the timeline.",
};

export default function BlogIndexPage() {
  const posts = sortPosts(getPosts());

  return (
    <>
      <PageHeader
        eyebrow="Blog"
        title={
          <>
            Notes from <em>the research</em>
          </>
        }
        lede="What we're reading, new results as they come out, and the reasons behind changes to the timeline."
      >
        <span className="chip">
          {posts.length} {posts.length === 1 ? "post" : "posts"}
        </span>
      </PageHeader>

      <div className="container section">
        <ul className={styles.grid}>
          {posts.map((post) => (
            <li key={post.slug} className="reveal">
              <PostCard post={post} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
