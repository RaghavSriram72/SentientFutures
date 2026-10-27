import Link from "next/link";
import Markdown, { type Components } from "react-markdown";

import { ExternalLink } from "@/components/common/ExternalLink";
import { withBase } from "@/lib/paths";

import styles from "./PostBody.module.css";

// Internal links go through next/link so they pick up the base path. Anchors
// and mailto stay plain; everything else is an outside link in a new tab.
const components: Components = {
  a: ({ href, children }) => {
    // A link with nowhere to go is just its text.
    if (!href) {
      return <>{children}</>;
    }
    if (href.startsWith("/")) {
      return <Link href={href}>{children}</Link>;
    }
    if (href.startsWith("#") || href.startsWith("mailto:")) {
      return <a href={href}>{children}</a>;
    }
    return <ExternalLink href={href}>{children}</ExternalLink>;
  },
  // Site images need the base path too; a plain <img> is fine on a static export.
  img: ({ src, alt }) => {
    let resolved = src;
    if (typeof src === "string" && src.startsWith("/")) {
      resolved = withBase(src);
    }
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={resolved} alt={alt ?? ""} loading="lazy" />;
  },
  // The page title is the only h1, so a "# Heading" in a post becomes an h2.
  h1: ({ children }) => <h2>{children}</h2>,
};

interface PostBodyProps {
  markdown: string;
  dropCap?: boolean;
}

// A post's markdown in long-read typography. Raw HTML in the markdown is
// skipped, never rendered.
export function PostBody({ markdown, dropCap = true }: PostBodyProps) {
  return (
    <div className={`${styles.body} ${dropCap ? styles.dropCap : ""}`}>
      <Markdown skipHtml components={components}>
        {markdown}
      </Markdown>
    </div>
  );
}
