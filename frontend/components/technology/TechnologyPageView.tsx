import Link from "next/link";
import type { ReactNode } from "react";

import { OpenDetailsOnHash } from "@/components/common/OpenDetailsOnHash";
import { Term } from "@/components/glossary/Term";
import { ClaimList, ClaimText } from "@/components/provenance/ClaimText";
import { DefaultMark } from "@/components/provenance/DefaultMark";
import { MarksHelp } from "@/components/provenance/MarksHelp";
import { ProvenanceGlyph } from "@/components/provenance/ProvenanceTag";
import { buildTimeline, type TimelineItem } from "@/components/timeline/timelineModel";
import { getPublicMilestones, getSiteData, getSources } from "@/lib/data";
import { COMPARE_MINDS_KEY, compareHref, MINDS_ROW_ID, scorecardRowId } from "@/lib/dimensions";
import { enumValues } from "@/lib/enums";
import { realSources, sourceRefsById, sourceRefsByRegisterId, type SourceRef } from "@/lib/sources";
import type { Claim, EvidenceRow, Provenance, ScorecardRow, Stage, TechnologyPage } from "@/lib/types";

import { EmphasisText } from "./EmphasisText";
import { EvidenceRegister } from "./EvidenceRegister";
import { FullAssessment, type AssessmentPart } from "./FullAssessment";
import { MilestoneTable } from "./MilestoneTable";
import { RatingChip } from "./RatingChip";
import { Scorecard, type ScorecardDetailLink } from "./Scorecard";
import {
  AssessmentView,
  CausalChain,
  EvidenceGap,
  MindsGrid,
  problemText,
  ScopeSheet,
  WelfareSheet,
} from "./ScorecardSections";
import { TensionCallout } from "./TensionCallout";
import { nextTechnology, requireTechnology, technologyNumber, type TechnologyId } from "./technologyData";
import { capitalize, countWord, joinList, lowerFirst } from "./text";
import { TocNav, type TocItem } from "./TocNav";
import { WhereWeLand, type MilestoneFacts } from "./WhereWeLand";
import styles from "./TechnologyPageView.module.css";

// One template for all three technology pages:
//   hero (headline, intro, review status, "Where we land")
//   "The tension", only when the team has written it
//   detail sections, in the same order on every page
//   "Full assessment" (or "Full scorecard" when that's all it holds), collapsed
// A section with nothing in content says so in one plain line. Nothing here
// writes research text: every line is a field from content or a count.

type Sources = Record<string, SourceRef>;

interface PageContext {
  technology: TechnologyPage;
  sources: Sources;
  // The same sources keyed by register id ("S02"), for the evidence register.
  sourcesByRegisterId: Sources;
  items: TimelineItem[];
  // The kind most claims on this page have. Claims of this kind show only
  // their glyph. On an AI-drafted page each section says the default once.
  quiet: Provenance;
}

// One in-page section. The side nav and the sections come from the same
// list, so the nav labels always match the headings.
interface SectionSpec {
  id: string;
  label: string; // the nav entry, and the heading's words
  title: ReactNode; // the h2, with its one italic word in <em>
  showsDefault: boolean; // true when the section holds claims
  body: ReactNode;
}

// The scorecard rows whose basis a detail section covers in full. Those rows
// show one sentence and a link. Matched by the row's id, which never changes.
// Until the team writes a welfare assessment, the welfare section shows its
// rows from the scorecard, in this order.
const DIMENSION_SECTIONS: Record<string, "minds" | "welfare"> = {
  [MINDS_ROW_ID]: "minds",
  "human-welfare-risk": "welfare",
  "governance-risk": "welfare",
  "safeguard-adequacy": "welfare",
};

const PLACEHOLDER = {
  claims: "The team hasn't written what this claims to solve yet.",
  mechanism: "The team hasn't written how this would work yet.",
  case: "The team hasn't written the strongest case yet.",
  objections: "The team hasn't written the strongest objections yet.",
  minds: "The team hasn't written about artificial minds for this technology yet.",
  welfare: "The team hasn't assessed welfare and governance risks in detail yet.",
  milestones: "The team hasn't mapped any milestones for this technology yet.",
};

const ALTERNATIVES_NOTE = "From the team's scorecard: the most credible alternatives and counterarguments.";

// The outline fields are optional, so a missing list is an empty one.
function listOf<T>(items: T[] | undefined): T[] {
  return items ?? [];
}

// ---------- Page ----------

export function TechnologyPageView({ id }: { id: TechnologyId }) {
  const technology = requireTechnology(id);
  const number = technologyNumber(id);
  const items = timelineItemsFor(id);
  const sources = sourceRefsById(getSources());
  const sourcesByRegisterId = sourceRefsByRegisterId(getSources());
  const quiet: Provenance = technology.sample === true ? "ai" : "team";
  // A page the team wrote says so once, in its hero chip, so its sections
  // skip the "Our read unless marked" line. An AI-drafted page keeps it on
  // every section, since a deep link can land below the AI draft banner.
  const sectionDefault: Provenance | null = quiet === "team" ? null : quiet;
  const context: PageContext = { technology, sources, sourcesByRegisterId, items, quiet };
  const sections = buildSections(context);
  const next = nextTechnology(id);

  const tocItems: TocItem[] = [];
  for (const section of sections) {
    tocItems.push({ id: section.id, label: section.label });
  }

  return (
    <article>
      <OpenDetailsOnHash />
      <header className={styles.hero}>
        <div className="container">
          <div className={styles.heroPanel}>
            <span className={styles.numeral} aria-hidden="true">
              {number}
            </span>
            <div className={styles.heroMain}>
              <p className="eyebrow">
                Technology {number} · {technology.short_name}
              </p>
              <ReviewStatus sample={technology.sample === true} />
              <h1 className={styles.headline}>
                <EmphasisText text={technology.headline} />
              </h1>
              <div className={styles.intro}>
                <ClaimText claim={technology.intro} sources={sources} quiet={quiet} />
              </div>
            </div>
            <div className={styles.heroSide}>
              <WhereWeLand
                rows={technology.scorecard}
                milestones={milestoneFacts(items)}
                technologyId={id}
                sourceCount={sourceCountFor(id)}
              />
            </div>
          </div>
        </div>
      </header>

      <div className={`container ${styles.body}`}>
        <TocNav items={tocItems} />

        <div className={styles.content}>
          <div className={styles.topNotes}>
            <MarksHelp />
          </div>

          {technology.tension && (
            <div className={styles.tension}>
              <TensionCallout claim={technology.tension} sources={sources} quiet={quiet} />
            </div>
          )}

          {sections.map((section) => (
            <PageSection
              key={section.id}
              id={section.id}
              title={section.title}
              defaultKind={section.showsDefault ? sectionDefault : null}
            >
              {section.body}
            </PageSection>
          ))}

          {next && <NextTechnology next={next} />}
        </div>
      </div>
    </article>
  );
}

function buildSections(context: PageContext): SectionSpec[] {
  return [
    howSection(context),
    caseSection(context),
    mindsSection(context),
    welfareSection(context),
    milestonesSection(context),
    fullAssessmentSection(context),
  ];
}

// ---------- Top layer ----------

// A page the team wrote gets a small chip. An AI-drafted page gets one banner
// here, in place of a "not yet reviewed" label on every paragraph.
function ReviewStatus({ sample }: { sample: boolean }) {
  if (!sample) {
    return (
      <p className={styles.statusChip}>
        <ProvenanceGlyph kind="team" />
        Written by the team
      </p>
    );
  }
  return (
    <div className={styles.sample} role="note" aria-label="About this draft">
      <p className={styles.sampleStamp}>AI draft</p>
      <p className={styles.sampleText}>
        Nobody on the team has reviewed this page yet. An AI model wrote it as an outline for the team to react to,
        so treat every line and every rating as unchecked.
      </p>
    </div>
  );
}

// ---------- Detail sections ----------

// The problem from the team's scope ("Both alignment and the Intelligence
// Curse"), for pages whose claims_to_solve list is still empty.
function scopeProblemClaim(technology: TechnologyPage): Claim | null {
  if (!technology.scope) {
    return null;
  }
  return { text: problemText(technology.scope.problem), provenance: technology.scope.intervention.provenance };
}

function howSection({ technology, sources, quiet }: PageContext): SectionSpec {
  const claims = listOf(technology.claims_to_solve);
  const mechanism = listOf(technology.mechanism);
  const steps = listOf(technology.theory_of_change);
  const scopeProblem = claims.length === 0 ? scopeProblemClaim(technology) : null;
  // Without its own claims the left column holds one line from the scope, or
  // a placeholder, beside a much taller mechanism, so the two stack instead.
  const leftIsShort = claims.length === 0;

  return {
    id: "how",
    label: "How it would work",
    title: (
      <>
        How it would <em>work</em>
      </>
    ),
    showsDefault: claims.length > 0 || mechanism.length > 0 || steps.length > 0 || scopeProblem !== null,
    body: (
      <div className={`${styles.howGrid} ${leftIsShort ? styles.howStacked : ""}`}>
        <div className={styles.subsection}>
          <h3 className={styles.subsectionTitle}>What it claims to solve</h3>
          {claims.length > 0 && <ClaimList claims={claims} sources={sources} quiet={quiet} />}
          {scopeProblem && (
            <>
              <p className={styles.fromScope}>From the team&rsquo;s scope</p>
              <ClaimText claim={scopeProblem} quiet={quiet} />
            </>
          )}
          {claims.length === 0 && !scopeProblem && <Placeholder text={PLACEHOLDER.claims} />}
        </div>

        <div className={styles.stack}>
          {mechanism.length > 0 && (
            <div className={styles.subsection}>
              <h3 className={styles.subsectionTitle}>The mechanism</h3>
              <ClaimList claims={mechanism} sources={sources} quiet={quiet} />
            </div>
          )}

          {steps.length > 0 && (
            <div className={styles.subsection}>
              <h3 className={styles.subsectionTitle}>The steps it depends on, in order</h3>
              <CausalChain steps={steps} sources={sources} quiet={quiet} />
            </div>
          )}

          {mechanism.length === 0 && steps.length === 0 && (
            <div className={styles.subsection}>
              <h3 className={styles.subsectionTitle}>The mechanism</h3>
              <Placeholder text={PLACEHOLDER.mechanism} />
            </div>
          )}
        </div>
      </div>
    ),
  };
}

function caseSection({ technology, sources, quiet }: PageContext): SectionSpec {
  const forClaims = listOf(technology.strongest_case);
  let againstClaims = listOf(technology.strongest_objections);
  let againstNote: string | undefined;
  // Until the team writes its strongest objections, the scorecard's own
  // alternatives and counterarguments stand in, labeled as such.
  if (againstClaims.length === 0 && listOf(technology.alternatives).length > 0) {
    againstClaims = listOf(technology.alternatives);
    againstNote = ALTERNATIVES_NOTE;
  }
  // A side that is only a placeholder would leave a tall empty column beside
  // the other one, so the two cards stack instead.
  const oneSided = forClaims.length === 0 || againstClaims.length === 0;

  return {
    id: "case",
    label: "Strongest case and objections",
    title: (
      <>
        Strongest case and <em>objections</em>
      </>
    ),
    showsDefault: forClaims.length > 0 || againstClaims.length > 0,
    body: (
      <div className={`${styles.debate} ${oneSided ? styles.debateStacked : ""}`}>
        <ArgumentColumn
          tone="for"
          label="For"
          title={
            <>
              The strongest <em>case</em>
            </>
          }
          claims={forClaims}
          placeholder={PLACEHOLDER.case}
          sources={sources}
          quiet={quiet}
        />
        <ArgumentColumn
          tone="against"
          label="Against"
          title={
            <>
              The strongest <em>objections</em>
            </>
          }
          claims={againstClaims}
          placeholder={PLACEHOLDER.objections}
          note={againstNote}
          sources={sources}
          quiet={quiet}
        />
      </div>
    ),
  };
}

function mindsSection({ technology, sources, quiet }: PageContext): SectionSpec {
  const minds = technology.artificial_minds_assessment;
  const questions = listOf(technology.artificial_minds_questions);
  const hasContent = Boolean(minds) || questions.length > 0;
  return {
    id: "minds",
    label: "Artificial minds",
    title: (
      <>
        Artificial <em>minds</em>
      </>
    ),
    showsDefault: hasContent,
    body: (
      <div className={styles.stack}>
        {minds && <MindsGrid minds={minds} sources={sources} quiet={quiet} />}
        {questions.length > 0 && (
          <div className={`measure ${styles.subsection}`}>
            <h3 className={styles.subsectionTitle}>{minds ? "Other open questions" : "Open questions"}</h3>
            <ClaimList claims={questions} sources={sources} quiet={quiet} />
          </div>
        )}
        {!hasContent && <Placeholder text={PLACEHOLDER.minds} />}
        {/* The same questions for all three technologies, on the compare page */}
        {hasContent && (
          <p className={styles.compareLine}>
            <Link href={compareHref(COMPARE_MINDS_KEY)}>
              Compare side by side<span className="visually-hidden">: Artificial minds</span>
              <span aria-hidden="true"> &rarr;</span>
            </Link>
          </p>
        )}
      </div>
    ),
  };
}

function welfareSection({ technology, sources, quiet }: PageContext): SectionSpec {
  const welfare = technology.welfare_governance;
  // Without the team's own assessment, the scorecard's welfare rows stand in.
  const scorecardRows = welfare ? [] : welfareScorecardRows(technology);

  let body: ReactNode;
  if (welfare) {
    body = <WelfareSheet welfare={welfare} shortName={technology.short_name} sources={sources} quiet={quiet} />;
  } else if (scorecardRows.length > 0) {
    body = <WelfareFromScorecard rows={scorecardRows} sources={sources} quiet={quiet} />;
  } else {
    body = (
      <p className={`measure ${styles.placeholderBlock}`}>
        {PLACEHOLDER.welfare} The current risk ratings are in the <a href="#scorecard">full scorecard</a>.
      </p>
    );
  }

  return {
    id: "welfare",
    label: "Welfare and governance risks",
    title: (
      <>
        Welfare and governance <em>risks</em>
      </>
    ),
    showsDefault: Boolean(welfare) || scorecardRows.length > 0,
    body,
  };
}

// The scorecard rows DIMENSION_SECTIONS sends to the welfare section ("Human
// welfare risk", "Governance risk", "Safeguard adequacy"), in that order.
function welfareScorecardRows(technology: TechnologyPage): ScorecardRow[] {
  const rows: ScorecardRow[] = [];
  for (const [rowId, section] of Object.entries(DIMENSION_SECTIONS)) {
    if (section !== "welfare") {
      continue;
    }
    const row = scorecardRowFor(technology.scorecard, rowId);
    if (row) {
      rows.push(row);
    }
  }
  return rows;
}

function scorecardRowFor(rows: ScorecardRow[], rowId: string): ScorecardRow | null {
  for (const row of rows) {
    if (row.id === rowId) {
      return row;
    }
  }
  return null;
}

// The welfare section before the team has assessed these risks: each
// scorecard row with its rating and its basis in full. The scorecard then
// keeps one sentence of each basis and links here. These rows have no ids:
// the rating cards in the full scorecard are the only #scorecard-<id> targets.
function WelfareFromScorecard({ rows, sources, quiet }: { rows: ScorecardRow[]; sources: Sources; quiet: Provenance }) {
  return (
    <div>
      <p className={`measure ${styles.sectionNote}`}>
        From the <a href="#scorecard">scorecard</a>. The team hasn&rsquo;t assessed these risks in detail yet.
      </p>
      <div className={styles.riskRows}>
        {rows.map((row) => (
          <div key={row.id} className={styles.riskRow}>
            <h3 className={styles.riskTitle}>{row.dimension}</h3>
            <div className={styles.riskRating}>
              <RatingChip
                scale={row.scale}
                rating={row.rating}
                unclearReason={row.unclear_reason}
                potentialSeverity={row.scale === "risk" ? row.potential_severity : null}
              />
            </div>
            <div className={styles.riskBasis}>
              <ClaimText claim={row.basis} sources={sources} quiet={quiet} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function milestonesSection({ items }: PageContext): SectionSpec {
  return {
    id: "milestones",
    label: "Milestones",
    title: (
      <>
        <em>Milestones</em>
      </>
    ),
    showsDefault: false,
    body:
      items.length === 0 ? (
        <Placeholder text={PLACEHOLDER.milestones} />
      ) : (
        <>
          <p className={`measure ${styles.sectionNote}`}>
            {milestonesNote(items)}{" "}
            <Link href="/methodology/#stages">
              What the stages mean<span aria-hidden="true"> &rarr;</span>
            </Link>
          </p>
          <MilestoneTable items={items} />
        </>
      ),
  };
}

// "None of the 8 has a date yet, and nothing is mapped at the “Actually
// helping” stage. Each row opens the milestone on the timeline." The quotes
// mark the stage's name, which keeps the capitals it has on the badges.
function milestonesNote(items: TimelineItem[]): string {
  const facts = milestoneFacts(items);
  let dated: string;
  if (facts.dated === 0) {
    dated = `None of the ${facts.count} has a date yet`;
  } else if (facts.dated === facts.count) {
    dated = facts.count === 1 ? "It has a date or an estimate" : `All ${facts.count} have a date or an estimate`;
  } else {
    dated = `${capitalize(countWord(facts.dated))} of the ${facts.count} have a date or an estimate`;
  }

  const emptyStages: string[] = [];
  for (const label of stagesWithoutMilestones(items)) {
    emptyStages.push(`“${label}”`);
  }
  let gap = "";
  if (emptyStages.length > 0) {
    gap = `, and nothing is mapped at the ${joinList(emptyStages)} stage${emptyStages.length > 1 ? "s" : ""}`;
  }
  return `${dated}${gap}. Each row opens the milestone on the timeline.`;
}

function stagesWithoutMilestones(items: TimelineItem[]): string[] {
  const empty: string[] = [];
  for (const info of enumValues("Stage")) {
    let found = false;
    for (const item of items) {
      if (item.milestone.stage === (info.value as Stage)) {
        found = true;
      }
    }
    if (!found) {
      empty.push(info.label);
    }
  }
  return empty;
}

function fullAssessmentSection(context: PageContext): SectionSpec {
  const parts = assessmentParts(context);
  // When the scorecard is the one part, the section is named for it, and the
  // contents line doesn't repeat the word.
  const onlyScorecard = parts.length === 1 && parts[0].id === "scorecard";
  if (onlyScorecard) {
    parts[0] = { ...parts[0], summary: "the basis for each rating" };
  }
  // The default note sits inside the collapsed part, next to the claims. A
  // page the team wrote skips it, as its sections do.
  const top = context.quiet === "team" ? undefined : <DefaultMark kind={context.quiet} />;
  return {
    id: "full-assessment",
    label: onlyScorecard ? "Full scorecard" : "Full assessment",
    title: onlyScorecard ? (
      <>
        Full <em>scorecard</em>
      </>
    ) : (
      <>
        Full <em>assessment</em>
      </>
    ),
    showsDefault: false,
    body: <FullAssessment parts={parts} label={onlyScorecard ? "scorecard" : "assessment"} top={top} />,
  };
}

// The parts of the collapsed Full assessment, the scorecard first.
function assessmentParts(context: PageContext): AssessmentPart[] {
  const { technology, sources, sourcesByRegisterId, quiet } = context;
  const parts: AssessmentPart[] = [];

  if (technology.scope) {
    parts.push({
      id: "scope",
      title: "Scope",
      summary: "the scope",
      body: <ScopeSheet scope={technology.scope} shortName={technology.short_name} sources={sources} quiet={quiet} />,
    });
  }

  const register = listOf(technology.evidence_register);
  if (register.length > 0) {
    parts.push({
      id: "evidence",
      title: "Evidence register",
      summary: "the evidence register",
      body: (
        <>
          <p className={`measure ${styles.sectionNote}`}>
            Each row is one claim, with the sources for and against it, the kind of evidence, its{" "}
            <Term name="directness">directness</Term>, its main limitation and the sources&rsquo;{" "}
            <Term name="independence">independence</Term>.
          </p>
          <EvidenceRegister
            rows={register}
            technologyName={technology.name}
            shortName={technology.short_name}
            sourcesByRegisterId={sourcesByRegisterId}
            quiet={quiet}
          />
        </>
      ),
    });
  }

  const comparatorDefinition = technology.scope
    ? `The alternative a proposal is measured against. Here: ${lowerFirst(technology.scope.comparator.text)}`
    : undefined;

  if (technology.alignment_assessment) {
    const why = whyLink(technology.scorecard, "alignment");
    parts.push({
      id: "alignment",
      title: "The alignment case",
      summary: "the alignment questions",
      body: (
        <AssessmentView
          assessment={technology.alignment_assessment}
          mechanismLabel="The alignment problem it targets"
          sources={sources}
          quiet={quiet}
          whyHref={why.href}
          whyLabel={why.label}
          comparatorDefinition={comparatorDefinition}
        />
      ),
    });
  }

  if (technology.intelligence_curse_assessment) {
    const why = whyLink(technology.scorecard, "intelligence_curse");
    parts.push({
      id: "intelligence-curse",
      title: "The Intelligence Curse case",
      summary: "the Intelligence Curse questions",
      body: (
        <AssessmentView
          assessment={technology.intelligence_curse_assessment}
          mechanismLabel="The mechanism it claims"
          sources={sources}
          quiet={quiet}
          whyHref={why.href}
          whyLabel={why.label}
          // Defined once per page, on the alignment questions when they exist.
          comparatorDefinition={technology.alignment_assessment ? undefined : comparatorDefinition}
        />
      ),
    });
  }

  // The rating cards are h4 under the part's own h3, "Full scorecard". When
  // the scorecard is the only part, the section's h2 is "Full scorecard" and
  // the cards are h3. Each card shows the register lines that name its row.
  parts.unshift(scorecardPart(context, register, parts.length > 0 ? 4 : 3));
  return parts;
}

function scorecardPart(
  { technology, sources, sourcesByRegisterId, items, quiet }: PageContext,
  register: EvidenceRow[],
  headingLevel: 3 | 4,
): AssessmentPart {
  return {
    id: "scorecard",
    title: "Full scorecard",
    summary: "the full scorecard with the basis for each rating",
    body: (
      <>
        <Scorecard
          rows={technology.scorecard}
          technologyName={technology.name}
          shortName={technology.short_name}
          headingLevel={headingLevel}
          register={register}
          items={items}
          sources={sources}
          sourcesByRegisterId={sourcesByRegisterId}
          quiet={quiet}
          detailLinks={scorecardDetailLinks(technology)}
        />
        {technology.evidence_gap && <EvidenceGap claim={technology.evidence_gap} sources={sources} quiet={quiet} />}
      </>
    ),
  };
}

// Which scorecard rows point to a detail section, for this page's content.
// Keyed by row id.
function scorecardDetailLinks(technology: TechnologyPage): Record<string, ScorecardDetailLink> {
  const links: Record<string, ScorecardDetailLink> = {};
  for (const row of technology.scorecard) {
    const section = DIMENSION_SECTIONS[row.id];
    if (section === "minds" && technology.artificial_minds_assessment) {
      links[row.id] = { href: "#minds", label: "Artificial minds" };
    }
    // The welfare section always covers these rows: with the team's welfare
    // sheet, or, without one, with the row's own basis in full.
    if (section === "welfare") {
      links[row.id] = { href: "#welfare", label: "Welfare and governance risks" };
    }
  }
  return links;
}

// The case row for one problem, whose card holds the reason for that rating.
function whyLink(rows: ScorecardRow[], problem: "alignment" | "intelligence_curse"): { href: string; label: string } {
  for (const row of rows) {
    if (row.scale === "case" && row.problem === problem) {
      return { href: `#${scorecardRowId(row.id)}`, label: `see the ${row.dimension} rating in the scorecard` };
    }
  }
  return { href: "#scorecard", label: "see the scorecard" };
}

// ---------- Milestone data ----------

// This technology's real milestones, built by the same model the timeline
// uses so the codes ("WBE-01") and estimate text match. Samples never show.
function timelineItemsFor(id: TechnologyId): TimelineItem[] {
  const { nowYear } = getSiteData();
  const groups = buildTimeline(getPublicMilestones(), nowYear);
  for (const group of groups) {
    if (group.technology === id) {
      return group.items;
    }
  }
  return [];
}

function milestoneFacts(items: TimelineItem[]): MilestoneFacts {
  let dated = 0;
  for (const item of items) {
    if (item.view.barMode !== "none") {
      dated += 1;
    }
  }
  return { count: items.length, dated, firstId: items.length > 0 ? items[0].milestone.id : null };
}

// ---------- Source data ----------

// How many real sources (no samples) are tagged with this technology.
function sourceCountFor(id: TechnologyId): number {
  let count = 0;
  for (const source of realSources(getSources())) {
    if (source.technology.includes(id)) {
      count += 1;
    }
  }
  return count;
}

// ---------- Building blocks ----------

function PageSection({
  id,
  title,
  defaultKind,
  children,
}: {
  id: string;
  title: ReactNode;
  defaultKind: Provenance | null;
  children: ReactNode;
}) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
      <header className={styles.sectionHeader}>
        <h2 id={`${id}-title`}>{title}</h2>
        {defaultKind && <DefaultMark kind={defaultKind} />}
      </header>
      {children}
    </section>
  );
}

function Placeholder({ text }: { text: string }) {
  return <p className={styles.placeholder}>{text}</p>;
}

interface ArgumentColumnProps {
  tone: "for" | "against";
  label: string;
  title: ReactNode;
  claims: Claim[];
  placeholder: string;
  note?: string;
  sources: Sources;
  quiet: Provenance;
}

// One side of the argument, set as numbered pull quotes on a paper card.
function ArgumentColumn({ tone, label, title, claims, placeholder, note, sources, quiet }: ArgumentColumnProps) {
  const toneClass = tone === "for" ? styles.columnFor : styles.columnAgainst;
  return (
    <div className={`paper ${styles.column} ${toneClass}`}>
      <p className={styles.columnLabel}>{label}</p>
      <h3 className={styles.columnTitle}>{title}</h3>
      {note && <p className={styles.columnNote}>{note}</p>}
      {claims.length === 0 ? (
        <Placeholder text={placeholder} />
      ) : (
        <ol className={styles.pullList}>
          {claims.map((claim, index) => (
            <li key={index} className={styles.pullItem}>
              <span className={styles.pullIndex}>{String(index + 1).padStart(2, "0")}</span>
              <div className={styles.pullClaim}>
                <ClaimText claim={claim} sources={sources} quiet={quiet} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function NextTechnology({ next }: { next: TechnologyPage }) {
  return (
    <Link href={`/${next.id}/`} className={styles.next}>
      <span className="eyebrow">Next · Technology {technologyNumber(next.id)}</span>
      <span className={styles.nextName}>{next.name}</span>
      <span className={styles.nextHeadline}>
        <EmphasisText text={next.headline} />
      </span>
      <span className={styles.nextArrow} aria-hidden="true">
        &rarr;
      </span>
    </Link>
  );
}
