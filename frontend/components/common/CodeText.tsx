import Link from "next/link";
import type { ReactNode } from "react";

import styles from "@/components/provenance/Provenance.module.css";
import { splitCodes, type CodeIndex } from "@/lib/codes";
import type { Family } from "@/lib/types";

interface CodeTextProps {
  text: string;
  // What exists to link to (buildCodeIndex in lib/codes.ts). A code missing
  // from it stays plain text.
  index: CodeIndex;
  // The page the text sits on, so a risk on several pages links to this one.
  family?: Family | null;
  // "workbook": text from the workbook, kept exactly as written. A source id
  //   links bare, with its short citation as the link's title and accessible name.
  // "claim": site-written text. A source id also shows "(Author Year)" after
  //   it, as ClaimText does, except at the ends of a range ("S20-S22"),
  //   where the citation would split the range.
  mode?: "workbook" | "claim";
}

// A string with the workbook's codes turned into links (E037, S13, WBE-O-L1,
// R01, G15, BCI-M1, WBE-O). The words themselves never change: joining the
// parts gives back the text.
export function CodeText({ text, index, family = null, mode = "workbook" }: CodeTextProps) {
  const nodes: ReactNode[] = [];
  splitCodes(text, index, family).forEach((part, position) => {
    if (!part.code || !part.target) {
      nodes.push(part.text);
      return;
    }
    const citation = part.code.kind === "source" ? part.target.title : undefined;
    const expand = mode === "claim" && citation !== undefined && !part.code.inRange;
    nodes.push(
      <Link
        key={position}
        href={part.target.href}
        className={styles.registerLink}
        title={citation && !expand ? citation : undefined}
        aria-label={citation && !expand ? `${part.text} (${citation})` : undefined}
      >
        {part.text}
        {expand && <span className={styles.registerCite}> ({citation})</span>}
      </Link>,
    );
  });
  return <>{nodes}</>;
}
