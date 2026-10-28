import Link from "next/link";
import type { ReactNode } from "react";

import { Term } from "@/components/glossary/Term";
import { ClaimList, ClaimText } from "@/components/provenance/ClaimText";
import { DefaultMark } from "@/components/provenance/DefaultMark";
import { MarksHelp } from "@/components/provenance/MarksHelp";
import { ProvenanceGlyph } from "@/components/provenance/ProvenanceTag";
import { buildTimeline, type TimelineItem } from "@/components/timeline/timelineModel";
import { getPublicMilestones, getSiteData, getSources } from "@/lib/data";
import { enumValues, isDraftEnum } from "@/lib/enums";
import { sourceRefsById, sourceRefsByRegisterId, type SourceRef } from "@/lib/sources";
import type { Claim, Provenance, ScorecardRow, Stage, TechnologyPage } from "@/lib/types";

import { AtAGlance, type GlanceRow } from "./AtAGlance";
import { EmphasisText } from "./EmphasisText";
import { EvidenceRegister } from "./EvidenceRegister";
import { FullAssessment, type AssessmentPart } from "./FullAssessment";
import { MilestoneTable } from "./MilestoneTable";
import { OpenDetailsOnHash } from "./OpenDetailsOnHash";
import { hasSeverityFlag, Scorecard, scorecardRowId, type ScorecardDetailLink } from "./Scorecard";
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
import { capitalize, countWord, joinList, leadSentences, lowerFirst } from "./text";
import { TocNav, type TocItem } from "./TocNav";
import { WhereWeLand, type MilestoneFacts } from "./WhereWeLand";
import styles from "./TechnologyPageView.module.css";

// One template for all three technology pages:
//   hero (headline, intro, review status, "Where we land")
//   "The tension", only when the team has written it
//   "At a glance", one line per part of the argument
//   detail sections, in the same order on every page
//   "Full assessment", collapsed
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
  // their glyph, and each section says the default once.
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
// show one sentence and a link. Matched by the row's dimension name.
const DIMENSION_SECTIONS: Record<string, "minds" | "welfare"> = {
  "Artificial-mind welfare and rights risk": "minds",
  "Human welfare risk": "welfare",
  "Governance risk": "welfare",
  "Safeguard adequacy": "welfare",
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

function firstOf<T>(items: T[] | undefined): T | null {
  const list = listOf(items);
  return list.length > 0 ? list[0] : null;
}

// ---------- Page ----------

export function TechnologyPageView({ id }: { id: TechnologyId }) {
  const technology = requireTechnology(id);
  const number = technologyNumber(id);
  const items = timelineItemsFor(id);
  const sources = sourceRefsById(getSources());
  const sourcesByRegisterId = sourceRefsByRegisterId(getSources());
  const quiet: Provenance = technology.sample === true ? "ai" : "team";
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
              <WhereWeLand rows={technology.scorecard} milestones={milestoneFacts(items)} />
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
              defaultKind={section.showsDefault ? quiet : null}
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
    glanceSection(context),
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

function glanceSection(context: PageContext): SectionSpec {
  return {
    id: "at-a-glance",
    label: "At a glance",
    title: (
      <>
        At a <em>glance</em>
      </>
    ),
    showsDefault: true,
    body: <AtAGlance rows={glanceRows(context)} quiet={context.quiet} />,
  };
}

// Each row is the opening of a claim further down, so At a glance never says
// anything the page doesn't. Fields that are empty fall back to the nearest
// field the team did fill in, or to a placeholder.
function glanceRows({ technology }: PageContext): GlanceRow[] {
  const rows: GlanceRow[] = [];

  const claimsToSolve = firstOf(technology.claims_to_solve);
  rows.push({
    label: "What it claims to solve",
    href: "#how",
    claim: claimsToSolve ? excerpt(claimsToSolve) : scopeProblemClaim(technology),
    placeholder: PLACEHOLDER.claims,
  });

  const mechanism = firstOf(technology.mechanism);
  const alignmentMechanism = technology.alignment_assessment?.mechanism ?? null;
  rows.push({
    label: mechanism || !alignmentMechanism ? "How it would work" : "How it would help alignment",
    href: mechanism ? "#how" : "#alignment",
    claim: mechanism ? excerpt(mechanism) : alignmentMechanism,
    placeholder: PLACEHOLDER.mechanism,
  });

  const strongestCase = firstOf(technology.strongest_case);
  rows.push({
    label: "Strongest case",
    href: "#case",
    claim: strongestCase ? excerpt(strongestCase) : null,
    placeholder: PLACEHOLDER.case,
  });

  const objection = firstOf(technology.strongest_objections);
  const alternative = firstOf(technology.alternatives);
  rows.push({
    label: "Strongest objection",
    href: "#case",
    claim: objection ? excerpt(objection) : alternative ? excerpt(alternative) : null,
    placeholder: PLACEHOLDER.objections,
    note: !objection && alternative ? "From the team's scorecard counterarguments." : undefined,
  });

  const mindsQuestion = firstOf(technology.artificial_minds_questions);
  const consciousness = technology.artificial_minds_assessment?.consciousness ?? null;
  rows.push({
    label: "Artificial minds",
    href: "#minds",
    claim: mindsQuestion ? excerpt(mindsQuestion) : consciousness ? excerpt(consciousness) : null,
    placeholder: PLACEHOLDER.minds,
  });

  const harms = technology.welfare_governance?.harms ?? null;
  const welfareRow = scorecardRowFor(technology.scorecard, "Human welfare risk");
  rows.push({
    label: "Main welfare risks",
    href: harms ? "#welfare" : "#scorecard",
    claim: harms ? excerpt(harms) : welfareRow ? excerpt(welfareRow.basis) : null,
    placeholder: PLACEHOLDER.welfare,
  });

  return rows;
}

// The opening sentence or two of a claim, with its provenance kept.
function excerpt(claim: Claim): Claim {
  return { ...claim, text: leadSentences(claim.text, 60), source_ids: [] };
}

// The problem from the team's scope ("Both alignment and the Intelligence
// Curse"), for pages whose claims_to_solve list is still empty.
function scopeProblemClaim(technology: TechnologyPage): Claim | null {
  if (!technology.scope) {
    return null;
  }
  return { text: problemText(technology.scope.problem), provenance: technology.scope.intervention.provenance };
}

function scorecardRowFor(rows: ScorecardRow[], dimension: string): ScorecardRow | null {
  for (const row of rows) {
    if (row.dimension === dimension) {
      return row;
    }
  }
  return null;
}

// ---------- Detail sections ----------

function howSection({ technology, sources, quiet }: PageContext): SectionSpec {
  const claims = listOf(technology.claims_to_solve);
  const mechanism = listOf(technology.mechanism);
  const steps = listOf(technology.theory_of_change);
  const scopeProblem = claims.length === 0 ? scopeProblemClaim(technology) : null;

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
      <div className={styles.howGrid}>
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
      <div className={styles.debate}>
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
  return {
    id: "minds",
    label: "Artificial minds",
    title: (
      <>
        Artificial <em>minds</em>
      </>
    ),
    showsDefault: Boolean(minds) || questions.length > 0,
    body: (
      <div className={styles.stack}>
        {minds && <MindsGrid minds={minds} sources={sources} quiet={quiet} />}
        {questions.length > 0 && (
          <div className={`measure ${styles.subsection}`}>
            <h3 className={styles.subsectionTitle}>{minds ? "Other open questions" : "Open questions"}</h3>
            <ClaimList claims={questions} sources={sources} quiet={quiet} />
          </div>
        )}
        {!minds && questions.length === 0 && <Placeholder text={PLACEHOLDER.minds} />}
      </div>
    ),
  };
}

function welfareSection({ technology, sources, quiet }: PageContext): SectionSpec {
  const welfare = technology.welfare_governance;
  return {
    id: "welfare",
    label: "Welfare and governance risks",
    title: (
      <>
        Welfare and governance <em>risks</em>
      </>
    ),
    showsDefault: Boolean(welfare),
    body: welfare ? (
      <WelfareSheet welfare={welfare} shortName={technology.short_name} sources={sources} quiet={quiet} />
    ) : (
      <p className={`measure ${styles.placeholderBlock}`}>
        {PLACEHOLDER.welfare} The current risk ratings are in the <a href="#scorecard">full scorecard</a>.
      </p>
    ),
  };
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
          <p className={`measure ${styles.sectionNote}`}>{milestonesNote(items)}</p>
          <MilestoneTable items={items} />
        </>
      ),
  };
}

// "None of the 8 has a date yet, and nothing is mapped at the Actually helping
// stage. Each row opens the milestone on the timeline."
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

  const emptyStages = stagesWithoutMilestones(items);
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
  return {
    id: "full-assessment",
    label: "Full assessment",
    title: (
      <>
        Full <em>assessment</em>
      </>
    ),
    // The default note sits inside the collapsed part, next to the claims.
    showsDefault: false,
    body: <FullAssessment parts={assessmentParts(context)} top={<DefaultMark kind={context.quiet} />} />,
  };
}

function assessmentParts({ technology, sources, sourcesByRegisterId, quiet }: PageContext): AssessmentPart[] {
  const parts: AssessmentPart[] = [];

  parts.push({
    id: "scorecard",
    title: "Full scorecard",
    summary: "the full scorecard with the basis for each rating",
    body: (
      <>
        <ScorecardNote rows={technology.scorecard} />
        <Scorecard
          rows={technology.scorecard}
          technologyName={technology.name}
          shortName={technology.short_name}
          sources={sources}
          quiet={quiet}
          detailLinks={scorecardDetailLinks(technology)}
        />
        {technology.evidence_gap && <EvidenceGap claim={technology.evidence_gap} sources={sources} quiet={quiet} />}
      </>
    ),
  });

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

  return parts;
}

// Which scorecard rows point to a detail section, for this page's content.
function scorecardDetailLinks(technology: TechnologyPage): Record<string, ScorecardDetailLink> {
  const links: Record<string, ScorecardDetailLink> = {};
  for (const row of technology.scorecard) {
    const section = DIMENSION_SECTIONS[row.dimension];
    if (section === "minds" && technology.artificial_minds_assessment) {
      links[row.dimension] = { href: "#minds", label: "Artificial minds" };
    }
    if (section === "welfare" && technology.welfare_governance) {
      links[row.dimension] = { href: "#welfare", label: "Welfare and governance risks" };
    }
  }
  return links;
}

// The case row for one problem, which holds the reason for that rating.
function whyLink(rows: ScorecardRow[], problem: "alignment" | "intelligence_curse"): { href: string; label: string } {
  for (const row of rows) {
    if (row.scale === "case" && row.problem === problem) {
      return { href: `#${scorecardRowId(row.dimension)}`, label: `see the ${row.dimension} row in the scorecard` };
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

// A short reading guide above the full scorecard. The optional sentence comes
// from the data, so the note stays true as ratings change.
function ScorecardNote({ rows }: { rows: ScorecardRow[] }) {
  return (
    <div className={`measure ${styles.sectionNote}`}>
      <p>
        The ratings use the scales in the team&rsquo;s draft scorecard.
        {hasSeverityFlag(rows) && <> If an Unclear risk could be severe, its row also says how severe.</>}{" "}
        &ldquo;Not claimed&rdquo; means the proposal doesn&rsquo;t claim that outcome, so there is no case to grade.
        We never rate a risk Low just because nobody has studied it
        {isDraftEnum("RiskRating") && ", and the cutoffs for the risk ratings aren’t set yet"}.{" "}
        <Link href="/methodology/">How we rate</Link>
      </p>
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
