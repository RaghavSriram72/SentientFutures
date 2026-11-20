import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { arxivIdFromLink, doiFromLink, isWebLink, namesItsPaper } from "../sourceLinks";

// The same cases as shared/tests/test_links.py, so the page and the API agree
// on which links name their paper.
describe("namesItsPaper", () => {
  test("links that name their paper", () => {
    const links = [
      "https://arxiv.org/abs/2411.18526",
      "https://arxiv.org/pdf/2411.18526v3",
      "https://arxiv.org/html/2602.01503v1",
      "https://arxiv.org/abs/2411.18526?context=cs",
      "https://export.arxiv.org/abs/hep-th/9901001",
      "https://doi.org/10.1002/brx2.70035",
      "https://dx.doi.org/10.1002/brx2.70035",
      "https://onlinelibrary.wiley.com/doi/full/10.1002/brx2.70035",
      "https://example.org/paper",
    ];
    for (const link of links) {
      assert.equal(namesItsPaper(link), true, link);
    }
  });

  test("doi.org and arXiv links without a paper", () => {
    const links = ["https://arxiv.org/abs/", "https://arxiv.org/pdf/", "https://arxiv.org/", "https://doi.org/", "https://doi.org/10."];
    for (const link of links) {
      assert.equal(namesItsPaper(link), false, link);
    }
  });

  test("a doi.org link with a port names its paper, as names_its_paper says", () => {
    assert.equal(isWebLink("https://doi.org:443/10.1000/xyz"), true);
    assert.equal(namesItsPaper("https://doi.org:443/10.1000/xyz"), true);
    assert.equal(namesItsPaper("https://dx.doi.org:8443/10.1000/x"), true);
    assert.equal(namesItsPaper("https://doi.org:443/"), false);
  });

  test("a DOI anywhere in a doi.org link counts, as normalize_doi searches the whole text", () => {
    assert.equal(namesItsPaper("https://doi.org/foo?x=10.1000/abc"), true);
    assert.equal(namesItsPaper("https://DOI.org/10.1000/ABC"), true);
  });
});

describe("doiFromLink", () => {
  test("a doi.org link fills in its DOI, in lowercase, without trailing punctuation", () => {
    assert.equal(doiFromLink("https://doi.org/10.1002/BRX2.70035"), "10.1002/brx2.70035");
    assert.equal(doiFromLink("http://dx.doi.org/10.1002/brx2.70035)."), "10.1002/brx2.70035");
  });

  test("only a link that starts with a doi.org prefix fills it in, as is_doi_link says", () => {
    assert.equal(doiFromLink("https://doi.org:443/10.1000/xyz"), "");
    assert.equal(doiFromLink("https://onlinelibrary.wiley.com/doi/full/10.1002/brx2.70035"), "");
    assert.equal(doiFromLink("https://doi.org/"), "");
  });
});

describe("arxivIdFromLink", () => {
  test("reads the id without its version", () => {
    assert.equal(arxivIdFromLink("https://arxiv.org/pdf/2411.18526v3"), "2411.18526");
    assert.equal(arxivIdFromLink("https://export.arxiv.org/abs/hep-th/9901001"), "hep-th/9901001");
    assert.equal(arxivIdFromLink("https://example.org/paper"), "");
  });
});

// The same cases as test_working_links and test_broken_links.
describe("isWebLink", () => {
  test("working links", () => {
    const links = [
      "https://doi.org/10.1002/brx2.70035",
      "http://example.org",
      "https://www.youtube.com/watch?v=N3151oVuA7M&t=729s",
      "https://example.org:8080/paper?id=3#part-2",
      "HTTPS://Example.ORG/Paper",
      "https://例え.jp/paper",
    ];
    for (const link of links) {
      assert.equal(isWebLink(link), true, link);
    }
  });

  test("broken links", () => {
    const links = [
      "",
      "https://",
      "http://:80",
      "https://doi.org10.1234",
      "https://exa mple.com/paper",
      " https://example.org/paper",
      "example.org/paper",
      "ftp://example.org/paper",
      "https://localhost/paper",
      "https://192.168.0.1/paper",
      "https://example..org/paper",
      "https://example.org:abc/paper",
      "https://under_score.org/paper",
    ];
    for (const link of links) {
      assert.equal(isWebLink(link), false, link);
    }
  });
});
