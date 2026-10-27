import type { Metadata } from "next";
import type { ReactNode } from "react";

import { DraftMark, SampleChip } from "@/components/common/Marks";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionHead } from "@/components/common/SectionHead";
import { StageCards } from "@/components/common/StageCards";
import { Stamp } from "@/components/common/Stamp";
import { ClaimText } from "@/components/provenance/ClaimText";
import { ProvenanceLegend, StageLegend } from "@/components/provenance/Legends";
import { ProvenanceTag } from "@/components/provenance/ProvenanceTag";
import { CatalogCard } from "@/components/sources/CatalogCard";
import { DossierSlot } from "@/components/styleguide/DossierSlot";
import { Swatch } from "@/components/styleguide/Swatch";
import { getSources, sourcesById } from "@/lib/data";
import { enumLabel } from "@/lib/enums";
import { sourceRefsById } from "@/lib/sources";
import type { Claim, Source } from "@/lib/types";

import styles from "./page.module.css";
import { COLOR_GROUPS, RADII, STAGE_SWATCHES, TYPE_SCALE } from "./tokens-list";

export const metadata: Metadata = {
  title: "Style tile",
  robots: { index: false, follow: false },
};

const FONTS = [
  {
    name: "Instrument Serif",
    variable: "--font-display",
    className: styles.fontDisplay,
    use: "Headlines, card titles and quotes.",
    sample: "Could brain tech keep humans in the loop?",
  },
  {
    name: "Instrument Sans",
    variable: "--font-sans",
    className: styles.fontSans,
    use: "Body copy and interface text.",
    sample: "Every research claim on this site carries one of four marks: From a source, Our read, AI-suggested or Unclear.",
  },
  {
    name: "IBM Plex Mono",
    variable: "--font-mono",
    className: styles.fontMono,
    use: "Data: years, windows, counts, IDs and category chips.",
    sample: "WBE-03 · TECHNICAL CAPABILITY · 4 FORECASTS FROM 3 SOURCES",
  },
];

// One example of each provenance kind. These are style examples, not content.
const EXAMPLE_CLAIMS: Claim[] = [
  {
    text: "Style example: a sentence taken straight from a source, shown with its exact quote.",
    provenance: "source",
    source_ids: ["sample-roadmap-report"],
    quote: "This placeholder stands in for an exact sentence from the cited source.",
    quote_location: "p. 12",
  },
  {
    text: "Style example: the team's own interpretation of what the evidence adds up to.",
    provenance: "team",
  },
  {
    text: "Style example: a suggestion from an AI model that a person has checked.",
    provenance: "ai",
    reviewed_by: "Sample reviewer",
  },
  {
    text: "Style example: something we can't tell yet, with the reason in the tag.",
    provenance: "unclear",
    unclear_reason: "conflicting_evidence",
  },
];

// Show the sample sources that exercise the most card states: AI-suggested
// fields, an arXiv id, and an Unclear credibility with its reason.
function pickCatalogExamples(): Source[] {
  const byId = sourcesById();
  const picked: Source[] = [];
  for (const id of ["sample-neuromorphic-benchmark", "sample-skeptic-essay"]) {
    if (byId[id]) {
      picked.push(byId[id]);
    }
  }
  if (picked.length === 0 && getSources().length > 0) {
    picked.push(getSources()[0]);
  }
  return picked;
}

function TileSection({
  id,
  number,
  label,
  title,
  intro,
  children,
}: {
  id: string;
  number: string;
  label: string;
  title: ReactNode;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-heading`}>
      <SectionHead id={`${id}-heading`} eyebrow={`${number} · ${label}`} title={title} intro={intro} />
      {children}
    </section>
  );
}

export default function StyleguidePage() {
  const sourceRefs = sourceRefsById(getSources());
  const catalogExamples = pickCatalogExamples();

  return (
    <>
      <PageHeader
        eyebrow="Style tile"
        title={
          <>
            Tokens, type and <em>components</em>
          </>
        }
        lede="Everything the site is built from is collected here. Change a token in tokens.css and it changes on every page."
      >
        <span className="chip">Internal · not indexed</span>
      </PageHeader>

      <div className="container">
        <TileSection
          id="color"
          number="01"
          label="Color"
          title={
            <>
              Paper, ink and one <em>accent</em> color
            </>
          }
          intro="The pages are warm ivory paper with near-black ink, plus a single grape accent. The only other colors are the three stage colors and the red stamp, and each is reserved for one use."
        >
          <div className={styles.colorGroups}>
            {COLOR_GROUPS.map((group) => (
              <div key={group.title} className={styles.colorGroup}>
                <h3 className={styles.groupTitle}>{group.title}</h3>
                <ul className={styles.swatches}>
                  {group.swatches.map((swatch) => (
                    <Swatch key={swatch.token} {...swatch} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </TileSection>

        <TileSection
          id="type"
          number="02"
          label="Type"
          title={
            <>
              The three <em>typefaces</em>
            </>
          }
        >
          <ul className={styles.fonts}>
            {FONTS.map((font) => (
              <li key={font.name} className={`paper ${styles.font}`}>
                <div className={styles.fontHead}>
                  <span className={`${styles.fontGlyph} ${font.className}`} aria-hidden="true">
                    Aa
                  </span>
                  <div>
                    <p className={styles.fontName}>{font.name}</p>
                    <code className={styles.code}>var({font.variable})</code>
                  </div>
                </div>
                <p className={`${styles.fontSample} ${font.className}`}>{font.sample}</p>
                <p className={styles.fontUse}>{font.use}</p>
              </li>
            ))}
          </ul>

          <h3 className={styles.subTitle}>Type scale</h3>
          <ul className={styles.scale}>
            {TYPE_SCALE.map((step) => (
              <li key={step.token} className={styles.scaleRow}>
                <div className={styles.scaleMeta}>
                  <code className={styles.code}>{step.token}</code>
                  <span className={styles.scaleUse}>{step.use}</span>
                </div>
                <span className={styles.scaleSample} style={{ fontSize: `var(${step.token})` }}>
                  Possible, available, helping
                </span>
                <code className={`${styles.code} ${styles.scaleValue}`}>{step.value}</code>
              </li>
            ))}
          </ul>
        </TileSection>

        <TileSection
          id="headlines"
          number="03"
          label="Headlines"
          title={
            <>
              One italic word <em>per headline</em>
            </>
          }
          intro="Headlines use the display serif with tight leading, and each has exactly one word or phrase in grape italics. Write a plain headline that names what the section holds, then italicize the word you'd stress reading it aloud."
        >
          <div className={`paper ${styles.headlineCard}`}>
            <p className="eyebrow">01 · Page title</p>
            <p className={styles.headlineXl}>
              Could brain tech <em>keep humans</em> in the loop?
            </p>
            <p className="eyebrow">02 · Section headline</p>
            <p className={styles.headlineLg}>
              Every milestone sits in one of three <em>stages</em>
            </p>
            <p className="lede">A lede sits under the headline in muted ink, at about sixty characters a line.</p>
          </div>
        </TileSection>

        <TileSection
          id="controls"
          number="04"
          label="Controls"
          title={
            <>
              Buttons and <em>chips</em>
            </>
          }
        >
          <div className={styles.row}>
            <button type="button" className="btn btn-primary">
              Primary action
            </button>
            <button type="button" className="btn btn-secondary">
              Secondary action
            </button>
            <button type="button" className="btn btn-primary" disabled>
              Disabled
            </button>
          </div>
          <div className={styles.row}>
            <span className="chip">{enumLabel("SourceType", "preprint")}</span>
            <span className="chip">{enumLabel("Technology", "bci")}</span>
            <span className="chip">4 forecasts · 3 sources</span>
            <SampleChip />
            <span className="eyebrow">
              Relevance
              <DraftMark />
            </span>
          </div>
        </TileSection>

        <TileSection
          id="surfaces"
          number="05"
          label="Surfaces"
          title={
            <>
              Paper <em>cards</em>
            </>
          }
          intro="Cards look like paper, with a faint grain, a hairline edge and a grape-tinted shadow. Anything card-sized gets a radius between 1.25 and 2rem."
        >
          <div className={styles.surfaceGrid}>
            <div className={`paper ${styles.paperDemo}`}>
              <p className="eyebrow">Paper card</p>
              <p className={styles.paperTitle}>Card title</p>
              <p className={styles.paperText}>
                Background <code className={styles.code}>--paper-2</code> plus <code className={styles.code}>--grain</code>,
                a <code className={styles.code}>--rule-soft</code> edge and <code className={styles.code}>--shadow-paper</code>.
              </p>
            </div>
            <ul className={styles.radii}>
              {RADII.map((radius) => (
                <li key={radius.token} className={styles.radius}>
                  <span className={styles.radiusShape} style={{ borderRadius: `var(${radius.token})` }} aria-hidden="true" />
                  <code className={styles.code}>{radius.token}</code>
                  <code className={styles.code}>{radius.value}</code>
                </li>
              ))}
            </ul>
          </div>
        </TileSection>

        <TileSection
          id="catalog"
          number="06"
          label="Catalog card"
          title={
            <>
              Source <em>catalog</em> cards
            </>
          }
          intro="Each card has a mono call line at the top, then the serif title, our summary and a labeled chip for every category. Fields an AI suggested keep the dashed mark and the name of whoever checked them."
        >
          <ul className={styles.catalogGrid}>
            {catalogExamples.map((source) => (
              <li key={source.id}>
                <CatalogCard source={source} sources={sourceRefs} />
              </li>
            ))}
          </ul>
        </TileSection>

        <TileSection
          id="provenance"
          number="07"
          label="Provenance"
          title={
            <>
              The four provenance <em>marks</em>
            </>
          }
          intro="Each kind has a glyph and line style of its own. In grayscale, those are what tell the four apart."
        >
          <ProvenanceLegend />
          <div className={styles.legendCompact}>
            <span className="eyebrow">Compact legend</span>
            <ProvenanceLegend compact />
          </div>
          <ul className={styles.claims}>
            {EXAMPLE_CLAIMS.map((claim) => (
              <li key={claim.provenance} className={`paper ${styles.claimCard}`}>
                <p className={styles.claimLabel}>
                  <code className={styles.code}>provenance: &quot;{claim.provenance}&quot;</code>
                </p>
                <ClaimText claim={claim} sources={sourceRefs} />
              </li>
            ))}
          </ul>
          <div className={styles.row}>
            <ProvenanceTag kind="ai" reviewedBy="Sample reviewer" />
            <ProvenanceTag kind="unclear" unclearReason="search_incomplete" />
          </div>
        </TileSection>

        <TileSection
          id="stages"
          number="08"
          label="Stages"
          title={
            <>
              Stage <em>colors</em>
            </>
          }
          intro="These colors are only ever used to show stage. Each stage has a fill for bars and a darker ink for labels, and labels always name the stage, so color is never the only cue."
        >
          <StageLegend />
          <ul className={styles.stageSwatches}>
            {STAGE_SWATCHES.map((pair) => (
              <li key={pair.stage} className={styles.stagePair}>
                <span className={styles.stageBar} style={{ background: `var(${pair.fill.token})` }} aria-hidden="true" />
                <span className={styles.stageInk} style={{ color: `var(${pair.ink.token})` }}>
                  {enumLabel("Stage", pair.stage)}
                </span>
                <code className={styles.code}>
                  {pair.fill.token} {pair.fill.value}
                </code>
                <code className={styles.code}>
                  {pair.ink.token} {pair.ink.value}
                </code>
              </li>
            ))}
          </ul>
          <StageCards />
        </TileSection>

        <TileSection
          id="signals"
          number="09"
          label="Signals"
          title={
            <>
              The disagreement <em>stamp</em>
            </>
          }
          intro="Red is used in one place only: the rubber stamp on a milestone whose sources disagree. The stamp sits next to that milestone's forecasts without hiding them."
        >
          <div className={`paper ${styles.stampDemo}`}>
            <Stamp />
            <Stamp size="sm" />
          </div>
        </TileSection>

        <TileSection
          id="dossier"
          number="10"
          label="Dossier card"
          title={
            <>
              The milestone <em>dossier</em>
            </>
          }
          intro="This is the live panel that opens when you pick a milestone on the timeline. Here it shows the first milestone whose sources disagree, or the first milestone if none do."
        >
          <DossierSlot />
        </TileSection>
      </div>
    </>
  );
}
