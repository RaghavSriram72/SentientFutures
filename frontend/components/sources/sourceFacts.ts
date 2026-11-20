// What a source's row and card show for a few fields that depend on the
// workbook. Shared by the row, the card and the list's filters, so all three
// agree.
import { enumLabel } from "@/lib/enums";
import type { ClaimDirection, Source } from "@/lib/types";

// The workbook marks the source "screening pending" (S17). Its category and
// claim label are provisional until screening is done, so the site doesn't
// show its problem or claim directions, and the filters don't match them.
export function isScreeningPending(source: Source): boolean {
  return source.screening_pending === true;
}

// The source type as the workbook's 3a tab writes it ("Presentation",
// "Policy paper"), or the site's own label when there's no 3a row.
export function shownSourceType(source: Source): string {
  const fromWorkbook = source.quality?.source_type;
  if (fromWorkbook) {
    return fromWorkbook;
  }
  return enumLabel("SourceType", source.source_type);
}

// The claim directions the site shows: none while screening is pending.
export function shownDirections(source: Source): ClaimDirection[] {
  if (isScreeningPending(source)) {
    return [];
  }
  return source.claim_directions ?? [];
}
