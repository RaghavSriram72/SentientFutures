import { CodeText } from "@/components/common/CodeText";
import { linkAnchor, pathwayAnchor, type CodeIndex } from "@/lib/codes";
import { enumLabel } from "@/lib/enums";
import type { CausalLink, Family } from "@/lib/types";
import { EVIDENCE_STATUSES, outcomeLabels, stepLabel, type Pathway } from "@/lib/workbook";

import { countNoun } from "../text";
import fold from "./FoldRow.module.css";
import { countList, firstOnly, idText } from "./pageModel";
import styles from "./Pathways.module.css";

interface PathwaysProps {
  pathways: Pathway[];
  index: CodeIndex;
  family: Family;
}

// The workbook's "2 Theory of Change" for one family: one fold per scenario,
// in sheet order. Closed, a fold shows the scenario, its code, the outcomes
// its links name (each once; "Both" names the two, via outcomeLabels), how
// many links it has and how many have each evidence status. Open, it lists
// the links in sheet order, each with its step minus the sheet's leading
// number ("1 Capability" shows as "Capability", via stepLabel). Nothing is
// sorted here: the links keep the sheet's order.
export function Pathways({ pathways, index, family }: PathwaysProps) {
  const anchors = firstOnly(pathways.map((pathway) => pathwayAnchor(pathway.scenarioCode)));
  return (
    <div className={`${fold.list} ${styles.list}`}>
      {pathways.map((pathway, position) => (
        <PathwayRow
          key={`${pathway.scenarioCode} ${pathway.scenario}`}
          pathway={pathway}
          anchor={anchors[position]}
          index={index}
          family={family}
        />
      ))}
    </div>
  );
}

function PathwayRow({
  pathway,
  anchor,
  index,
  family,
}: {
  pathway: Pathway;
  anchor: string | undefined;
  index: CodeIndex;
  family: Family;
}) {
  const statuses = countList(pathway.statusCounts, EVIDENCE_STATUSES);
  // With one Outcome value, the summary says it for every link; with more,
  // each link says its own.
  const outcomePerLink = pathway.outcomes.length > 1;
  return (
    <details id={anchor} className={fold.row}>
      <summary className={`${fold.summary} ${fold.summaryTagsBelow}`}>
        <span className={fold.id}>{pathway.scenarioCode}</span>
        <span className={fold.main}>
          <span className={fold.title}>{pathway.scenario}</span>
          <span className={fold.byline}>
            {outcomeLabels(pathway.outcomes).join(" · ")} · {countNoun(pathway.links.length, "causal link", "causal links")}
          </span>
        </span>
        <span className={fold.tags}>
          {statuses.map(({ value, count }) => (
            <span key={value} className="chip">
              {enumLabel("EvidenceStatus", value)}: {count}
            </span>
          ))}
        </span>
        <span className={fold.chevron} aria-hidden="true" />
      </summary>
      <div className={fold.body}>
        <ol className={styles.links}>
          {pathway.links.map((link) => (
            <LinkItem key={link.id} link={link} showOutcome={outcomePerLink} index={index} family={family} />
          ))}
        </ol>
      </div>
    </details>
  );
}

// One causal link: its id, its step, its status, the claim, its entries
// and, inline, the assumption and objection under plain-words versions of
// the sheet's headers.
function LinkItem({
  link,
  showOutcome,
  index,
  family,
}: {
  link: CausalLink;
  showOutcome: boolean;
  index: CodeIndex;
  family: Family;
}) {
  const entryLists: { label: string; ids: string[] }[] = [
    { label: "Supporting entries", ids: link.supporting ?? [] },
    { label: "Contrary entries", ids: link.contrary ?? [] },
    { label: "Qualifying entries", ids: link.qualifying ?? [] },
  ];
  const shownLists = entryLists.filter((list) => list.ids.length > 0);
  return (
    <li id={linkAnchor(link.id)} className={styles.link}>
      <div className={styles.head}>
        <span className={styles.linkId}>{link.id}</span>
        <span className={styles.step}>{stepLabel(link.step)}</span>
        {showOutcome && <span className={styles.outcome}>{outcomeLabels(link.outcome).join(" · ")}</span>}
        <span className={`chip ${styles.status}`}>{enumLabel("EvidenceStatus", link.status)}</span>
      </div>
      <p className={styles.claim}>
        <CodeText text={link.claim} index={index} family={family} />
      </p>
      {(shownLists.length > 0 || link.best_directness) && (
        <dl className={styles.inlineFacts}>
          {shownLists.map((list) => (
            <div key={list.label} className={styles.inlineFact}>
              <dt>{list.label}</dt>
              <dd>
                <CodeText text={idText(list.ids)} index={index} family={family} />
              </dd>
            </div>
          ))}
          {link.best_directness && (
            <div className={styles.inlineFact}>
              <dt>Directness of best evidence</dt>
              <dd>{enumLabel("EvidenceDirectness", link.best_directness)}</dd>
            </div>
          )}
        </dl>
      )}
      {(link.assumption || link.objection) && (
        <dl className={styles.notes}>
          {link.assumption && (
            <div className={styles.note}>
              <dt>Assumption still required</dt>
              <dd>
                <CodeText text={link.assumption} index={index} family={family} />
              </dd>
            </div>
          )}
          {link.objection && (
            <div className={styles.note}>
              <dt>Strongest objection, and whether it&rsquo;s answered</dt>
              <dd>
                <CodeText text={link.objection} index={index} family={family} />
              </dd>
            </div>
          )}
        </dl>
      )}
    </li>
  );
}
