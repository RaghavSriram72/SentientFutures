"""Read an .xlsx workbook with the standard library only (zipfile and ElementTree).

The workbook importer (import_workbook.py) uses this to read the team's
scorecard workbook. Each cell comes back as the text the workbook stores, with
three normalisations that never change the words:
  - Excel's _xHHHH_ escapes are decoded (_x000D_ is a carriage return),
  - line breaks become "\\n",
  - text is put in Unicode NFC form, so the same letter is always the same bytes.

Numbers come back as the stored text ("2023.0"), with the cell marked as a
number, so the importer decides what a number means in its own column.

It refuses what it can't read faithfully instead of guessing:
  - an error cell (#REF!, #N/A),
  - a formula saved without its computed value (re-save the file from Google
    Sheets or Excel so every formula has one),
  - a file that isn't a workbook, or is far bigger than any real one.
"""

import posixpath
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
R_ID = f"{{{OFFICE_REL_NS}}}id"
SHARED_STRINGS_TYPE = f"{OFFICE_REL_NS}/sharedStrings"

# Limits for a damaged or hostile file. The team's workbook is about 150 KB
# zipped and a few MB unzipped, so these are far above anything real.
MAX_MEMBER_BYTES = 50 * 1024 * 1024
MAX_TOTAL_BYTES = 200 * 1024 * 1024
MAX_CELLS_PER_SHEET = 500_000

CELL_REF = re.compile(r"([A-Z]{1,3})([1-9][0-9]*)")
EXCEL_ESCAPE = re.compile(r"_x([0-9A-Fa-f]{4})_")


class XlsxError(Exception):
    """The file can't be read faithfully. The message says where, and what to do about it."""


def main_tag(name: str) -> str:
    return f"{{{MAIN_NS}}}{name}"


def column_index(letters: str) -> int:
    """'A' -> 0, 'Z' -> 25, 'AA' -> 26."""
    number = 0
    for letter in letters:
        number = number * 26 + (ord(letter) - ord("A") + 1)
    return number - 1


def column_letters(index: int) -> str:
    """0 -> 'A', 26 -> 'AA'."""
    letters = ""
    number = index + 1
    while number > 0:
        number, remainder = divmod(number - 1, 26)
        letters = chr(ord("A") + remainder) + letters
    return letters


def cell_ref(row: int, column: int) -> str:
    """Row and column counted from 0 -> the sheet's own name for the cell, e.g. (2, 10) -> 'K3'."""
    return f"{column_letters(column)}{row + 1}"


def parse_cell_ref(ref: str) -> tuple[int, int]:
    match = CELL_REF.fullmatch(ref)
    if match is None:
        raise XlsxError(f'"{ref}" is not a cell reference like K3')
    return int(match.group(2)) - 1, column_index(match.group(1))


def normalise_text(text: str) -> str:
    """Decode _xHHHH_ escapes, turn every line break into \\n, and use NFC.

    One pass of the escape pattern is the spec's own rule: "_x005F_x0041_" is
    an escaped underscore followed by the literal text "x0041_".
    """
    text = EXCEL_ESCAPE.sub(lambda match: chr(int(match.group(1), 16)), text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return unicodedata.normalize("NFC", text)


@dataclass
class Sheet:
    """One worksheet. Rows and columns count from 0; cell_ref() gives the sheet's own names."""

    name: str
    hidden: bool
    cells: dict[tuple[int, int], str] = field(default_factory=dict)  # only cells with text
    numbers: set[tuple[int, int]] = field(default_factory=set)  # cells the file stores as numbers
    links: dict[tuple[int, int], str] = field(default_factory=dict)  # hyperlink targets from the sheet's rels
    merged: list[str] = field(default_factory=list)  # merged ranges, e.g. "B2:K2"

    @property
    def row_count(self) -> int:
        if not self.cells:
            return 0
        return max(row for row, _ in self.cells) + 1

    def value(self, row: int, column: int) -> str:
        """The cell's text, or "" for an empty cell or one past the end of the row."""
        return self.cells.get((row, column), "")

    def width(self, row: int) -> int:
        """One past the last column with text in this row."""
        columns = [column for (cell_row, column) in self.cells if cell_row == row]
        if not columns:
            return 0
        return max(columns) + 1

    def row_values(self, row: int, width: int | None = None) -> list[str]:
        """The row's cells, padded with "" to `width` (or to its last cell with text)."""
        if width is None:
            width = self.width(row)
        return [self.value(row, column) for column in range(width)]

    def is_blank_row(self, row: int) -> bool:
        for cell_row, _ in self.cells:
            if cell_row == row:
                return False
        return True


def read_member(archive: zipfile.ZipFile, name: str) -> bytes:
    try:
        info = archive.getinfo(name)
    except KeyError:
        raise XlsxError(f"{name} is missing, so this isn't a complete .xlsx workbook") from None
    if info.file_size > MAX_MEMBER_BYTES:
        raise XlsxError(f"{name} unzips to {info.file_size} bytes, far more than any real workbook")
    data = archive.read(name)
    # A workbook never needs a DOCTYPE, and refusing one rules out entity tricks.
    if b"<!DOCTYPE" in data or b"<!ENTITY" in data:
        raise XlsxError(f"{name} contains a DOCTYPE or ENTITY declaration, which a workbook never has")
    return data


def parse_member(archive: zipfile.ZipFile, name: str) -> ET.Element:
    try:
        return ET.fromstring(read_member(archive, name))
    except ET.ParseError as error:
        raise XlsxError(f"{name} is not well-formed XML ({error})") from None


def resolve_target(base_folder: str, target: str) -> str:
    """A relationship target as a path inside the zip. Targets are relative to the
    part that owns them, or absolute from the zip root when they start with "/"."""
    if target.startswith("/"):
        return target.lstrip("/")
    return posixpath.normpath(posixpath.join(base_folder, target))


def relationship_targets(archive: zipfile.ZipFile, rels_path: str) -> dict[str, tuple[str, str, str]]:
    """Relationship id -> (type, target, target mode) from a .rels part, or {} when there is none."""
    if rels_path not in archive.namelist():
        return {}
    root = parse_member(archive, rels_path)
    targets: dict[str, tuple[str, str, str]] = {}
    for relationship in root.findall(f"{{{PACKAGE_REL_NS}}}Relationship"):
        targets[relationship.get("Id", "")] = (
            relationship.get("Type", ""),
            relationship.get("Target", ""),
            relationship.get("TargetMode", "Internal"),
        )
    return targets


def string_item_text(item: ET.Element) -> str:
    """A shared or inline string: one <t>, or rich-text runs <r><t>.
    Phonetic hints (<rPh>) are reading aids, not part of the text, so they are skipped."""
    parts: list[str] = []
    for child in item:
        if child.tag == main_tag("t"):
            parts.append(child.text or "")
        elif child.tag == main_tag("r"):
            run_text = child.find(main_tag("t"))
            if run_text is not None:
                parts.append(run_text.text or "")
    return "".join(parts)


def read_shared_strings(archive: zipfile.ZipFile, workbook_rels: dict[str, tuple[str, str, str]]) -> list[str]:
    path = None
    for rel_type, target, _ in workbook_rels.values():
        if rel_type == SHARED_STRINGS_TYPE:
            path = resolve_target("xl", target)
    if path is None:
        # A workbook with no text cells has no shared strings part at all.
        return []
    root = parse_member(archive, path)
    return [string_item_text(item) for item in root.findall(main_tag("si"))]


def cell_text(cell: ET.Element, shared: list[str], where: str) -> tuple[str, bool]:
    """(text, stored as a number) for one <c> element."""
    cell_type = cell.get("t", "n")
    value = cell.find(main_tag("v"))
    formula = cell.find(main_tag("f"))
    value_text = value.text if value is not None and value.text is not None else ""

    if cell_type == "e":
        raise XlsxError(
            f"{where} holds the error {value_text or '(unknown)'}. Fix the cell in the workbook and save it again"
        )
    if formula is not None and value is None:
        raise XlsxError(
            f"{where} has a formula but no saved value. Re-save the file from Google Sheets or Excel "
            "so every formula has its computed value"
        )

    if cell_type == "s":
        if value is None:
            return "", False
        try:
            index = int(value_text)
        except ValueError:
            raise XlsxError(f"{where} points to shared string {value_text!r}, which is not a number") from None
        if index < 0 or index >= len(shared):
            raise XlsxError(f"{where} points to shared string {index}, but the file has only {len(shared)}")
        return shared[index], False
    if cell_type == "inlineStr":
        inline = cell.find(main_tag("is"))
        return (string_item_text(inline) if inline is not None else ""), False
    if cell_type == "str":
        return value_text, False
    if cell_type == "b":
        if value is None:
            return "", False
        return ("TRUE" if value_text == "1" else "FALSE"), False
    if cell_type == "d":
        return value_text, False
    if cell_type == "n":
        return value_text, value is not None and value_text != ""
    raise XlsxError(f'{where} has the cell type "{cell_type}", which this reader does not know')


def read_sheet(archive: zipfile.ZipFile, name: str, hidden: bool, path: str, shared: list[str]) -> Sheet:
    sheet = Sheet(name=name, hidden=hidden)
    root = parse_member(archive, path)
    sheet_data = root.find(main_tag("sheetData"))

    if sheet_data is not None:
        row_index = -1
        for row_element in sheet_data.findall(main_tag("row")):
            # Rows and cells may leave out their "r" attribute; they then follow the one before.
            row_attr = row_element.get("r")
            row_index = int(row_attr) - 1 if row_attr else row_index + 1
            column = -1
            for cell in row_element.findall(main_tag("c")):
                ref = cell.get("r")
                if ref:
                    ref_row, column = parse_cell_ref(ref)
                    if ref_row != row_index:
                        raise XlsxError(f"{name}!{ref} sits in row {row_index + 1} of the file")
                else:
                    column += 1
                where = f"{name}!{cell_ref(row_index, column)}"
                text, is_number = cell_text(cell, shared, where)
                text = normalise_text(text)
                if text != "":
                    sheet.cells[(row_index, column)] = text
                    if is_number:
                        sheet.numbers.add((row_index, column))
                if len(sheet.cells) > MAX_CELLS_PER_SHEET:
                    raise XlsxError(f"{name} has more than {MAX_CELLS_PER_SHEET} cells with text")

    merge_cells = root.find(main_tag("mergeCells"))
    if merge_cells is not None:
        for merge_cell in merge_cells.findall(main_tag("mergeCell")):
            sheet.merged.append(merge_cell.get("ref", ""))

    hyperlinks = root.find(main_tag("hyperlinks"))
    if hyperlinks is not None:
        folder, file_name = posixpath.split(path)
        rels = relationship_targets(archive, posixpath.join(folder, "_rels", file_name + ".rels"))
        for hyperlink in hyperlinks.findall(main_tag("hyperlink")):
            rel_id = hyperlink.get(R_ID)
            ref = hyperlink.get("ref", "")
            if not rel_id or rel_id not in rels or not ref:
                continue
            # A link over a range applies to its top-left cell, where the text is.
            sheet.links[parse_cell_ref(ref.split(":")[0])] = rels[rel_id][1]
    return sheet


def read_workbook(path: Path) -> list[Sheet]:
    """Every sheet in the workbook's own tab order, hidden ones included (marked hidden)."""
    try:
        archive = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        raise XlsxError(f"{path} is not an .xlsx file (it isn't a zip archive)") from None
    except FileNotFoundError:
        raise XlsxError(f"{path}: file not found") from None

    with archive:
        total = sum(info.file_size for info in archive.infolist())
        if total > MAX_TOTAL_BYTES:
            raise XlsxError(f"{path} unzips to {total} bytes, far more than any real workbook")

        workbook = parse_member(archive, "xl/workbook.xml")
        workbook_rels = relationship_targets(archive, "xl/_rels/workbook.xml.rels")
        # Normalised once, per cell, in read_sheet: decoding escapes twice would change the text.
        shared = read_shared_strings(archive, workbook_rels)

        sheets_element = workbook.find(main_tag("sheets"))
        if sheets_element is None:
            raise XlsxError("xl/workbook.xml lists no sheets")
        sheets: list[Sheet] = []
        for sheet_element in sheets_element.findall(main_tag("sheet")):
            name = normalise_text(sheet_element.get("name", ""))
            rel_id = sheet_element.get(R_ID, "")
            if rel_id not in workbook_rels:
                raise XlsxError(f'sheet "{name}" points to {rel_id!r}, which xl/_rels/workbook.xml.rels does not have')
            sheet_path = resolve_target("xl", workbook_rels[rel_id][1])
            hidden = sheet_element.get("state", "visible") in ("hidden", "veryHidden")
            sheets.append(read_sheet(archive, name, hidden, sheet_path, shared))
        return sheets
