import Link from "next/link";
import { Fragment } from "react";

import { CodeText } from "@/components/common/CodeText";
import { formatDate } from "@/components/common/format";
import { SampleChip } from "@/components/common/Marks";
import { TypeMark } from "@/components/common/TypeMark";
import { ClaimText } from "@/components/provenance/ClaimText";
import { ProvenanceGlyph } from "@/components/provenance/ProvenanceTag";
import type { TimelineItem } from "@/components/timeline/timelineModel";
import { entryHref, type CodeIndex } from "@/lib/codes";
import { compareHref, scorecardRowId } from "@/lib/dimensions";
import { enumLabel, milestoneTypeOf } from "@/lib/enums";
import type { SourceRef } from "@/lib/sources";
import type { Claim, EvidenceEntry, Family, Provenance, RatingChange, ScorecardData, ScorecardRow } from "@/lib/types";

import {
  cardKind,
  changeValues,
  hasTrackerContent,
  isNotAssessed,
  linkedMilestones,
  newestFirst,
  notYetAssessed,
  riskCount,
  riskDomainFor,
  riskLinkText,
  rowEvidence,
  scaleLabel,
  type ChangeValue,
  type RowEvidence,
} from "./ratingCardModel";
// Only a type, so it adds no runtime import of Scorecard.tsx, which renders these cards.
import type { ScorecardDetailLink } from "./Scorecard";
import { riskDomainAnchor } from "./sections/pageModel";
// The same claim block as the workbook sections and the compare page, so the
// Why reads the same everywhere. Its only stylesheet (Provenance.module.css)
// is already loaded through ClaimText above, so the build's CSS order (see
// the note further down) stays as it was.
import { WorkbookClaim } from "./sections/WorkbookClaim";
import { joinList } from "./text";
import styles from "./RatingCard.module.css";
// RatingFacts and RatingChip come after this card's styles on purpose. Import
// order decides how `next build` groups the site's CSS into files. With
// RatingFacts earlier, the home page's styles (app/page.module.css) were put
// in the file every page loads, ahead of globals.css, so global rules
// overrode them. Check the home page in a production build before moving
// these lines.
import { RatingFacts } from "./RatingFacts";
import { NeutralChip } from "./RatingChip";

type Sources = Record<string, SourceRef>;
type HeadingLevel = 3 | 4;

interface RatingCardListProps {
  rows: ScorecardRow[];
  technologyName: string;
  // h4 under the "Full scorecard" h3, or h3 when the scorecard is the only
  // part and the section's own h2 is "Full scorecard".
  headingLevel: HeadingLevel;
  // This technology's public milestones, for the ones a rating informs.
  items: TimelineItem[];
  // Keyed by source id, for the claims' citations.
  sources: Sources;
  // The page's default provenance; claims of this kind show only their glyph.
  quiet?: Provenance;
  // Keyed by row id: the section that covers the row in full. The card
  // links there: the safeguard card in place of a Why, a risk card when its
  // domain has no risks to link to.
  detailLinks: Record<string, ScorecardDetailLink>;
  // The page's family and the workbook's tables, for each card's evidence
  // and risks. With no family, the cards show neither.
  family: Family | null;
  scorecard: ScorecardData;
  // Where the workbook's codes link (buildCodeIndex).
  codeIndex: CodeIndex;
}

// The scorecard as one card per rating, in content order. The list has the
// old table's caption as its name, so screen readers hear "Scorecard for
// Whole brain emulation, list, 6 items". The explicit role="list" keeps that
// in Safari, which drops the role of a list drawn without markers; the lists
// inside a card carry it for the same reason.
export function RatingCardList({
  rows,
  technologyName,
  headingLevel,
  items,
  sources,
  quiet,
  detailLinks,
  family,
  scorecard,
  codeIndex,
}: RatingCardListProps) {
  return (
    <ol className={styles.list} role="list" aria-label={`Scorecard for ${technologyName}`}>
      {rows.map((row) => (
        <li key={row.id} className={styles.item}>
          <RatingCard
            row={row}
            headingLevel={headingLevel}
            milestones={linkedMilestones(row, items)}
            sources={sources}
            quiet={quiet}
            detailLink={detailLinks[row.id]}
            family={family}
            scorecard={scorecard}
            codeIndex={codeIndex}
          />
        </li>
      ))}
    </ol>
  );
}

interface RatingCardProps {
  row: ScorecardRow;
  headingLevel: HeadingLevel;
  milestones: TimelineItem[]; // the milestones this rating informs
  sources: Sources;
  quiet?: Provenance;
  detailLink?: ScorecardDetailLink;
  family: Family | null;
  scorecard: ScorecardData;
  codeIndex: CodeIndex;
}

// One rating. A case card: the rating and how confident we are, why it has
// that rating, and the register entries that feed it. A risk card: severity,
// likelihood and confidence, then a link to its domain's risks. The
// safeguard card: its rating and confidence, and a link to the section that
// covers it. The meanings of the ratings and confidences are in the
// scorecard's grading key, once. The team's tracker follows when it has
// anything in it. The card is the row's link target, #scorecard-<id>, which
// the hero, the assessments and the compare page all point to.
export function RatingCard({
  row,
  headingLevel,
  milestones,
  sources,
  quiet,
  detailLink,
  family,
  scorecard,
  codeIndex,
}: RatingCardProps) {
  const id = scorecardRowId(row.id);
  const titleId = `${id}-title`;
  const Heading = headingLevel === 4 ? "h4" : "h3";
  const kind = cardKind(row);
  const evidence = family !== null && kind === "case" ? rowEvidence(scorecard, family, row) : null;

  return (
    <article id={id} className={styles.card} aria-labelledby={titleId}>
      <header className={styles.head}>
        <Heading id={titleId} className={styles.name}>
          {row.dimension}
        </Heading>
        <p className={styles.scale}>{scaleLabel(row)}</p>
      </header>

      <RatingFacts row={row} className={styles.rail} />

      <div className={styles.main}>
        {kind === "risk" && <RiskLine row={row} family={family} scorecard={scorecard} detailLink={detailLink} />}
        {/* The safeguard card has no Why: the section it links to gives
            the reasons. */}
        {kind === "safeguard" && detailLink && (
          <p className={styles.riskLine}>
            <a href={detailLink.href}>More in {detailLink.label}</a>
          </p>
        )}
        {kind === "case" && (
          <dl className={styles.why}>
            <dt className={styles.label}>Why</dt>
            <dd>
              {row.basis && (
                <WorkbookClaim
                  claim={row.basis}
                  index={codeIndex}
                  family={family}
                  sources={sources}
                  variant="compact"
                  quiet={quiet}
                />
              )}
              {detailLink && (
                <a href={detailLink.href} className={styles.detailLink}>
                  More in {detailLink.label}
                </a>
              )}
            </dd>
          </dl>
        )}

        {evidence && family !== null && (
          <EvidenceFold
            id={`${id}-evidence`}
            evidence={evidence}
            headingLevel={headingLevel}
            family={family}
            codeIndex={codeIndex}
          />
        )}

        {hasTrackerContent(row, milestones) && (
          <Tracker row={row} milestones={milestones} sources={sources} quiet={quiet} />
        )}

        {/* The aria-label gives screen readers the full name, for example
            "Compare side by side: Alignment case". A visually-hidden span would
            not work here: its absolute positioning makes the browser add a
            space, giving "side by side : Alignment case". */}
        <p className={styles.compareLine}>
          <Link href={compareHref(row.id)} aria-label={`Compare side by side: ${row.dimension}`}>
            Compare side by side
          </Link>
        </p>
      </div>
    </article>
  );
}

interface RiskLineProps {
  row: ScorecardRow;
  family: Family | null;
  scorecard: ScorecardData;
  detailLink?: ScorecardDetailLink;
}

// A risk card's main column: a link to the row's domain in "Welfare and
// governance risks", saying how many of the page's risks it lists. The count
// says nothing about how the severity was judged: the workbook judges each
// domain on its own. With no risks in the domain, the detail link (if any)
// stands alone.
function RiskLine({ row, family, scorecard, detailLink }: RiskLineProps) {
  const count = family === null ? 0 : riskCount(scorecard, family, row);
  const domain = riskDomainFor(row);
  if (count > 0 && domain !== null) {
    return (
      <p className={styles.riskLine}>
        <a href={`#${riskDomainAnchor(domain)}`}>{riskLinkText(count, row)}</a>
      </p>
    );
  }
  if (detailLink) {
    return (
      <p className={styles.riskLine}>
        <a href={detailLink.href}>More in {detailLink.label}</a>
      </p>
    );
  }
  return null;
}

interface EvidenceFoldProps {
  id: string;
  evidence: RowEvidence;
  headingLevel: HeadingLevel;
  family: Family;
  codeIndex: CodeIndex;
}

// The register entries whose "Ratings it feeds" names this rating, folded.
// The summary counts them in the register's own words; inside, one group per
// direction, headed as column G words it. Each line: the entry id (to its
// row in the register), the claim, how it is based and its source. The
// group is the only sign of direction, so lines carry no role chip.
function EvidenceFold({ id, evidence, headingLevel, family, codeIndex }: EvidenceFoldProps) {
  const GroupHeading = headingLevel === 4 ? "h5" : "h4";
  return (
    <details id={id} className={styles.evidenceFold}>
      <summary className={styles.evidenceSummary}>
        <span className={styles.evidenceLabel}>Evidence</span>
        <span className="visually-hidden">: </span>
        <span className={styles.evidenceCounts}>
          {evidence.groups.map((group, index) => (
            <Fragment key={group.heading}>
              {/* The dot is for the eye; screen readers hear a comma. */}
              {index > 0 && (
                <>
                  <span className={styles.evidenceDot} aria-hidden="true">
                    ·
                  </span>
                  <span className="visually-hidden">, </span>
                </>
              )}
              <span className={styles.evidenceCount}>{group.count}</span>
            </Fragment>
          ))}
        </span>
        <span className={styles.chevron} aria-hidden="true" />
      </summary>
      <div className={styles.evidenceBody}>
        {evidence.groups.map((group) => (
          <div key={group.heading}>
            <GroupHeading className={styles.groupHeading}>{group.heading}</GroupHeading>
            <ul className={styles.entryList} role="list">
              {group.entries.map((entry) => (
                <EntryLine key={entry.id} entry={entry} family={family} codeIndex={codeIndex} />
              ))}
            </ul>
          </div>
        ))}
        <p className={styles.allEntries}>
          <Link href={evidence.href}>
            All {evidence.total} entries<span aria-hidden="true"> &rarr;</span>
          </Link>
        </p>
      </div>
    </details>
  );
}

// "E037  The claim, word for word.  [Argued]  S13". The source id links bare,
// with its short citation as its title and accessible name (CodeText).
function EntryLine({ entry, family, codeIndex }: { entry: EvidenceEntry; family: Family; codeIndex: CodeIndex }) {
  return (
    <li className={styles.entry}>
      <Link href={entryHref(entry.id)} className={styles.entryId}>
        {entry.id}
      </Link>
      <div className={styles.entryText}>
        <p className={styles.entryClaim}>
          <CodeText text={entry.claim} index={codeIndex} family={family} />
        </p>
        <p className={styles.entryMeta}>
          <NeutralChip label={enumLabel("EvidenceBasis", entry.basis)} />
          <span className={styles.entrySource}>
            <CodeText text={entry.register_id} index={codeIndex} family={family} />
          </span>
        </p>
      </div>
    </li>
  );
}

interface TrackerProps {
  row: ScorecardRow;
  milestones: TimelineItem[];
  sources: Sources;
  quiet?: Provenance;
}

// Everything the team's tracker adds to the row. A field shows only when it
// has content; the rest are named once in the "Not added yet" line. While
// the tracker is a placeholder, all of it sits in one dashed box that says
// so first. The rating, the confidence, the Why and the evidence stay
// outside it: those are real. Only shown when the tracker holds something.
function Tracker({ row, milestones, sources, quiet }: TrackerProps) {
  const tracker = row.tracker;
  let whatWouldChange: Claim | null = null;
  if (tracker?.what_would_change && !isNotAssessed(tracker.what_would_change)) {
    whatWouldChange = tracker.what_would_change;
  }
  const missing = notYetAssessed(row, milestones);
  const hasFields = whatWouldChange !== null || milestones.length > 0;

  const fields = (
    <>
      {hasFields && (
        <dl className={styles.fields}>
          {whatWouldChange && (
            <div>
              <dt className={styles.label}>What would change the assessment</dt>
              <dd>
                <ClaimText claim={whatWouldChange} sources={sources} variant="compact" quiet={quiet} />
              </dd>
            </div>
          )}
          {milestones.length > 0 && (
            <div>
              <dt className={styles.label}>Milestones it informs</dt>
              <dd>
                <ul className={styles.milestoneList} role="list">
                  {milestones.map((item) => (
                    <MilestoneLink key={item.milestone.id} item={item} />
                  ))}
                </ul>
              </dd>
            </div>
          )}
        </dl>
      )}

      {missing.length > 0 && (
        <p className={styles.notAssessed}>
          <span className={styles.notAssessedGlyph}>
            <ProvenanceGlyph kind="unclear" />
          </span>
          <span>
            <span className={styles.notAssessedLabel}>Not added yet:</span> {joinList(missing)}.
          </span>
        </p>
      )}

      <Ledger lastUpdated={tracker?.last_updated ?? null} history={tracker?.history ?? []} sources={sources} quiet={quiet} />
    </>
  );

  if (tracker?.placeholder) {
    return (
      <div className={`${styles.tracker} ${styles.placeholder}`}>
        <p className={styles.placeholderNote}>
          <SampleChip label="Placeholder" />
          <span className="visually-hidden">. </span>
          <span>An example the team hasn&rsquo;t checked yet.</span>
        </p>
        {fields}
      </div>
    );
  }
  return <div className={styles.tracker}>{fields}</div>;
}

// A milestone this rating informs, as one link to its dossier on the timeline.
function MilestoneLink({ item }: { item: TimelineItem }) {
  const type = milestoneTypeOf(item.milestone.category);
  return (
    <li>
      <Link href={`/timeline/#${item.milestone.id}`} className={styles.milestone}>
        <span className={styles.milestoneCode}>{item.code}</span>
        <span className={styles.milestoneName}>{item.milestone.name}</span>
        {type && <TypeMark type={type} className={styles.milestoneType} />}
        <span className={styles.milestoneArrow} aria-hidden="true">
          &rarr;
        </span>
      </Link>
    </li>
  );
}

interface LedgerProps {
  lastUpdated: string | null;
  history: RatingChange[];
  sources: Sources;
  quiet?: Provenance;
}

// The tracker's footer: when the team last looked at this rating, and every
// change it has recorded, newest first. Earlier assessments stay visible.
function Ledger({ lastUpdated, history, sources, quiet }: LedgerProps) {
  return (
    <dl className={styles.ledger}>
      {lastUpdated && (
        <div className={styles.ledgerDate}>
          <dt className={styles.label}>Last updated</dt>
          <dd className={styles.date}>
            <time dateTime={lastUpdated}>{formatDate(lastUpdated)}</time>
          </dd>
        </div>
      )}
      <div className={styles.ledgerHistory}>
        <dt className={styles.label}>History</dt>
        <dd>
          {history.length === 0 ? (
            <p className={styles.empty}>No changes recorded yet.</p>
          ) : (
            <ol className={styles.history} role="list">
              {newestFirst(history).map((entry, index) => (
                <HistoryEntry key={index} entry={entry} sources={sources} quiet={quiet} />
              ))}
            </ol>
          )}
        </dd>
      </div>
    </dl>
  );
}

interface HistoryEntryProps {
  entry: RatingChange;
  sources: Sources;
  quiet?: Provenance;
}

// "3 Dec 2026", then "Rating: Unclear → Weak · Confidence unchanged", then
// the team's note on what changed, with the sources that caused it.
function HistoryEntry({ entry, sources, quiet }: HistoryEntryProps) {
  const values = changeValues(entry);
  return (
    <li className={styles.change}>
      <time dateTime={entry.date} className={styles.changeDate}>
        {formatDate(entry.date)}
      </time>
      <p className={styles.changeValues}>
        {values.map((value, index) => (
          <span key={value.label}>
            {index > 0 && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="visually-hidden">. </span>
              </>
            )}
            <ChangeValueText value={value} />
          </span>
        ))}
      </p>
      <ClaimText claim={entry.note} sources={sources} variant="compact" quiet={quiet} />
    </li>
  );
}

// "Rating: Unclear → Weak", or "Confidence unchanged". The arrow is drawn
// for the eye only; screen readers hear "Unclear to Weak".
function ChangeValueText({ value }: { value: ChangeValue }) {
  if (!value.changed) {
    return <span className={styles.value}>{value.label} unchanged</span>;
  }
  return (
    <span className={`${styles.value} ${styles.valueChanged}`}>
      {value.label}: {value.before}
      <span aria-hidden="true"> &rarr; </span>
      <span className="visually-hidden"> to </span>
      {value.after}
    </span>
  );
}
