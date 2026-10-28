"""Dedupe: identifiers first, then title plus year, against the database and the site's sources."""

from fakes import insert_candidate, paper

from sf_pipeline.dedupe import apply_dedupe, load_site_sources, merge_within_run, plan_dedupe


def run_dedupe(db, papers, content_dir):
    plan = plan_dedupe(db, papers, load_site_sources(content_dir))
    apply_dedupe(db, plan)
    return plan


def test_new_papers_become_new_candidates(db, content_dir):
    plan = run_dedupe(db, [paper(arxiv_id="2610.11111")], content_dir)
    assert len(plan.new_candidates) == 1
    doc = db["sources"].find_one({"id": "arxiv-2610.11111"})
    assert doc["_id"] == "arxiv-2610.11111"
    assert doc["review_status"] == "new"
    assert doc["origin"] == "pipeline"
    assert doc["title_key"] == "brain computer interfaces as a channel for human feedback"
    assert doc["query_labels"] == ["Test search"]
    assert doc["flags"] == []


def test_a_paper_without_an_abstract_is_flagged_when_collected(db, content_dir):
    run_dedupe(db, [paper(arxiv_id="2610.22222", abstract=None)], content_dir)
    doc = db["sources"].find_one({"_id": "arxiv-2610.22222"})
    assert doc["review_status"] == "new"
    assert doc["flags"] == ["no_abstract"]


def test_same_paper_from_both_collectors_is_merged_in_the_run(db, content_dir):
    from_s2 = paper(collector="semantic_scholar", s2_id="s2aaa", arxiv_id="2610.11111", doi="10.1/x", label="Search B", abstract=None)
    from_arxiv = paper(arxiv_id="2610.11111", label="Search A")
    merged, folded = merge_within_run([from_s2, from_arxiv])

    assert folded == 1
    assert len(merged) == 1
    combined = merged[0].paper
    assert combined.collector == "arxiv"  # arXiv's copy wins
    assert combined.abstract is not None
    assert combined.s2_id == "s2aaa" and combined.doi == "10.1/x"
    assert merged[0].query_labels == ["Search B", "Search A"]


def test_match_by_doi_arxiv_or_s2_id_is_not_added_again(db, content_dir):
    insert_candidate(db, paper(arxiv_id="2610.11111", doi="10.1/a"))
    insert_candidate(db, paper(collector="semantic_scholar", s2_id="s2bbb", title="Another title", arxiv_id=None))

    plan = run_dedupe(
        db,
        [
            paper(collector="semantic_scholar", s2_id="s2new", doi="10.1/a", arxiv_id=None, title="Different wording"),
            paper(arxiv_id="2610.11111", title="Changed title"),
            paper(collector="semantic_scholar", s2_id="s2bbb", arxiv_id=None, title="Another title"),
        ],
        content_dir,
    )
    assert plan.new_candidates == []
    assert plan.duplicates == 3
    assert db["sources"].count_documents({}) == 2


def test_a_duplicate_gets_the_new_search_label_and_missing_ids(db, content_dir):
    insert_candidate(db, paper(arxiv_id="2610.11111", label="First search"))
    run_dedupe(
        db,
        [paper(collector="semantic_scholar", arxiv_id="2610.11111", s2_id="s2aaa", doi="10.1/a", label="Second search")],
        content_dir,
    )
    doc = db["sources"].find_one({"id": "arxiv-2610.11111"})
    assert doc["query_labels"] == ["First search", "Second search"]
    assert doc["s2_id"] == "s2aaa"
    assert doc["doi"] == "10.1/a"


def test_an_existing_identifier_is_never_overwritten(db, content_dir):
    insert_candidate(db, paper(arxiv_id="2610.11111", doi="10.1/original"))
    run_dedupe(db, [paper(collector="semantic_scholar", arxiv_id="2610.11111", s2_id="s2aaa", doi="10.1/other")], content_dir)
    assert db["sources"].find_one({"id": "arxiv-2610.11111"})["doi"] == "10.1/original"


def test_title_and_year_match_is_flagged_not_dropped(db, content_dir):
    insert_candidate(db, paper(arxiv_id="2610.11111", title="Brain Emulation: A Roadmap", year=2026))
    plan = run_dedupe(
        db, [paper(collector="semantic_scholar", s2_id="s2zzz", arxiv_id=None, title="Brain emulation - a roadmap", year=2026)], content_dir
    )
    assert len(plan.new_candidates) == 1
    assert plan.possible_duplicates == 1
    assert db["sources"].find_one({"id": "s2-s2zzz"})["flags"] == ["possible_duplicate"]


def test_same_title_in_a_different_year_is_not_flagged(db, content_dir):
    insert_candidate(db, paper(arxiv_id="2610.11111", title="Alignment Perspectives", year=2023))
    plan = run_dedupe(db, [paper(arxiv_id="2610.99999", title="Alignment Perspectives", year=2026)], content_dir)
    assert plan.new_candidates[0].flags == []


def test_sources_already_on_the_site_count_as_duplicates(db, content_dir):
    plan = run_dedupe(
        db,
        [
            paper(arxiv_id="2411.18526", title="NeuroAI for AI Safety"),
            paper(collector="semantic_scholar", s2_id="s2q", arxiv_id=None, doi="10.3389/fhumd.2023.1245619"),
            paper(arxiv_id="0000.00000", title="Sample source"),  # samples don't count
        ],
        content_dir,
    )
    assert plan.duplicates == 2
    assert [candidate.arxiv_id for candidate in plan.new_candidates] == ["0000.00000"]


def test_a_site_source_with_the_same_title_is_flagged(db, content_dir):
    plan = run_dedupe(db, [paper(arxiv_id="2610.55555", title="NeuroAI for AI safety", year=2025)], content_dir)
    assert plan.new_candidates[0].flags == ["possible_duplicate"]


def test_plan_alone_writes_nothing(db, content_dir):
    plan = plan_dedupe(db, [paper(arxiv_id="2610.11111")], load_site_sources(content_dir))
    assert len(plan.new_candidates) == 1
    assert db["sources"].count_documents({}) == 0


def test_lookups_use_one_query_per_kind(db, content_dir, monkeypatch):
    """Dedupe asks the database with $in lookups, not one query per paper."""
    sources = db["sources"]
    calls = []
    original_find = sources.find

    def counting_find(*args, **kwargs):
        calls.append(args[0] if args else kwargs.get("filter"))
        return original_find(*args, **kwargs)

    monkeypatch.setattr(sources, "find", counting_find)
    papers = [paper(arxiv_id=f"2610.{10000 + number}", title=f"Paper {number}") for number in range(20)]
    plan_dedupe(db, papers, load_site_sources(content_dir))
    assert len(calls) == 2
