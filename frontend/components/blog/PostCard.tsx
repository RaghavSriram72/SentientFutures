import Link from "next/link";

import { EmphasisText } from "@/components/common/Emphasis";
import { SampleChip } from "@/components/common/Marks";
import { formatDate } from "@/components/common/format";
import type { Post } from "@/lib/types";

import { isSamplePost } from "./posts";
import styles from "./PostCard.module.css";

// A post on the blog index. The whole card is clickable through the title link.
export function PostCard({ post }: { post: Post }) {
  return (
    <article className={`paper ${styles.card}`}>
      <div className={styles.meta}>
        <time dateTime={post.date}>{formatDate(post.date)}</time>
        {isSamplePost(post) && <SampleChip label="Sample draft" />}
      </div>
      <h2 className={styles.title}>
        <Link href={`/blog/${post.slug}/`} className={styles.link}>
          <EmphasisText text={post.title} />
        </Link>
      </h2>
      {post.summary && <p className={styles.summary}>{post.summary}</p>}
      <p className={styles.footer}>
        <span>By {post.author}</span>
        <span className={styles.read} aria-hidden="true">
          Read <span className={styles.arrow}>&rarr;</span>
        </span>
      </p>
    </article>
  );
}
