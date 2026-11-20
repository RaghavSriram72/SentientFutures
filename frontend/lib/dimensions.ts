// The keys the rating cards and the compare page share, so a card links to
// the comparison and the comparison links back to the same card.
// Pure: no React and no data, so the tests can load it.
//
// Every scorecard row has a stable `id` (ScorecardRow.id in types.ts), the
// same on every page. It is the card's anchor and the compare key.
// The paths here have no base path: next/link adds it.

// The compare page's address parameter: /compare/?dimension=<key>.
export const COMPARE_PARAM = "dimension";

// The compare keys that aren't scorecard rows: this one, and one per milestone
// category (compareCategoryKey). No scorecard row id can be one of them.
// Keep in step with COMPARE_MINDS_ID and compare_category_id in
// shared/sf_shared/models.py, whose validator refuses them. Change both together.
export const COMPARE_MINDS_KEY = "artificial-minds";

// The scorecard row that the compare page's artificial minds view and the
// technology page's Artificial minds section show.
export const MINDS_ROW_ID = "artificial-mind-welfare-and-rights-risk";

// "economic_viability" -> "economic-viability".
export function compareCategoryKey(category: string): string {
  return category.replace(/_/g, "-");
}

// The element id of a rating card: "alignment-case" -> "scorecard-alignment-case".
export function scorecardRowId(rowId: string): string {
  return `scorecard-${rowId}`;
}

// scorecardHref("wbe", "alignment-case") -> "/wbe/#scorecard-alignment-case".
export function scorecardHref(technologyId: string, rowId: string): string {
  return `/${technologyId}/#${scorecardRowId(rowId)}`;
}

// The compare page on one dimension, or on its first dimension when key is null.
export function compareHref(key: string | null): string {
  if (key === null) {
    return "/compare/";
  }
  return `/compare/?${COMPARE_PARAM}=${encodeURIComponent(key)}`;
}
