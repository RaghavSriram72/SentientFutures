"use client";

import { useEffect } from "react";

// A printout can't be clicked, so every folded <details> prints open. The
// print rule in globals.css already does this in Chrome and Edge. Other
// browsers hide closed content in a way CSS can't undo, so this opens the
// closed ones just before printing and closes those same ones again after,
// leaving the page as the reader had it. Renders nothing.
export function PrintOpenDetails() {
  useEffect(() => {
    let openedForPrint: HTMLDetailsElement[] = [];

    // The list is only cleared after printing, so a second beforeprint before
    // the afterprint still closes the ones the first one opened.
    function onBeforePrint() {
      for (const details of document.querySelectorAll("details")) {
        if (!details.open) {
          details.open = true;
          openedForPrint.push(details);
        }
      }
    }

    function onAfterPrint() {
      for (const details of openedForPrint) {
        details.open = false;
      }
      openedForPrint = [];
    }

    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, []);

  return null;
}
