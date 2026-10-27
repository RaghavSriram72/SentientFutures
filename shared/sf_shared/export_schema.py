"""Write shared/schema/enums.json from enums.py.

Run: python -m sf_shared.export_schema          (writes the file)
     python -m sf_shared.export_schema --check  (fails if the file is out of date)
"""

import json
import sys
from pathlib import Path

from sf_shared.enums import ALL_ENUMS, ENUM_INFO, RUBRIC_VERSION

OUT_PATH = Path(__file__).resolve().parent.parent / "schema" / "enums.json"


def build_enums_json() -> dict:
    enums = {}
    for name, enum_class in ALL_ENUMS.items():
        info = ENUM_INFO[name]
        values = []
        for member in enum_class:
            if member.value not in info["values"]:
                raise ValueError(f"{name}.{member.value} has no label in ENUM_INFO")
            label, description = info["values"][member.value]
            values.append({"value": member.value, "label": label, "description": description})
        if len(info["values"]) != len(values):
            raise ValueError(f"ENUM_INFO['{name}'] has labels for values that aren't in the enum")
        enums[name] = {"draft": info["draft"], "values": values}
    return {"rubric_version": RUBRIC_VERSION, "enums": enums}


def main() -> int:
    text = json.dumps(build_enums_json(), indent=2, ensure_ascii=False) + "\n"
    if "--check" in sys.argv:
        current = OUT_PATH.read_text(encoding="utf-8") if OUT_PATH.exists() else ""
        if current != text:
            print(f"{OUT_PATH} is out of date. Run: python -m sf_shared.export_schema")
            return 1
        print("enums.json is up to date")
        return 0
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(text, encoding="utf-8")
    print(f"Wrote {OUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
