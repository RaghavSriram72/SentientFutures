// A hand-kept mirror of app/tokens.css for the style tile. The swatches paint
// themselves with var(--token), so they always show the live color; only the
// printed values here can drift. Update this list when tokens.css changes.
// (Hex values are allowed here because they're printed as text, not used as styles.)

export interface TokenSwatch {
  token: string;
  value: string;
  label: string;
  note?: string;
}

export interface SwatchGroup {
  title: string;
  swatches: TokenSwatch[];
}

export const COLOR_GROUPS: SwatchGroup[] = [
  {
    title: "Paper",
    swatches: [
      { token: "--paper", value: "#ffffea", label: "Ivory", note: "Page background" },
      { token: "--paper-2", value: "#fffef1", label: "Card", note: "Cards and panels" },
      { token: "--paper-3", value: "#f8f3e4", label: "Shelf", note: "Bands and table heads" },
      { token: "--paper-edge", value: "#ece4cf", label: "Edge" },
      { token: "--wash-soft", value: "#f3eef8", label: "Lilac" },
      { token: "--wash", value: "linear-gradient(128deg, #f1e6ee, #ffffea)", label: "Wash", note: "Page headers" },
    ],
  },
  {
    title: "Ink",
    swatches: [
      { token: "--ink", value: "#03120e", label: "Ink", note: "Headings" },
      { token: "--ink-body", value: "#1e1e1e", label: "Body", note: "Running text" },
      { token: "--ink-muted", value: "#4f4655", label: "Muted", note: "Secondary text" },
      { token: "--ink-faint", value: "#6e6573", label: "Faint", note: "Meta, still AA" },
    ],
  },
  {
    title: "Accent",
    swatches: [
      { token: "--grape", value: "#533a71", label: "Grape", note: "Links, focus, the one accent" },
      { token: "--grape-deep", value: "#3f2c57", label: "Grape deep", note: "Button gradient end" },
      { token: "--grape-tint", value: "#533a7114", label: "Grape tint", note: "AI fills, hovers" },
      { token: "--grape-tint-2", value: "#533a7126", label: "Grape tint 2" },
      { token: "--mauve", value: "#654f6f", label: "Mauve", note: "Our read, draft marks" },
      { token: "--lavender", value: "#c9a0dc", label: "Lavender", note: "Fill only, never text" },
      { token: "--lavender-soft", value: "#c9a0dc40", label: "Lavender soft", note: "Highlights" },
    ],
  },
  {
    title: "Rules",
    swatches: [
      { token: "--rule", value: "#533a712e", label: "Rule", note: "Hairlines" },
      { token: "--rule-soft", value: "#533a711a", label: "Rule soft" },
      { token: "--rule-strong", value: "#533a718c", label: "Rule strong", note: "Inputs, dashed AI frames" },
    ],
  },
  {
    title: "Signals",
    swatches: [
      { token: "--stamp", value: "#b3261e", label: "Stamp", note: "Disagreement only" },
      { token: "--stamp-tint", value: "#b3261e14", label: "Stamp tint" },
      { token: "--sage", value: "#5e8c6a", label: "Sage" },
    ],
  },
];

export const STAGE_SWATCHES: { stage: string; fill: TokenSwatch; ink: TokenSwatch }[] = [
  {
    stage: "possible",
    fill: { token: "--stage-possible", value: "#c9a0dc", label: "Possible fill" },
    ink: { token: "--stage-possible-ink", value: "#6b3f86", label: "Possible ink" },
  },
  {
    stage: "widely_available",
    fill: { token: "--stage-widely", value: "#c48a2e", label: "Widely available fill" },
    ink: { token: "--stage-widely-ink", value: "#8e641f", label: "Widely available ink" },
  },
  {
    stage: "actually_helping",
    fill: { token: "--stage-helping", value: "#5e8c6a", label: "Actually helping fill" },
    ink: { token: "--stage-helping-ink", value: "#2f6b43", label: "Actually helping ink" },
  },
];

export const TYPE_SCALE: { token: string; value: string; use: string }[] = [
  { token: "--text-3xl", value: "clamp(2.125rem, 1.3rem + 3.2vw, 4.125rem)", use: "Page titles" },
  { token: "--text-2xl", value: "clamp(1.875rem, 1.4rem + 1.8vw, 2.75rem)", use: "Section headlines" },
  { token: "--text-xl", value: "clamp(1.5rem, 1.2rem + 1vw, 1.875rem)", use: "Card titles" },
  { token: "--text-lg", value: "1.25rem", use: "Ledes" },
  { token: "--text-base", value: "1.0625rem", use: "Body" },
  { token: "--text-sm", value: "0.875rem", use: "Notes, tables" },
  { token: "--text-xs", value: "0.75rem", use: "Mono labels" },
];

export const RADII: { token: string; value: string }[] = [
  { token: "--radius-sm", value: "0.5rem" },
  { token: "--radius-md", value: "0.75rem" },
  { token: "--radius-lg", value: "1rem" },
  { token: "--radius-card", value: "1.25rem" },
  { token: "--radius-panel", value: "1.5rem" },
  { token: "--radius-hero", value: "2rem" },
];
