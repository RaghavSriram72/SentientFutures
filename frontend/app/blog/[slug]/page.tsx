import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { isSamplePost } from "@/components/blog/posts";
import { PostBody } from "@/components/blog/PostBody";
import { EmphasisText, stripEmphasis } from "@/components/common/Emphasis";
import { SampleChip } from "@/components/common/Marks";
import { PageHeader } from "@/components/common/PageHeader";
import { formatDate } from "@/components/common/format";
import { getPost, getPosts } from "@/lib/data";

import styles from "./page.module.css";

interface PostPageProps {
  params: Promise<{ slug: string }>;
}

// Static export: one page per post, and no others. The permanent "About this
// blog" post keeps this list from ever being empty, which would fail the export.
export const dynamicParams = false;

export function generateStaticParams(): { slug: string }[] {
  const params: { slug: string }[] = [];
  for (const post of getPosts()) {
    params.push({ slug: post.slug });
  }
  return params;
}

export async function generateMetadata({ params }: PostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) {
    return {};
  }
  return {
    title: stripEmphasis(post.title),
    description: post.summary,
  };
}

export default async function PostPage({ params }: PostPageProps) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) {
    notFound();
  }
  const isSample = isSamplePost(post);

  return (
    <article>
      <PageHeader
        narrow
        kicker={
          <Link href="/blog/" className={styles.back}>
            <span aria-hidden="true">&larr;</span> All posts
          </Link>
        }
        eyebrow={`${formatDate(post.date)} · ${post.author}`}
        title={<EmphasisText text={post.title} />}
        lede={post.summary || undefined}
      >
        {isSample && <SampleChip label="Sample draft" />}
      </PageHeader>

      <div className="container">
        <div className={styles.column}>
          <PostBody markdown={post.body} dropCap={!isSample} />

          <aside className={styles.endCard} aria-label="After the post">
            <p className={styles.endTitle}>
              See something we got <em>wrong</em>?
            </p>
            <p className={styles.endText}>
              Send us corrections, sources we missed or disagreements with how we&rsquo;ve read the evidence.
            </p>
            <div className={styles.endActions}>
              <Link href="/contact/" className="btn btn-primary">
                Get in touch
              </Link>
              <Link href="/blog/" className="btn btn-secondary">
                More posts
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </article>
  );
}
