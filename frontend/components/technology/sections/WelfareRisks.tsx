import { CodeText } from "@/components/common/CodeText";
import { governanceAnchor, riskAnchor, type CodeIndex } from "@/lib/codes";
import { enumLabel } from "@/lib/enums";
import type { Family, GovernanceStatus, Risk, ScorecardRow } from "@/lib/types";
import { GOVERNANCE_STATUSES, RISK_ROW_BY_DOMAIN, type GovernanceGroup, type RiskGroup } from "@/lib/workbook";

import { ConfidenceMeter, RatingChip } from "../RatingChip";
import { rowMetaParts } from "../text";
import fold from "./FoldRow.module.css";
import { MetaParts } from "./MetaParts";
import { countList, familyCell, idText, riskDomainAnchor } from "./pageModel";
import styles from "./Welfare.module.css";

interface RiskDomainsProps {
  groups: RiskGroup[];
  rows: ScorecardRow[]; // the page's scorecard, for each domain's severity, likelihood and confidence
  index: CodeIndex;
  family: Family;
}

// The family's risks (tab 7) in the three domains, in the workbook's order.
// Each domain is headed with its severity, likelihood and confidence from
// tab 9 (the scorecard's risk rows), never computed from the risks under it.
// Each risk is a fold that opens to every tab 7 column under its header
// ("Who controls / route to exit" shows as "Who controls it"). Each domain is
// a link target ("risks-governance") for its risk card.
export function RiskDomains({ groups, rows, index, family }: RiskDomainsProps) {
  return (
    <div className={styles.domains}>
      {groups.map((group) => {
        const row = rows.find((item) => item.id === RISK_ROW_BY_DOMAIN[group.domain]);
        const meta = row ? rowMetaParts(row, false) : [];
        return (
          <div key={group.domain} id={riskDomainAnchor(group.domain)} className={styles.domain}>
            {/* The meta line sits under the name, so on a phone it wraps
                by itself and the name stays on its own line. */}
            <h3 className={styles.domainTitle}>
              <span className={styles.domainName}>{enumLabel("RiskDomain", group.domain)}</span>
              {meta.length > 0 && <MetaParts parts={meta} className={styles.domainMeta} />}
            </h3>
            {group.risks.length > 0 && (
              <div className={fold.list}>
                {group.risks.map((risk) => (
                  <RiskRow key={risk.id} risk={risk} index={index} family={family} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RiskRow({ risk, index, family }: { risk: Risk; index: CodeIndex; family: Family }) {
  const scales: { label: string; value: string }[] = [
    { label: "Potential severity", value: enumLabel("Severity", risk.severity) },
    { label: "Likelihood", value: enumLabel("Likelihood", risk.likelihood) },
    { label: "Reversibility", value: enumLabel("RiskLevel", risk.reversibility) },
    { label: "Detectability", value: enumLabel("RiskLevel", risk.detectability) },
    { label: "Confidence", value: enumLabel("Confidence", risk.confidence) },
  ];
  const facts: { label: string; text: string }[] = [
    { label: "Remedies and safeguards", text: risk.remedies },
    { label: "Who controls it", text: risk.control },
    { label: "Who is exposed (scale)", text: risk.exposed },
    { label: "Category", text: risk.category },
    { label: "Family", text: familyCell(risk.families) },
    { label: "Domain", text: enumLabel("RiskDomain", risk.domain) },
    { label: "Evidence entries", text: idText(risk.entries) },
  ];
  return (
    <details id={riskAnchor(risk.id)} className={fold.row}>
      <summary className={`${fold.summary} ${fold.summaryNoTags}`}>
        <span className={fold.id}>{risk.id}</span>
        <span className={fold.main}>
          <span className={fold.title}>{risk.risk}</span>
          <span className={fold.byline}>
            {risk.category} · Severity {enumLabel("Severity", risk.severity).toLowerCase()}
          </span>
        </span>
        <span className={fold.chevron} aria-hidden="true" />
      </summary>
      <div className={fold.body}>
        {/* Remedies first, then the five scales on one wrapping line, then
            the rest of the row, so the long cells don't push the scales down. */}
        <dl className={fold.facts}>
          {facts.slice(0, 2).map((fact) => (
            <Fact key={fact.label} label={fact.label} text={fact.text} index={index} family={family} />
          ))}
        </dl>
        <dl className={styles.scales}>
          {scales.map((scale) => (
            <div key={scale.label} className={styles.scale}>
              <dt className={styles.scaleLabel}>{scale.label}</dt>
              <dd className={styles.scaleValue}>{scale.value}</dd>
            </div>
          ))}
        </dl>
        <dl className={fold.facts}>
          {facts.slice(2).map((fact) => (
            <Fact key={fact.label} label={fact.label} text={fact.text} index={index} family={family} />
          ))}
        </dl>
      </div>
    </details>
  );
}

// One label and value, left out when the sheet's cell is empty.
function Fact({ label, text, index, family }: { label: string; text: string; index: CodeIndex; family: Family }) {
  if (text.trim() === "") {
    return null;
  }
  return (
    <div className={fold.fact}>
      <dt className={fold.factLabel}>{label}</dt>
      <dd className={fold.factValue}>
        <CodeText text={text} index={index} family={family} />
      </dd>
    </div>
  );
}

interface SafeguardsProps {
  row: ScorecardRow | null; // the safeguard-adequacy row
  groups: GovernanceGroup[];
  counts: Partial<Record<GovernanceStatus, number>>;
  index: CodeIndex;
  family: Family;
}

// Tab 9's "Safeguards adequate?" and its confidence, with the family's
// governance checklist (tab 8) under it: one fold whose summary gives the
// count for each status, grouped by status inside. The sheet doesn't tie the
// checklist to the safeguards judgment; they sit together because both are
// about governance, and the counts are only counts.
export function Safeguards({ row, groups, counts, index, family }: SafeguardsProps) {
  const statusCounts = countList(counts, GOVERNANCE_STATUSES);
  if (!row && groups.length === 0) {
    return null;
  }
  return (
    <div className={`paper ${styles.safeguards}`}>
      {row && row.rating && (
        <dl className={styles.safeguardFacts}>
          <div>
            <dt className={styles.smallLabel}>Safeguards adequate?</dt>
            <dd>
              <RatingChip scale="case" rating={row.rating} />
            </dd>
          </div>
          <div>
            <dt className={styles.smallLabel}>Safeguards: confidence</dt>
            <dd>
              <ConfidenceMeter confidence={row.confidence} />
            </dd>
          </div>
        </dl>
      )}

      {groups.length > 0 && (
        <details id="governance" className={styles.checklist}>
          <summary className={styles.checklistSummary}>
            <span className={styles.checklistTitle}>Governance checklist</span>
            <span className={styles.checklistCounts}>
              {statusCounts.map(({ value, count }) => (
                <span key={value} className={`chip ${styles.neutralChip}`}>
                  {count} {enumLabel("GovernanceStatus", value)}
                </span>
              ))}
            </span>
            <span className={styles.chevron} aria-hidden="true" />
          </summary>
          <div className={styles.checklistBody}>
            {groups.map((group) => (
              <div key={group.status} className={styles.statusGroup}>
                <p className={styles.statusLabel}>
                  {enumLabel("GovernanceStatus", group.status)}
                  <span className={styles.statusCount}> · {group.items.length}</span>
                </p>
                <ul className={styles.items}>
                  {group.items.map((item) => (
                    <li key={item.id} id={governanceAnchor(item.id)} className={styles.item}>
                      <span className={styles.itemId}>{item.id}</span>
                      <div className={styles.itemBody}>
                        <p className={styles.question}>{item.question}</p>
                        {item.summary && (
                          <p className={styles.summaryText}>
                            <CodeText text={item.summary} index={index} family={family} />
                          </p>
                        )}
                        {(item.entries ?? []).length > 0 && (
                          <p className={styles.entries}>
                            <span className={styles.smallLabel}>Evidence entries</span>{" "}
                            <CodeText text={idText(item.entries)} index={index} family={family} />
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
