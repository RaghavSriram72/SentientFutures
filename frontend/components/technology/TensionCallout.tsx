import { ClaimText } from "@/components/provenance/ClaimText";
import type { SourceRef } from "@/lib/sources";
import type { Claim, Provenance } from "@/lib/types";

import styles from "./TensionCallout.module.css";

// "The tension": two or three sentences the team writes about the trade-off at
// the heart of the proposal. The page shows it only when the field is set.
export function TensionCallout({
  claim,
  sources,
  quiet,
}: {
  claim: Claim;
  sources: Record<string, SourceRef>;
  quiet: Provenance;
}) {
  return (
    <aside className={styles.callout} aria-labelledby="tension-title">
      <h2 id="tension-title" className={styles.title}>
        The tension
      </h2>
      <div className={styles.claim}>
        <ClaimText claim={claim} sources={sources} quiet={quiet} />
      </div>
    </aside>
  );
}
