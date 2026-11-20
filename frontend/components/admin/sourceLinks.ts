// The link rules for "Add a source", kept apart from the page so the tests
// can load them (tests/sourceLinks.test.ts). Each one mirrors a rule in
// shared/sf_shared/normalize.py (or the API's sources_routes.py), so the page
// refuses only what the API would refuse, and fills in only what the API
// would fill in. A change to one belongs in the other too.

// The same rules as is_web_link in shared/sf_shared/normalize.py: no spaces,
// and a host like "doi.org" whose last part has a letter in it. That catches
// "https://" on its own and a missing slash like "https://doi.org10.1234".
export function isWebLink(url: string): boolean {
  if (/\s/.test(url)) {
    return false;
  }
  // The host as written, the way the API reads it: after "://", up to the
  // first "/", "?" or "#", without any "name@" in front. The browser would
  // read a backslash there as a slash and "%6D" as "m", and pass a link the
  // API refuses.
  const start = url.indexOf("://");
  if (start === -1) {
    return false;
  }
  const authority = url.slice(start + 3).split(/[/?#]/)[0];
  const writtenHost = authority.slice(authority.lastIndexOf("@") + 1);
  if (writtenHost.includes("\\") || writtenHost.includes("%")) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return false;
  }
  // Nothing answers on port 0, and the API refuses it too.
  if (parsed.port === "0") {
    return false;
  }
  const labels = parsed.hostname.split(".");
  if (labels.length < 2) {
    return false;
  }
  for (const label of labels) {
    if (!/^[a-z0-9-]+$/.test(label)) {
      return false;
    }
  }
  return /[a-z]/.test(labels[labels.length - 1]);
}

// The same patterns as shared/sf_shared/normalize.py, so the DOI or arXiv id
// read from a link here is the one the API would store.
const DOI_LINK_PREFIXES = ["https://doi.org/", "http://doi.org/", "https://dx.doi.org/", "http://dx.doi.org/"];
const DOI_PATTERN = /10\.\d{4,9}\/\S+/;
const ARXIV_LINK_PATTERN = /arxiv\.org\/(?:abs|pdf|html)\/(.+?)(?:\.pdf)?\/?$/i;
const NEW_ARXIV_PATTERN = /^(\d{4}\.\d{4,5})(v\d+)?$/;
const OLD_ARXIV_PATTERN = /^([a-z-]+(?:\.[a-z]{2})?\/\d{7})(v\d+)?$/i;

// The DOI in a link, found the way normalize_doi in normalize.py finds it:
// after the doi.org prefix when the link starts with one, and otherwise
// anywhere in the link. In lowercase, as the API stores it, or "".
//
// So "https://doi.org:443/10.1000/xyz", which starts with none of the
// prefixes, still has the DOI "10.1000/xyz".
function findDoi(url: string): string {
  let rest = url;
  const lowered = url.toLowerCase();
  for (const prefix of DOI_LINK_PREFIXES) {
    if (lowered.startsWith(prefix)) {
      rest = url.slice(prefix.length);
      break;
    }
  }
  const match = DOI_PATTERN.exec(rest);
  if (match === null) {
    return "";
  }
  // Trailing punctuation usually comes from the sentence around a pasted link.
  return match[0].replace(/[.,;)]+$/, "").toLowerCase();
}

// The DOI that a doi.org link fills into the DOI field, or "". Like the API
// (is_doi_link in backend/sf_api/sources_routes.py), only a link that starts
// with one of the prefixes above fills it in.
export function doiFromLink(url: string): string {
  const lowered = url.toLowerCase();
  for (const prefix of DOI_LINK_PREFIXES) {
    if (lowered.startsWith(prefix)) {
      return findDoi(url);
    }
  }
  return "";
}

// The arXiv id of an arXiv abs, pdf or html link, without its version, or "".
export function arxivIdFromLink(url: string): string {
  const linkMatch = ARXIV_LINK_PATTERN.exec(url);
  if (linkMatch === null) {
    return "";
  }
  let text = linkMatch[1];
  if (text.toLowerCase().startsWith("arxiv:")) {
    text = text.slice("arxiv:".length);
  }
  const newMatch = NEW_ARXIV_PATTERN.exec(text);
  if (newMatch !== null) {
    return newMatch[1];
  }
  const oldMatch = OLD_ARXIV_PATTERN.exec(text);
  if (oldMatch !== null) {
    return oldMatch[1];
  }
  return "";
}

// Links on these hosts only open a paper when they carry its DOI or arXiv id.
const DOI_HOSTS = ["doi.org", "dx.doi.org"];
const ARXIV_HOSTS = ["arxiv.org", "www.arxiv.org", "export.arxiv.org"];

// False for a doi.org or arXiv link with no DOI or arXiv id in it, like
// "https://arxiv.org/abs/", which opens an error page. Every other link
// passes. The same rule as names_its_paper in shared/sf_shared/normalize.py.
// Call it only on a link isWebLink has passed, so URL can read it.
export function namesItsPaper(url: string): boolean {
  const parsed = new URL(url);
  if (DOI_HOSTS.includes(parsed.hostname)) {
    // findDoi, not doiFromLink: a doi.org link with a port, say, still names
    // its paper, though it doesn't fill in the DOI field.
    return findDoi(url) !== "";
  }
  if (ARXIV_HOSTS.includes(parsed.hostname)) {
    // The query and #fragment are left out, as the API does.
    return arxivIdFromLink(parsed.hostname + parsed.pathname) !== "";
  }
  return true;
}
