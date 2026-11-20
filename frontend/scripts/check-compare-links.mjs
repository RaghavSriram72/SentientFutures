// Checks, after a build, the links the compare page shares with the
// technology pages and the timeline. A rating card and its compare column
// point at each other by the scorecard row's id, so a card that loses its
// anchor, or a link built from the wrong id, would land at the top of the
// page with no error anywhere else. This reads the exported HTML in out/:
//
//   1. Every link on /compare/ with a #hash, except those to the timeline,
//      matches an id="..." in that page's HTML: /wbe/#id, /bci/#id and
//      /neuromorphic/#id, and also /methodology/#ratings ("How we rate"),
//      /sources/#s13 (a source id in the workbook's text) and any other
//      page. A link to a technology page's workbook row (#milestone-...,
//      #risk-..., #pathway-...) must match exactly one id there.
//   2. Every link on /compare/ to /timeline/#id names a milestone in the data
//      folder that isn't a sample.
//   3. Each technology page has id="scorecard-<row id>" exactly once for each
//      of its scorecard rows, and no scorecard-... id twice.
//   4. Every /compare/?dimension=<key> link, on /compare/, the home page and
//      the technology pages, names a panel on /compare/.
//   5. Each column on /compare/ links to its own technology's rating card
//      for that panel: a scorecard panel's column to /<tech>/#scorecard-<row
//      id>, and an Artificial minds column to /<tech>/#scorecard-<minds row
//      id> and to /<tech>/#minds. Check 1 only proves the id exists, so a
//      link built from another row's id would pass it.
//   6. Each milestone category column links to every tab 1a row its family
//      has in that category (/<tech>/#milestone-bci-m1-1), and each risk
//      row column links to every tab 7 risk behind it (/<tech>/#risk-r07),
//      as scorecard.json lists them.
//
// Every internal link must also start with the base path.
//
// Run from frontend/, after the build, with the build's base path:
//   NEXT_PUBLIC_BASE_PATH=/SentientFutures npm run build
//   NEXT_PUBLIC_BASE_PATH=/SentientFutures node scripts/check-compare-links.mjs
// A build that read another data folder (DATA_DIR=../.site-data) needs the
// same DATA_DIR here. Exits with 1 and lists every problem it finds. With a
// base path that differs from the build's, it says so and checks no links.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "..", "out");
// The same folder lib/data.ts reads: DATA_DIR, or content/ next to frontend/.
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(here, "..", "..", "content");
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const problems = [];

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, fileName), "utf-8"));
}

// The exported HTML for a route such as "/wbe/", or null when it's missing.
function readPage(route) {
  const filePath = path.join(outDir, route, "index.html");
  if (!fs.existsSync(filePath)) {
    problems.push(`${path.relative(process.cwd(), filePath)} doesn't exist. Run the build first.`);
    return null;
  }
  return fs.readFileSync(filePath, "utf-8");
}

// Attribute values come HTML-escaped: "?a=1&amp;b=2".
function unescapeHtml(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// How many times each id="..." appears in the page.
function idCounts(html) {
  const counts = new Map();
  for (const match of html.matchAll(/\sid="([^"]*)"/g)) {
    const id = unescapeHtml(match[1]);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

// The base path the build used, read from where the page loads its scripts
// and styles: "/SentientFutures" for /SentientFutures/_next/..., "" for
// /_next/..., or null when the page loads none.
function builtBasePath(html) {
  const match = html.match(/\s(?:href|src)="((?:\/[^"/]+)*)\/_next\//);
  return match ? match[1] : null;
}

// When this runs with a different base path from the build's, every link
// would look broken (or be skipped), so it says that once and checks no links.
function basePathMatches(html) {
  const built = builtBasePath(html);
  if (built === null || built === basePath) {
    return true;
  }
  if (basePath === "") {
    problems.push(
      `The build used the base path ${built}, but NEXT_PUBLIC_BASE_PATH isn't set. ` +
        `Run this again with NEXT_PUBLIC_BASE_PATH=${built}.`,
    );
  } else if (built === "") {
    problems.push(
      `NEXT_PUBLIC_BASE_PATH is ${basePath}, but the build used no base path. ` +
        `Run this with the same NEXT_PUBLIC_BASE_PATH as the build, or none.`,
    );
  } else {
    problems.push(
      `The build used the base path ${built}, but NEXT_PUBLIC_BASE_PATH is ${basePath}. ` +
        `Run this again with NEXT_PUBLIC_BASE_PATH=${built}.`,
    );
  }
  return false;
}

// Each page's links, read once, so a problem with one is reported once.
const linksByPage = new Map();

// The page's internal links, without the base path, as URL objects. Only
// href attributes in the markup count: the router's copy of the page in the
// inline scripts writes them differently and has no base path. Each link
// also keeps where it sits in the HTML (index), so check 5 can tell which
// column it's in.
function internalLinks(html, pageName) {
  if (linksByPage.has(pageName)) {
    return linksByPage.get(pageName);
  }
  const links = [];
  for (const match of html.matchAll(/\shref="([^"]*)"/g)) {
    const href = unescapeHtml(match[1]);
    if (!href.startsWith("/") || href.startsWith("//")) {
      continue; // an in-page #hash, or another site
    }
    let sitePath = href;
    if (basePath !== "") {
      if (href !== basePath && !href.startsWith(`${basePath}/`)) {
        problems.push(`${pageName}: the link ${href} doesn't start with the base path ${basePath}.`);
        continue;
      }
      sitePath = href.slice(basePath.length) || "/";
    }
    if (sitePath.startsWith("/_next/")) {
      continue; // scripts, styles and fonts
    }
    links.push({ href, url: new URL(sitePath, "http://site.invalid"), index: match.index });
  }
  linksByPage.set(pageName, links);
  return links;
}

const technologies = readJson("technologies.json");
const milestones = readJson("milestones.json");
const scorecard = readJson("scorecard.json");

const publicMilestoneIds = new Set();
for (const milestone of milestones) {
  if (milestone.sample !== true) {
    publicMilestoneIds.add(milestone.id);
  }
}

// ---------- 3. The scorecard ids on each technology page ----------

const technologyIds = new Map(); // "/wbe/" -> its id counts
const technologyPages = new Map(); // "/wbe/" -> its HTML
for (const technology of technologies) {
  const route = `/${technology.id}/`;
  const html = readPage(route);
  if (html === null) {
    continue;
  }
  const counts = idCounts(html);
  technologyIds.set(route, counts);
  technologyPages.set(route, html);
  const rowAnchors = new Set();
  for (const row of technology.scorecard) {
    const id = `scorecard-${row.id}`;
    rowAnchors.add(id);
    const count = counts.get(id) ?? 0;
    if (count !== 1) {
      problems.push(`${route}: id="${id}" appears ${count} times. Each rating needs exactly one.`);
    }
  }
  // Any other scorecard-... id, such as a part of a rating card.
  for (const [id, count] of counts) {
    if (id.startsWith("scorecard-") && !rowAnchors.has(id) && count > 1) {
      problems.push(`${route}: id="${id}" appears ${count} times.`);
    }
  }
}

// ---------- 1 and 2. The links on /compare/ ----------

const compareHtml = readPage("/compare/");
// The link checks need the build's base path. The scorecard ids above don't.
const linksReadable = compareHtml !== null && basePathMatches(compareHtml);
const panelKeys = new Set();
let techLinkCount = 0;
let timelineLinkCount = 0;
let otherLinkCount = 0;

// The id counts of the other pages /compare/ links to with a #hash, such as
// /methodology/, read once each. null when the build has no such page.
const otherPageIds = new Map();
function idsOfOtherPage(route) {
  if (!otherPageIds.has(route)) {
    const filePath = path.join(outDir, route, "index.html");
    let counts = null;
    if (fs.existsSync(filePath)) {
      counts = idCounts(fs.readFileSync(filePath, "utf-8"));
    }
    otherPageIds.set(route, counts);
  }
  return otherPageIds.get(route);
}

if (linksReadable) {
  // Each panel's heading is compare-<key>-title.
  for (const id of idCounts(compareHtml).keys()) {
    const match = id.match(/^compare-(.+)-title$/);
    if (match) {
      panelKeys.add(match[1]);
    }
  }

  for (const { href, url } of internalLinks(compareHtml, "/compare/")) {
    const target = url.hash.slice(1);
    if (target === "") {
      continue;
    }
    if (technologyIds.has(url.pathname)) {
      techLinkCount += 1;
      const id = decodeURIComponent(target);
      const count = technologyIds.get(url.pathname).get(id) ?? 0;
      if (count === 0) {
        problems.push(`/compare/: the link ${href} has no matching id="${target}" on ${url.pathname}.`);
      } else if (count > 1 && /^(milestone|risk|pathway)-/.test(id)) {
        // A workbook row's anchor: two of them would open the wrong one.
        problems.push(`/compare/: the link ${href} matches ${count} id="${target}" on ${url.pathname}. It needs exactly one.`);
      }
    } else if (url.pathname === "/timeline/") {
      timelineLinkCount += 1;
      if (!publicMilestoneIds.has(decodeURIComponent(target))) {
        problems.push(`/compare/: the link ${href} doesn't name a published milestone in ${dataDir}.`);
      }
    } else {
      // Any other page, such as /methodology/#ratings and #stages. Without
      // its id the link would land at the top of the page with no warning.
      otherLinkCount += 1;
      const ids = idsOfOtherPage(url.pathname);
      if (ids === null) {
        problems.push(`/compare/: the link ${href} points at ${url.pathname}, which isn't in the build.`);
      } else if (!ids.has(decodeURIComponent(target))) {
        problems.push(`/compare/: the link ${href} has no matching id="${target}" on ${url.pathname}.`);
      }
    }
  }

  // None at all means the panels didn't make it into the HTML.
  if (techLinkCount === 0) {
    problems.push("/compare/: found no links to the technology pages' ratings or sections.");
  }
}

// ---------- 4. Links to a dimension of /compare/ ----------

let dimensionLinkCount = 0;
if (linksReadable) {
  const pagesToScan = new Map([["/compare/", compareHtml]]);
  const homeHtml = readPage("/");
  if (homeHtml !== null) {
    pagesToScan.set("/", homeHtml);
  }
  for (const [route, html] of technologyPages) {
    pagesToScan.set(route, html);
  }
  for (const [route, html] of pagesToScan) {
    for (const { href, url } of internalLinks(html, route)) {
      if (url.pathname !== "/compare/" || !url.searchParams.has("dimension")) {
        continue;
      }
      dimensionLinkCount += 1;
      const key = url.searchParams.get("dimension");
      if (!panelKeys.has(key)) {
        problems.push(`${route}: the link ${href} names no panel on /compare/ (no id="compare-${key}-title").`);
      }
    }
  }
}

// ---------- 5. Each column links to its own rating card ----------

// A string constant from lib/dimensions.ts, such as MINDS_ROW_ID, so this
// check always uses the same ids as the site. null (and a problem) when the
// file no longer defines it as `export const NAME = "value";`.
function dimensionsConstant(name) {
  const filePath = path.resolve(here, "..", "lib", "dimensions.ts");
  const source = fs.readFileSync(filePath, "utf-8");
  const match = source.match(new RegExp(`export const ${name} = "([^"]+)";`));
  if (!match) {
    problems.push(`${path.relative(process.cwd(), filePath)} doesn't define ${name} as a string. Update this script.`);
    return null;
  }
  return match[1];
}

// Where each panel and each column starts in the HTML, by its
// aria-labelledby id: "compare-<key>-title" for a panel and
// "compare-<key>-<technology id>" for a column. A column runs from its start
// to the next panel or column, so its links are the ones in that stretch.
function columnStretches(html) {
  const starts = [];
  for (const match of html.matchAll(/<(?:section|article)\b[^>]*\saria-labelledby="(compare-[^"]+)"/g)) {
    starts.push({ id: match[1], index: match.index });
  }
  const stretches = new Map(); // "compare-artificial-minds-wbe" -> { start, end }
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].index : html.length;
    stretches.set(starts[i].id, { start: starts[i].index, end });
  }
  return stretches;
}

// True when the column for this panel key and technology holds a link to
// the technology page at #target. Adds a problem when it doesn't.
function columnHasLink(stretches, links, panelKey, technologyId, target) {
  const columnId = `compare-${panelKey}-${technologyId}`;
  const stretch = stretches.get(columnId);
  if (stretch === undefined) {
    problems.push(`/compare/: the ${panelKey} panel has no column for ${technologyId} (no aria-labelledby="${columnId}").`);
    return false;
  }
  const wantedPath = `/${technologyId}/`;
  for (const { url, index } of links) {
    const inColumn = index >= stretch.start && index < stretch.end;
    if (inColumn && url.pathname === wantedPath && decodeURIComponent(url.hash.slice(1)) === target) {
      return true;
    }
  }
  problems.push(`/compare/: the ${technologyId} column of the ${panelKey} panel has no link to ${wantedPath}#${target}.`);
  return false;
}

let columnLinkCount = 0;
if (linksReadable) {
  const mindsKey = dimensionsConstant("COMPARE_MINDS_KEY");
  const mindsRowId = dimensionsConstant("MINDS_ROW_ID");
  const stretches = columnStretches(compareHtml);
  const links = internalLinks(compareHtml, "/compare/");

  // Every link each column should have: [panel key, technology id, #target].
  const expected = [];
  for (const technology of technologies) {
    // Each scorecard panel's key is its row's id.
    for (const row of technology.scorecard) {
      expected.push([row.id, technology.id, `scorecard-${row.id}`]);
    }
    // The Artificial minds panel: the minds rating's card, then the section.
    if (mindsKey !== null && mindsRowId !== null) {
      expected.push([mindsKey, technology.id, `scorecard-${mindsRowId}`]);
      expected.push([mindsKey, technology.id, "minds"]);
    }
  }

  for (const [panelKey, technologyId, target] of expected) {
    if (columnHasLink(stretches, links, panelKey, technologyId, target)) {
      columnLinkCount += 1;
    }
  }
}

// ---------- 6. Each column links to its own workbook rows ----------

// The same anchors as lib/codes.ts: "milestone-bci-m1", or with a part
// ("milestone-bci-m1-1") when the family has several rows for one milestone,
// numbered in sheet order; and "risk-r07".
function milestoneAnchors(rows) {
  const totals = new Map();
  for (const row of rows) {
    const key = `${row.family} ${row.milestone}`;
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  const seen = new Map();
  const anchors = [];
  for (const row of rows) {
    const key = `${row.family} ${row.milestone}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    const base = `milestone-${row.family}-${row.milestone.toLowerCase()}`;
    anchors.push(totals.get(key) > 1 ? `${base}-${seen.get(key)}` : base);
  }
  return anchors;
}

// RISK_ROW_BY_DOMAIN from lib/workbook.ts ({ human_welfare: "human-welfare-risk", ... }),
// so this check pairs rows and domains the way the site does. null (and a
// problem) when the file no longer has it in that shape.
function riskRowByDomain() {
  const filePath = path.resolve(here, "..", "lib", "workbook.ts");
  const source = fs.readFileSync(filePath, "utf-8");
  const block = source.match(/export const RISK_ROW_BY_DOMAIN[^{]*\{([^}]*)\}/);
  if (!block) {
    problems.push(`${path.relative(process.cwd(), filePath)} doesn't define RISK_ROW_BY_DOMAIN as an object. Update this script.`);
    return null;
  }
  const map = new Map();
  for (const pair of block[1].matchAll(/(\w+):\s*"([^"]+)"/g)) {
    map.set(pair[1], pair[2]);
  }
  return map;
}

let workbookLinkCount = 0;
if (linksReadable) {
  const stretches = columnStretches(compareHtml);
  const links = internalLinks(compareHtml, "/compare/");
  const expected = [];

  // Category panels: the key is the category with hyphens (compareCategoryKey).
  const assessments = scorecard.milestone_assessments ?? [];
  const anchors = milestoneAnchors(assessments);
  assessments.forEach((row, index) => {
    expected.push([row.category.replace(/_/g, "-"), row.family, anchors[index]]);
  });

  // Risk row panels: the key is the row's id.
  const rowByDomain = riskRowByDomain();
  if (rowByDomain !== null) {
    for (const technology of technologies) {
      for (const risk of scorecard.risks ?? []) {
        const rowId = rowByDomain.get(risk.domain);
        const row = technology.scorecard.find((item) => item.id === rowId);
        if (!risk.families.includes(technology.id) || !row || row.applicable === false) {
          continue;
        }
        expected.push([row.id, technology.id, `risk-${risk.id.toLowerCase()}`]);
      }
    }
  }

  for (const [panelKey, technologyId, target] of expected) {
    if (columnHasLink(stretches, links, panelKey, technologyId, target)) {
      workbookLinkCount += 1;
    }
  }
}

if (problems.length > 0) {
  console.error(`check-compare-links found ${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
  for (const line of problems) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}

console.log(
  `check-compare-links: OK. ${techLinkCount} links to technology pages, ${timelineLinkCount} to the timeline ` +
    `and ${otherLinkCount} to other pages' #ids on /compare/, ${dimensionLinkCount} links to a compare ` +
    `dimension, ${columnLinkCount} column links to their own rating card or section, ${workbookLinkCount} ` +
    `column links to their own milestone rows and risks, and the scorecard ids on ${technologyIds.size} ` +
    `technology pages.`,
);
