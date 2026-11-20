import Link from "next/link";
import type { ReactNode } from "react";

import { OpenDetailsOnHash } from "@/components/common/OpenDetailsOnHash";
import { ClaimList, ClaimText } from "@/components/provenance/ClaimText";
import { DefaultMark } from "@/components/provenance/DefaultMark";
import { MarksHelp, type MarksCodeRanges } from "@/components/provenance/MarksHelp";
import { ProvenanceGlyph } from "@/components/provenance/ProvenanceTag";
import { buildTimeline, type TimelineItem } from "@/components/timeline/timelineModel";
import { buildCodeIndex, pathwayAnchor } from "@/lib/codes";
import { getPublicMilestones, getScorecard, getSiteData, getSources } from "@/lib/data";
import { COMPARE_MINDS_KEY, compareHref, MINDS_ROW_ID, scorecardRowId } from "@/lib/dimensions";
import { realSources, sourceRefsById, type SourceRef } from "@/lib/sources";
import type { Claim, Family, Provenance, ScorecardData, ScorecardRow, TechnologyPage } from "@/lib/types";
import {
  entriesForFamily,
  governanceByStatus,
  governanceStatusCounts,
  linksByScenario,
  milestoneRowsForFamily,
  risksByDomain,
} from "@/lib/workbook";

import { EmphasisText } from "./EmphasisText";
import { EvidenceRegisterLink } from "./EvidenceRegister";
import { FullAssessment, type AssessmentPart } from "./FullAssessment";
import { MilestoneTable } from "./MilestoneTable";
import { Scorecard, type ScorecardDetailLink } from "./Scorecard";
import { AlignmentPart, IntelligenceCursePart, ScopeSheet, WelfareSheet, type WorkbookContext } from "./ScorecardSections";
import { MindsFacets, MindsNotApplicable } from "./sections/MindsFacets";
import fold from "./sections/FoldRow.module.css";
import { familyStages, idRange, milestoneCount, timelineRefByCategory, type TimelineRef } from "./sections/pageModel";
import { Pathways } from "./sections/Pathways";
import { RiskDomains, Safeguards } from "./sections/WelfareRisks";
import { TensionCallout } from "./TensionCallout";
import {
  AI_SECTIONS_NOTE,
  nextTechnology,
  requireTechnology,
  technologyNumber,
  type TechnologyId,
} from "./technologyData";
import { isNotApplicable } from "./text";
import { TocNav, type TocItem } from "./TocNav";
import { WhereWeLand } from "./WhereWeLand";
import styles from "./TechnologyPageView.module.css";

// One template for all three technology pages:
//   hero (headline, intro, review status, "Where we land")
//   "The tension", only when the team has written it
//   detail sections, in the same order on every page
//   "Full assessment", collapsed, with the rating cards
// The team's workbook (content/scorecard.json and the workbook fields of
// technologies.json) comes first in each section. The AI-drafted outline
// fields BCI and neuromorphic AI still have come after it, under their own
// AI mark. Nothing here writes research text: every line is a field from
// content or a count.

type Sources = Record<string, SourceRef>;

interface PageContext {
  technology: TechnologyPage;
  family: Family;
  scorecard: ScorecardData;
  sources: Sources;
  items: TimelineItem[];
  // What the workbook blocks need to link codes and mark provenance.
  workbook: WorkbookContext;
  // The kind most claims on this page have: the team's, on every page. Those
  // claims show only their glyph; the hero chip says it once.
  quiet: Provenance;
}

// One in-page section. The side nav and the sections come from the same
// list, so the nav labels always match the headings.
interface SectionSpec {
  id: string;
  label: string; // the nav entry, and the heading's words
  title: ReactNode; // the h2, with its one italic word in <em>
  // The note under the heading naming the section's default kind, or null.
  // Only a section made wholly of AI drafts has one.
  defaultKind: Provenance | null;
  body: ReactNode;
}

// The scorecard rows the welfare section covers in full. Their rating cards
// show one sentence and a link. Matched by the row's id, which never changes.
const WELFARE_ROW_IDS = ["human-welfare-risk", "governance-risk", "safeguard-adequacy"];
const SAFEGUARD_ROW_ID = "safeguard-adequacy";

const PLACEHOLDER = {
  how: "The team hasn't written how this would work yet.",
  case: "The team hasn't written the strongest case yet.",
  objections: "The team hasn't written the strongest objections yet.",
  minds: "The team hasn't written about artificial minds for this technology yet.",
  welfare: "The team hasn't assessed welfare and governance risks in detail yet.",
  milestones: "The team hasn't mapped any milestones for this technology yet.",
};

const ALTERNATIVES_NOTE = "From an earlier version of this assessment: the most credible alternatives and counterarguments.";

// The outline fields are optional, so a missing list is an empty one.
function listOf<T>(items: T[] | undefined): T[] {
  return items ?? [];
}

// ---------- Page ----------

export function TechnologyPageView({ id }: { id: TechnologyId }) {
  const technology = requireTechnology(id);
  const family: Family = technology.id;
  const number = technologyNumber(id);
  const items = timelineItemsFor(id);
  const scorecard = getScorecard();
  const allSources = getSources();
  const sources = sourceRefsById(allSources);
  const quiet: Provenance = "team";
  const registerIds: Record<string, string | null> = {};
  for (const source of Object.values(sources)) {
    registerIds[source.id] = source.register_id;
  }
  const workbook: WorkbookContext = {
    index: buildCodeIndex(scorecard, Object.values(sources)),
    family,
    sources,
    registerIds,
    quiet,
  };
  const context: PageContext = { technology, family, scorecard, sources, items, workbook, quiet };
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
              <ReviewStatus aiSections={technology.unreviewed_ai_sections === true} />
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
                technologyId={id}
                sourceCount={sourceCountFor(id)}
                milestoneCount={milestoneCount(milestoneRowsForFamily(scorecard, family))}
                entryCount={entriesForFamily(scorecard, family).length}
              />
            </div>
          </div>
        </div>
      </header>

      <div className={`container ${styles.body}`}>
        <TocNav items={tocItems} />

        <div className={styles.content}>
          <div className={styles.topNotes}>
            <MarksHelp codes={codeRanges(scorecard, allSources, family)} />
          </div>

          {technology.tension && (
            <div className={styles.tension}>
              <TensionCallout claim={technology.tension} sources={sources} quiet={quiet} />
            </div>
          )}

          {sections.map((section) => (
            <PageSection key={section.id} id={section.id} title={section.title} defaultKind={section.defaultKind}>
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

// The first and last entry and source codes, and the family's stage codes,
// for the marks help.
function codeRanges(scorecard: ScorecardData, sources: ReturnType<typeof getSources>, family: Family): MarksCodeRanges {
  const entryIds = (scorecard.entries ?? []).map((entry) => entry.id);
  const registerIds: string[] = [];
  for (const source of realSources(sources)) {
    if (source.register_id) {
      registerIds.push(source.register_id);
    }
  }
  return { entries: idRange(entryIds), sources: idRange(registerIds), stages: familyStages(scorecard, family) };
}

// ---------- Top layer ----------

// Every page is the team's, so it carries no mark of its own. A page that
// still has AI-drafted sections says so once, here; each of those sections
// carries its own AI mark. A page with none shows nothing.
function ReviewStatus({ aiSections }: { aiSections: boolean }) {
  if (!aiSections) {
    return null;
  }
  return (
    <div className={styles.status}>
      <p className={styles.statusNote}>
        <ProvenanceGlyph kind="ai" />
        <span>{AI_SECTIONS_NOTE}</span>
      </p>
    </div>
  );
}

// ---------- Detail sections ----------

// The AI-drafted outline fields (BCI and neuromorphic AI), after the team's
// content, under one "AI-suggested, not yet reviewed" note. Each claim keeps
// the AI line style, so nobody mistakes it for the team's work.
function AiBlock({ children }: { children: ReactNode }) {
  return (
    <div className={styles.aiBlock}>
      <DefaultMark kind="ai" />
      {children}
    </div>
  );
}

// True when every claim is an AI draft nobody has checked.
function allUnreviewedAi(claims: Claim[]): boolean {
  return claims.length > 0 && claims.every((claim) => claim.provenance === "ai" && !claim.reviewed_by);
}

function howSection({ technology, scorecard, family, sources, workbook }: PageContext): SectionSpec {
  const pathways = linksByScenario(scorecard, family);
  const claims = listOf(technology.claims_to_solve);
  const mechanism = listOf(technology.mechanism);
  const hasTeam = Boolean(technology.scope) || pathways.length > 0;
  const hasAi = claims.length > 0 || mechanism.length > 0;
  // With one AI list only, it takes the full width instead of half.
  const aiStacked = claims.length === 0 || mechanism.length === 0;
  const claimsList = <ClaimList claims={claims} sources={sources} quiet="ai" />;
  const mechanismList = <ClaimList claims={mechanism} sources={sources} quiet="ai" />;

  return {
    id: "how",
    label: "How it would work",
    title: (
      <>
        How it would <em>work</em>
      </>
    ),
    defaultKind: !hasTeam && allUnreviewedAi([...claims, ...mechanism]) ? "ai" : null,
    body: (
      <div className={styles.stack}>
        {/* The scope card keeps id="scope", the anchor it had in the Full
            assessment, and folds its own cells. */}
        {technology.scope && <ScopeSheet scope={technology.scope} shortName={technology.short_name} context={workbook} />}

        {pathways.length > 0 && (
          <div className={styles.subsection}>
            <h3 className={styles.subsectionTitle}>Theory of change</h3>
            <Pathways pathways={pathways} index={workbook.index} family={family} />
          </div>
        )}

        {/* After the team's content the AI lists are folded, one fold each,
            like the pathways above, so the section stays short. */}
        {hasAi && hasTeam && (
          <AiBlock>
            <div className={fold.list}>
              {claims.length > 0 && (
                <Fold id="claims-to-solve" title="What it claims to solve">
                  {claimsList}
                </Fold>
              )}
              {mechanism.length > 0 && (
                <Fold id="mechanism" title="The mechanism">
                  {mechanismList}
                </Fold>
              )}
            </div>
          </AiBlock>
        )}
        {/* No workbook content: the AI lists are the section, open, under its heading's mark. */}
        {hasAi && !hasTeam && (
          <div className={`${styles.howGrid} ${aiStacked ? styles.howStacked : ""}`}>
            {claims.length > 0 && (
              <div className={styles.subsection}>
                <h3 className={styles.subsectionTitle}>What it claims to solve</h3>
                {claimsList}
              </div>
            )}
            {mechanism.length > 0 && (
              <div className={styles.subsection}>
                <h3 className={styles.subsectionTitle}>The mechanism</h3>
                {mechanismList}
              </div>
            )}
          </div>
        )}

        {!hasTeam && !hasAi && <Placeholder text={PLACEHOLDER.how} />}
      </div>
    ),
  };
}

// One folded block in the look of the pathway and risk rows (FoldRow), with
// no code: a title line that opens into its content. Linkable by its id.
function Fold({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <details id={id} className={fold.row}>
      <summary className={styles.foldSummary}>
        <span className={`${fold.title} ${styles.foldTitle}`}>{title}</span>
        <span className={fold.chevron} aria-hidden="true" />
      </summary>
      <div className={styles.foldBody}>{children}</div>
    </details>
  );
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
  // On BCI and neuromorphic AI both sides are AI drafts: the heading says so
  // once and each claim keeps the AI line style.
  const aiSection = allUnreviewedAi([...forClaims, ...againstClaims]);
  const claimQuiet: Provenance = aiSection ? "ai" : quiet;

  return {
    id: "case",
    label: "Strongest case and objections",
    title: (
      <>
        Strongest case and <em>objections</em>
      </>
    ),
    defaultKind: aiSection ? "ai" : null,
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
          quiet={claimQuiet}
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
          quiet={claimQuiet}
        />
      </div>
    ),
  };
}

function mindsSection({ technology, family, sources, workbook }: PageContext): SectionSpec {
  const stages = technology.artificial_minds_by_stage ?? [];
  const mindsRow = scorecardRowFor(technology.scorecard, MINDS_ROW_ID);
  // BCI: the workbook judges artificial-mind welfare "Not applicable" (tab 9),
  // so the section says that once instead of showing empty facets.
  const notApplicable = mindsRow !== null && isNotApplicable(mindsRow);
  const questions = listOf(technology.artificial_minds_questions);
  const hasTeam = notApplicable || stages.length > 0;
  const hasContent = hasTeam || questions.length > 0;

  return {
    id: "minds",
    label: "Artificial minds",
    title: (
      <>
        Artificial <em>minds</em>
      </>
    ),
    defaultKind: !hasTeam && allUnreviewedAi(questions) ? "ai" : null,
    body: (
      <div className={styles.stack}>
        {notApplicable && mindsRow && (
          <MindsNotApplicable dimension={mindsRow.dimension} href={`#${scorecardRowId(mindsRow.id)}`} />
        )}
        {!notApplicable && stages.length > 0 && (
          <MindsFacets stages={stages} index={workbook.index} family={family} registerIds={workbook.registerIds} />
        )}

        {questions.length > 0 && hasTeam && (
          <AiBlock>
            <div className={`measure ${styles.subsection}`}>
              <h3 className={styles.subsectionTitle}>Other open questions</h3>
              <ClaimList claims={questions} sources={sources} quiet="ai" />
            </div>
          </AiBlock>
        )}
        {questions.length > 0 && !hasTeam && (
          <div className={`measure ${styles.subsection}`}>
            <h3 className={styles.subsectionTitle}>Open questions</h3>
            <ClaimList claims={questions} sources={sources} quiet="ai" />
          </div>
        )}

        {!hasContent && <Placeholder text={PLACEHOLDER.minds} />}
        {/* The same questions for all three technologies, on the compare page.
            The aria-label gives screen readers the full name, "Compare side by
            side: Artificial minds". A visually-hidden span would not work here:
            its absolute positioning makes the browser add a space, giving
            "side by side : Artificial". */}
        {hasContent && (
          <p className={styles.compareLine}>
            <Link href={compareHref(COMPARE_MINDS_KEY)} aria-label="Compare side by side: Artificial minds">
              Compare side by side
              <span aria-hidden="true"> &rarr;</span>
            </Link>
          </p>
        )}
      </div>
    ),
  };
}

function welfareSection({ technology, scorecard, family, workbook }: PageContext): SectionSpec {
  const welfare = technology.welfare_governance;
  const groups = risksByDomain(scorecard, family);
  const anyRisks = groups.some((group) => group.risks.length > 0);
  const governance = governanceByStatus(scorecard, family);
  const safeguardRow = scorecardRowFor(technology.scorecard, SAFEGUARD_ROW_ID);
  const hasContent = Boolean(welfare) || anyRisks || governance.length > 0;

  return {
    id: "welfare",
    label: "Welfare and governance risks",
    title: (
      <>
        Welfare and governance <em>risks</em>
      </>
    ),
    defaultKind: null,
    body: hasContent ? (
      <div className={styles.stack}>
        {welfare && <WelfareSheet welfare={welfare} shortName={technology.short_name} context={workbook} />}
        <RiskDomains groups={groups} rows={technology.scorecard} index={workbook.index} family={family} />
        <Safeguards
          row={safeguardRow}
          groups={governance}
          counts={governanceStatusCounts(scorecard, family)}
          index={workbook.index}
          family={family}
        />
      </div>
    ) : (
      <p className={`measure ${styles.placeholderBlock}`}>
        {PLACEHOLDER.welfare} The current risk ratings are in the <a href="#scorecard">full scorecard</a>.
      </p>
    ),
  };
}

function scorecardRowFor(rows: ScorecardRow[], rowId: string): ScorecardRow | null {
  for (const row of rows) {
    if (row.id === rowId) {
      return row;
    }
  }
  return null;
}

function milestonesSection({ scorecard, family, items, workbook }: PageContext): SectionSpec {
  const rows = milestoneRowsForFamily(scorecard, family);
  const refs: TimelineRef[] = items.map((item) => ({
    id: item.milestone.id,
    code: item.code,
    category: item.milestone.category,
  }));
  return {
    id: "milestones",
    label: "Milestones",
    title: (
      <>
        <em>Milestones</em>
      </>
    ),
    defaultKind: null,
    body:
      rows.length === 0 ? (
        <Placeholder text={PLACEHOLDER.milestones} />
      ) : (
        <MilestoneTable
          rows={rows}
          categories={scorecard.milestone_categories ?? []}
          timeline={timelineRefByCategory(refs)}
          index={workbook.index}
          family={family}
        />
      ),
  };
}

function fullAssessmentSection(context: PageContext): SectionSpec {
  const parts = assessmentParts(context);
  // When the scorecard is the one part, the section is named for it, and the
  // contents line doesn't repeat the word.
  const onlyScorecard = parts.length === 1 && parts[0].id === "scorecard";
  if (onlyScorecard) {
    parts[0] = { ...parts[0], summary: "the basis for each rating" };
  }
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
    defaultKind: null,
    body: <FullAssessment parts={parts} label={onlyScorecard ? "scorecard" : "assessment"} />,
  };
}

// The parts of the collapsed Full assessment, the scorecard first. The scope
// sheet moved up into "How it would work" (it keeps its #scope anchor there),
// so it isn't printed twice.
function assessmentParts(context: PageContext): AssessmentPart[] {
  const { technology, scorecard, family, workbook } = context;
  const parts: AssessmentPart[] = [];

  const entryCount = entriesForFamily(scorecard, family).length;
  if (entryCount > 0) {
    parts.push({
      id: "evidence",
      title: "Evidence register",
      summary: "the evidence register",
      body: <EvidenceRegisterLink family={family} shortName={technology.short_name} count={entryCount} />,
    });
  }

  if (technology.alignment_assessment) {
    const why = whyLink(technology.scorecard, "alignment");
    parts.push({
      id: "alignment",
      title: "The alignment case",
      summary: "the alignment case",
      body: (
        <AlignmentPart
          assessment={technology.alignment_assessment}
          context={workbook}
          pathwayHrefs={pathwayHrefs(scorecard, family)}
          whyHref={why.href}
          whyLabel={why.label}
        />
      ),
    });
  }

  if (technology.intelligence_curse_assessment) {
    const why = whyLink(technology.scorecard, "intelligence_curse");
    parts.push({
      id: "intelligence-curse",
      title: "The Intelligence Curse case",
      summary: "the Intelligence Curse case",
      body: (
        <IntelligenceCursePart
          assessment={technology.intelligence_curse_assessment}
          context={workbook}
          whyHref={why.href}
          whyLabel={why.label}
        />
      ),
    });
  }

  // The rating cards are h4 under the part's own h3, "Full scorecard". When
  // the scorecard is the only part, the section's h2 is "Full scorecard" and
  // the cards are h3.
  parts.unshift(scorecardPart(context, parts.length > 0 ? 4 : 3));
  return parts;
}

// Scenario name -> its pathway fold, for the alignment part's scenario rows.
// Only a name both tabs write the same way gets a link.
function pathwayHrefs(scorecard: ScorecardData, family: Family): Record<string, string> {
  const hrefs: Record<string, string> = {};
  for (const pathway of linksByScenario(scorecard, family)) {
    if (hrefs[pathway.scenario] === undefined) {
      hrefs[pathway.scenario] = `#${pathwayAnchor(pathway.scenarioCode)}`;
    }
  }
  return hrefs;
}

// The cards read their evidence and sources from the workbook themselves.
function scorecardPart({ technology, sources, items, quiet }: PageContext, headingLevel: 3 | 4): AssessmentPart {
  return {
    id: "scorecard",
    title: "Full scorecard",
    summary: "the full scorecard with the basis for each rating",
    body: (
      <Scorecard
        rows={technology.scorecard}
        technologyName={technology.name}
        shortName={technology.short_name}
        headingLevel={headingLevel}
        items={items}
        sources={sources}
        quiet={quiet}
        detailLinks={scorecardDetailLinks(technology)}
      />
    ),
  };
}

// Which scorecard rows point to a detail section. Keyed by row id.
function scorecardDetailLinks(technology: TechnologyPage): Record<string, ScorecardDetailLink> {
  const links: Record<string, ScorecardDetailLink> = {};
  for (const row of technology.scorecard) {
    if (WELFARE_ROW_IDS.includes(row.id)) {
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

// This technology's timeline milestones, built by the same model the timeline
// uses so the codes ("WBE-01") match. Samples never show.
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
