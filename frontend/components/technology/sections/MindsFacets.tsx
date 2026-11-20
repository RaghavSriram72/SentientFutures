import { CodeText } from "@/components/common/CodeText";
import type { CodeIndex } from "@/lib/codes";
import type { ArtificialMindsStage, Family } from "@/lib/types";

import { emptyFacetLabels, mindsFacets, stageHeading, stagesWithReferences } from "../mindsParts";
import { idText, registerIdText } from "./pageModel";
import styles from "./Minds.module.css";

interface MindsFacetsProps {
  stages: ArtificialMindsStage[];
  index: CodeIndex;
  family: Family;
  // Site source id -> register id ("s16" -> "S16"), for the Sources column.
  registerIds: Record<string, string | null>;
}

// The workbook's "4.1 Artificial Minds" for one family. One card per facet
// that has text, labelled with the facet's name (mindsParts.ts); inside, each
// stage's cell under that stage's label without its leading number. The
// facets with no text are named once, in one line. A small table then lists
// each stage's sources and evidence entries, under the tab's own headers,
// naming the stages the same way.
export function MindsFacets({ stages, index, family, registerIds }: MindsFacetsProps) {
  const facets = mindsFacets(stages);
  const filled = facets.filter((facet) => facet.statements.length > 0);
  const empty = emptyFacetLabels(facets);
  const referenced = stagesWithReferences(stages);

  return (
    <div className={styles.minds}>
      {filled.length > 0 && (
        <div className={styles.cards}>
          {filled.map((facet) => (
            <div key={facet.key} className={`paper ${styles.card}`}>
              <h3 className={styles.label}>{facet.label}</h3>
              {facet.statements.map((statement) => (
                <div key={statement.stageLabel} className={styles.statement}>
                  <p className={styles.stage}>{statement.heading}</p>
                  <p className={styles.text}>
                    <CodeText text={statement.text} index={index} family={family} />
                  </p>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {empty.length > 0 && <p className={styles.empty}>Not assessed yet: {empty.join("; ")}.</p>}

      {referenced.length > 0 && (
        <div className={styles.refs}>
          <div className={styles.refHead} aria-hidden="true">
            <span>Stage</span>
            <span>Sources</span>
            <span>Evidence entries</span>
          </div>
          <ul className={styles.refList}>
            {referenced.map((stage) => (
              <li key={stage.stage_label} className={styles.refRow}>
                {/* Named the way the cards above name it: the tab's Stage
                    cell without its leading number. */}
                <span className={styles.refStage}>
                  <span className="visually-hidden">Stage: </span>
                  {stageHeading(stage.stage_label)}
                </span>
                <span className={styles.refCell}>
                  <span className={styles.refLabel}>Sources</span>
                  <span>
                    <CodeText text={registerIdText(stage.source_ids ?? [], registerIds)} index={index} family={family} />
                  </span>
                </span>
                <span className={styles.refCell}>
                  <span className={styles.refLabel}>Evidence entries</span>
                  <span>
                    <CodeText text={idText(stage.entries)} index={index} family={family} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// The workbook's judgment for a family whose artificial-mind welfare is "Not
// applicable" (BCI, tab 9), said once in place of empty facet cards.
export function MindsNotApplicable({ dimension, href }: { dimension: string; href: string }) {
  return (
    <dl className={`paper ${styles.notApplicable}`}>
      <dt className={styles.naLabel}>
        <a href={href}>{dimension}</a>
      </dt>
      <dd className={styles.naValue}>Not applicable</dd>
    </dl>
  );
}
