import { ProvenanceGlyph } from "@/components/provenance/ProvenanceTag";
import { enumLabel, RUBRIC_VERSION } from "@/lib/enums";

import styles from "./ReviewQueueMock.module.css";

// MOCK DATA. A made-up candidate showing what the review screen will look like:
// the AI's assessment stays exactly as it was, next to the reviewer's final value.
// Nothing here comes from a real paper or a real model run.

interface AiAssessment {
  value: string;
  justification: string;
  quote: string;
  // Whether code found the quote in the title and abstract.
  quoteFound: boolean;
}

interface ReviewRow {
  field: string;
  ai: AiAssessment;
  final: string;
  reviewerNote?: string;
}

const MOCK_CANDIDATE = {
  title: "Mock candidate: could spiking networks make learned values easier to inspect? (placeholder)",
  authors: ["Example Author", "Another Example"],
  year: 2026,
  identifier: "arXiv 0000.00001",
  foundBy: "arXiv search",
  promptVersion: "triage_v1-mock",
  reviewer: "Sample reviewer",
};

const MOCK_ROWS: ReviewRow[] = [
  {
    field: "Relevant",
    ai: {
      value: "Yes",
      justification: "Proposes brain-inspired learning as a route to more inspectable AI values.",
      quote: "we argue that brain-like value learning may be easier to audit",
      quoteFound: true,
    },
    final: "Yes",
  },
  {
    field: "Kind",
    ai: {
      value: enumLabel("SourceKind", "milestone_evidence"),
      justification: "Reports results from a spiking network experiment.",
      quote: "we report benchmark results on neuromorphic hardware",
      quoteFound: false,
    },
    final: enumLabel("SourceKind", "argument"),
    reviewerNote: "The quote isn't in the abstract. The experiment is a toy example; the paper's point is the argument.",
  },
  {
    field: "Technology",
    ai: {
      value: enumLabel("Technology", "neuromorphic"),
      justification: "The proposal is about brain-inspired network architectures.",
      quote: "spiking neural networks with local learning rules",
      quoteFound: true,
    },
    final: enumLabel("Technology", "neuromorphic"),
  },
  {
    field: "Problem",
    ai: {
      value: enumLabel("Problem", "alignment"),
      justification: "Frames the benefit as making a model's values easier to check.",
      quote: "easier to audit",
      quoteFound: true,
    },
    final: enumLabel("Problem", "alignment"),
  },
];

function countChanged(rows: ReviewRow[]): number {
  let changed = 0;
  for (const row of rows) {
    if (row.final !== row.ai.value) {
      changed += 1;
    }
  }
  return changed;
}

export function ReviewQueueMock() {
  const changed = countChanged(MOCK_ROWS);

  return (
    <section className={`paper ${styles.mock}`} aria-labelledby="review-mock-heading">
      <header className={styles.header}>
        <div className={styles.headerText}>
          <p className="eyebrow">Review queue preview · candidate 1 of 1</p>
          <h2 id="review-mock-heading" className={styles.heading}>
            The AI&rsquo;s read, <em>next to ours</em>
          </h2>
        </div>
        <span className={styles.mockStamp}>Mock data</span>
      </header>

      <div className={styles.candidate}>
        <p className={styles.callLine}>
          Preprint · {MOCK_CANDIDATE.year} · {MOCK_CANDIDATE.identifier} · Found by {MOCK_CANDIDATE.foundBy}
        </p>
        <p className={styles.candidateTitle}>{MOCK_CANDIDATE.title}</p>
        <p className={styles.candidateAuthors}>{MOCK_CANDIDATE.authors.join(", ")}</p>
        <p className={styles.versions}>
          <span className="chip">Prompt {MOCK_CANDIDATE.promptVersion}</span>
          <span className="chip">Rubric v{RUBRIC_VERSION}</span>
        </p>
      </div>

      <table className={styles.table} role="table">
        <caption className="visually-hidden">
          Each field the AI assessed, what it said, and the reviewer&rsquo;s final value
        </caption>
        <thead>
          <tr role="row">
            <th scope="col" role="columnheader">
              Field
            </th>
            <th scope="col" role="columnheader">
              What the AI said
            </th>
            <th scope="col" role="columnheader">
              Final value (human)
            </th>
          </tr>
        </thead>
        <tbody>
          {MOCK_ROWS.map((row) => {
            const isChanged = row.final !== row.ai.value;
            return (
              <tr key={row.field} role="row" className={isChanged ? styles.changedRow : undefined}>
                <th scope="row" role="rowheader" className={styles.fieldCell}>
                  {row.field}
                </th>
                <td role="cell" className={styles.aiCell} data-label="What the AI said">
                  <span className={styles.aiValue}>
                    <ProvenanceGlyph kind="ai" />
                    {row.ai.value}
                  </span>
                  <span className={styles.justification}>{row.ai.justification}</span>
                  <span className={styles.quote}>&ldquo;{row.ai.quote}&rdquo;</span>
                  <QuoteCheck found={row.ai.quoteFound} />
                </td>
                <td role="cell" className={styles.finalCell} data-label="Final value (human)">
                  <span className={styles.finalValue}>{row.final}</span>
                  {isChanged && <span className={styles.changedTag}>Changed</span>}
                  {row.reviewerNote && <span className={styles.reviewerNote}>{row.reviewerNote}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <footer className={styles.footer}>
        <div className={styles.footerMeta}>
          <p className={styles.counter}>
            {changed} of {MOCK_ROWS.length} fields changed
          </p>
          <p className={styles.footerNote}>
            The AI column is stored as its own record and never edited. Your decision is saved next to it, so we can
            count how often people overrule the AI on each field.
          </p>
        </div>
        <div className={styles.actions}>
          <button type="button" className="btn btn-primary" disabled>
            Approve
          </button>
          <button type="button" className="btn btn-secondary" disabled>
            Edit
          </button>
          <button type="button" className={`btn btn-secondary ${styles.reject}`} disabled>
            Reject
          </button>
        </div>
      </footer>
    </section>
  );
}

function QuoteCheck({ found }: { found: boolean }) {
  if (found) {
    return (
      <span className={`${styles.check} ${styles.checkFound}`}>
        <span aria-hidden="true">✓</span> Quote found in abstract
      </span>
    );
  }
  return (
    <span className={`${styles.check} ${styles.checkMissing}`}>
      <span aria-hidden="true">✗</span> Quote not found in abstract
    </span>
  );
}
