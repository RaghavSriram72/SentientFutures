// The public export reports why it skips an approved source as validator
// lines, like "year: Input should be a valid integer (got null)". These turn
// the common ones into sentences a reviewer can act on. Anything else is
// shown as the export wrote it.

function splitProblem(line: string): { field: string; message: string } {
  const colon = line.indexOf(": ");
  if (colon === -1) {
    return { field: "", message: line };
  }
  return { field: line.slice(0, colon), message: line.slice(colon + 2) };
}

export function describePublishProblem(line: string): string {
  const { field, message } = splitProblem(line);
  if (field === "year") {
    if (message.includes("(got null)")) {
      return "The paper has no publication year.";
    }
    return "The publication year doesn't look right.";
  }
  if (field === "url") {
    return "The paper has no web link that starts with https:// or http://.";
  }
  if (field === "title") {
    return "The paper has no title.";
  }
  if (field.startsWith("authors")) {
    return "One of the author names is empty.";
  }
  if (field === "id") {
    return "The paper's id can't be turned into a web address for its public page.";
  }
  if (field === "source_type") {
    return "The source type is missing, or isn't one the public site uses.";
  }
  return line;
}

// Said under every list of publish problems, so nobody hunts for an edit
// button that doesn't exist.
export const WHO_FIXES_PUBLISH_PROBLEMS =
  "Admin can't edit a paper's details yet, so someone with database access has to correct this paper in the sources collection. The next public export picks up the fix.";
