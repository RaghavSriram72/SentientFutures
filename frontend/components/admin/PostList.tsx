"use client";

import Link from "next/link";

import { stripEmphasis } from "@/components/common/Emphasis";
import type { AdminPost } from "@/lib/adminTypes";
import { listPosts } from "@/lib/api";

import { AdminPageHead } from "./AdminPageHead";
import { formatDateTime, formatDay } from "./adminFormat";
import { PublishStateChip } from "./Chips";
import styles from "./Editor.module.css";
import forms from "./forms.module.css";
import { ApiErrorNotice } from "./Notice";
import runs from "./runs.module.css";
import { useApiData } from "./useApiData";

export function postEditHref(slug: string): string {
  return `/admin/posts/edit/?slug=${encodeURIComponent(slug)}`;
}

// "2026-10-26" -> "26 Oct 2026", read as a calendar day so the zone can't shift it.
function postDay(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }
  // Noon local time, so the day is the same in every zone.
  return formatDay(`${date}T12:00:00`);
}

// /admin/posts/: every post, drafts too, newest first.
export function PostList() {
  const posts = useApiData("posts", listPosts);

  return (
    <>
      <AdminPageHead
        eyebrow="Team admin"
        title={
          <>
            Blog <em>posts</em>
          </>
        }
        lede="Drafts stay here. A post marked published goes on the site with the next publish."
        actions={
          <Link href="/admin/posts/edit/" className={`btn btn-primary ${forms.smallButton}`}>
            Write a post
          </Link>
        }
      />
      <div className={`container ${styles.listPage}`}>
        {posts.error && <ApiErrorNotice error={posts.error} title="Couldn't load the posts" onRetry={posts.reload} />}
        {!posts.error && !posts.data && <p className={styles.muted}>Loading&hellip;</p>}
        {posts.data && posts.data.length === 0 && (
          <p className={styles.muted}>
            No posts yet. <Link href="/admin/posts/edit/">Write the first one</Link>.
          </p>
        )}
        {posts.data && posts.data.length > 0 && <PostTable posts={posts.data} />}
      </div>
    </>
  );
}

function PostTable({ posts }: { posts: AdminPost[] }) {
  return (
    <table className={`${runs.table} ${styles.fixedTable}`}>
      <caption className="visually-hidden">Blog posts, newest first</caption>
      <colgroup>
        <col className={styles.colMain} />
        <col className={styles.colState} />
        <col className={styles.colStage} />
        <col className={styles.colSaved} />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Post</th>
          <th scope="col">Status</th>
          <th scope="col">Date</th>
          <th scope="col">Last saved</th>
        </tr>
      </thead>
      <tbody>
        {posts.map((post) => (
          <tr key={post.slug}>
            <th scope="row">
              <Link href={postEditHref(post.slug)} className={styles.nameLink}>
                {post.title ? stripEmphasis(post.title) : "Untitled"}
              </Link>
              <div className={styles.idCell}>/blog/{post.slug}/</div>
            </th>
            <td data-label="Status">
              <PublishStateChip published={post.status === "published"} />
            </td>
            <td data-label="Date">{post.date ? postDay(post.date) : "Not set"}</td>
            <td data-label="Last saved" className={runs.startedBy}>
              <span title={formatDateTime(post.updated_at)}>{formatDay(post.updated_at)}</span>
              {post.updated_by && <span className={styles.byLine}>by {post.updated_by}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
