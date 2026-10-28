"""The gold-set eval: reading the file, fetching, and the numbers in the report."""

from pathlib import Path

import pytest
from fakes import FakeAnthropic, message, no_json, triage_json
from sf_shared.enums import Technology

from sf_pipeline.collectors.base import CollectedPaper
from sf_pipeline.eval import GOLD_COLUMNS, GoldFileError, build_report, fetch_papers, format_report, main, read_gold, run_eval
from sf_pipeline.triage import TriageSettings, load_prompt

SHIPPED_GOLD = Path(__file__).resolve().parents[1] / "eval" / "gold_v1.csv"
HEADER = ",".join(GOLD_COLUMNS)


def write_gold(tmp_path: Path, rows: list[str]) -> Path:
    path = tmp_path / "gold.csv"
    path.write_text("\n".join([HEADER, *rows]) + "\n", encoding="utf-8")
    return path


def test_the_shipped_gold_file_has_the_header_and_only_example_rows():
    assert SHIPPED_GOLD.read_text(encoding="utf-8").splitlines()[0] == HEADER
    items, examples = read_gold(SHIPPED_GOLD)
    assert items == [] and examples == 3


def test_rows_are_parsed(tmp_path):
    path = write_gold(
        tmp_path,
        [
            "2411.18526v2,NeuroAI for AI Safety,relevant,argument,neuromorphic;bci,alignment,false,dev",
            "https://doi.org/10.3389/fnhum.2022.806517,ErrP in RL,not_relevant,,,,TRUE,holdout",
        ],
    )
    items, examples = read_gold(path)
    assert examples == 0
    first, second = items
    assert first.arxiv_id == "2411.18526" and first.doi is None
    assert first.technology == frozenset({Technology.NEUROMORPHIC, Technology.BCI})
    assert first.is_relevant and not first.is_near_miss
    assert second.doi == "10.3389/fnhum.2022.806517" and second.is_near_miss and second.split == "holdout"


def test_every_bad_row_is_reported_by_row_number(tmp_path):
    path = write_gold(
        tmp_path,
        [
            "not-an-id,Title,relevant,argument,bci,alignment,false,dev",
            "2411.18526,Title,maybe,opinion,brains,ethics,perhaps,train",
        ],
    )
    with pytest.raises(GoldFileError) as raised:
        read_gold(path)
    message_text = str(raised.value)
    assert "row 2: id" in message_text
    assert "row 3: label" in message_text and "row 3: kind" in message_text and "row 3: unknown technology" in message_text
    assert "row 3: split" in message_text and "row 3: is_near_miss" in message_text


def test_a_missing_column_is_reported(tmp_path):
    path = tmp_path / "gold.csv"
    path.write_text("id,title,label\n", encoding="utf-8")
    with pytest.raises(GoldFileError, match="missing the column"):
        read_gold(path)


def test_papers_the_databases_do_not_return_fall_back_to_the_title(tmp_path):
    path = write_gold(
        tmp_path,
        [
            "2610.11111,Found on arXiv,relevant,argument,bci,alignment,false,dev",
            "10.1000/missing,Not found anywhere,not_relevant,,,,false,dev",
        ],
    )
    items, _ = read_gold(path)
    found = CollectedPaper(
        collector="arxiv", query_label="", title="Real title", authors=[], year=2026, published=None,
        url="https://arxiv.org/abs/2610.11111", arxiv_id="2610.11111", abstract="Real abstract.",
    )
    papers = fetch_papers(items, lambda ids: [found], lambda dois: [])
    assert papers["2610.11111"].abstract == "Real abstract." and papers["2610.11111"].title == "Real title"
    assert papers["10.1000/missing"].abstract is None and papers["10.1000/missing"].title == "Not found anywhere"


def test_report_numbers(tmp_path, content_dir):
    path = write_gold(
        tmp_path,
        [
            "2610.00001,Caught,relevant,argument,bci,alignment,false,dev",
            "2610.00002,Missed,relevant,argument,bci,alignment,false,dev",
            "2610.00003,Holdout,relevant,milestone_evidence,wbe,,false,holdout",
            "2610.00004,Near miss let through,not_relevant,,,,true,dev",
            "2610.00005,Near miss rejected,not_relevant,,,,true,dev",
        ],
    )
    items, _ = read_gold(path)
    papers = fetch_papers(items, lambda ids: [], lambda dois: [])
    answers = {
        "Caught": triage_json("yes", quote="Caught"),
        "Missed": no_json("Missed"),
        "Holdout": triage_json("yes", kind="milestone_evidence", technology=["wbe"], problem=None, claim_directions=[], quote="Holdout"),
        "Near miss let through": triage_json("unsure", kind=None, quote="Near miss"),
        "Near miss rejected": no_json("Near miss"),
    }

    def reply(call):
        title = call["messages"][0]["content"].split("<title>")[1].split("</title>")[0]
        return message(answers[title])

    prompt = load_prompt(content_dir)
    runs, finished = run_eval(
        FakeAnthropic(reply), prompt, items, papers, TriageSettings(model="claude-haiku-5-5", effort="low"),
        reps=2, max_cost_usd=1.0, progress=lambda line: None,
    )
    assert finished and len(runs) == 10

    report = build_report(runs, reps=2)
    assert [rate.text() for rate in report.recall_by_rep["dev"]] == ["50% (1/2)", "50% (1/2)"]
    assert [rate.text() for rate in report.recall_by_rep["holdout"]] == ["100% (1/1)", "100% (1/1)"]
    # Passed on: Caught, Holdout and one near miss, each rep. Two of those three are relevant.
    assert report.precision.hits == 4 and report.precision.total == 6
    assert report.near_misses_passed.text() == "50% (2/4)"
    assert report.kind.text() == "100% (4/4)"
    assert report.technology.text() == "100% (4/4)"
    assert report.problem.text() == "100% (2/2)"
    assert report.missed == {"2610.00002": 2}
    assert report.refusals.hits == 0 and report.first_reply_valid.text() == "100% (10/10)"
    assert report.calls == 10 and report.cost_usd > 0

    text = format_report(report, {item.id: item.title for item in items}, finished)
    assert "below the 90% target" in text
    assert "2x  2610.00002  Missed" in text


def test_the_eval_stops_at_its_cost_limit(tmp_path, content_dir):
    path = write_gold(tmp_path, [f"2610.0000{n},Paper {n},relevant,argument,bci,alignment,false,dev" for n in range(1, 4)])
    items, _ = read_gold(path)
    papers = fetch_papers(items, lambda ids: [], lambda dois: [])
    runs, finished = run_eval(
        FakeAnthropic(lambda call: message(triage_json(quote="Paper"))), load_prompt(content_dir), items, papers,
        TriageSettings(model="claude-haiku-5-5", effort="low"), reps=3, max_cost_usd=0.0005, progress=lambda line: None,
    )
    assert not finished and len(runs) == 2


def test_main_with_only_example_rows_says_there_is_nothing_to_test(capsys, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert main(["--gold", str(SHIPPED_GOLD)]) == 1
    output = capsys.readouterr().out
    assert "Skipped 3 example rows" in output and "no gold papers to test yet" in output
