#!/usr/bin/env python3
"""Rebuild search-index.json from every .html in the site root.

Usage: run from the repo root. Needs beautifulsoup4.

    pip install --user beautifulsoup4
    python3 build-search-index.py

Also runs automatically on every push via .github/workflows/search-index.yml.
"""
import json
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup

# Resolve the site root relative to this script so running `python3 path/to/
# build-search-index.py` works whatever the CWD is.
SITE = Path(__file__).resolve().parent

SECTION_PREFIXES = [
    ("post-exploitation-", "post-exploitation"),
    ("pre-exploitation-", "pre-exploitation"),
    ("exploitation-", "exploitation"),
    ("enumeration-", "enumeration"),
    ("methodology-", "methodology"),
    ("tools-", "tools & utilities"),
    ("other-", "other"),
]

HUB_LABELS = {
    "index.html": "home",
    "methodology.html": "methodology",
    "enumeration.html": "enumeration",
    "pre-exploitation.html": "pre-exploitation",
    "exploitation.html": "exploitation",
    "post-exploitation.html": "post-exploitation",
    "tools-utilities.html": "tools & utilities",
    "tools-reference.html": "tools & utilities",
    "other.html": "other",
}


def section_for(name: str) -> str:
    if name in HUB_LABELS:
        return HUB_LABELS[name]
    for prefix, label in SECTION_PREFIXES:
        if name.startswith(prefix):
            return label
    return ""


def clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def extract(path: Path) -> dict:
    html = path.read_text(encoding="utf-8")
    soup = BeautifulSoup(html, "html.parser")

    main = soup.find("main")
    hero_h1 = soup.select_one(".cs-hero h1") or (main and main.find("h1"))
    if hero_h1:
        title = clean_text(hero_h1.get_text(" "))
    else:
        t = soup.find("title")
        if t:
            title = clean_text(t.get_text())
            title = re.sub(r"\s+—\s+Corey Clay\s*$", "", title)
        else:
            title = path.stem

    title = title.replace("\n", " ").replace("  ", " ")

    headings = []
    if main:
        for h2 in main.find_all("h2"):
            text = clean_text(h2.get_text(" "))
            if not text:
                continue
            headings.append({"id": h2.get("id") or "", "text": text})

    return {
        "url": path.name,
        "title": title,
        "section": section_for(path.name),
        "headings": headings,
    }


def main() -> int:
    entries = []
    for p in sorted(SITE.glob("*.html")):
        try:
            entries.append(extract(p))
        except Exception as e:
            print(f"SKIP {p.name}: {e}", file=sys.stderr)

    out = SITE / "search-index.json"
    new = json.dumps(entries, ensure_ascii=False)

    old = out.read_text(encoding="utf-8") if out.exists() else ""
    if new == old:
        total_h = sum(len(e["headings"]) for e in entries)
        print(f"search-index.json unchanged ({len(entries)} pages, {total_h} headings)")
        return 0

    out.write_text(new, encoding="utf-8")
    total_h = sum(len(e["headings"]) for e in entries)
    print(f"wrote {out.name}: {len(entries)} pages, {total_h} headings, {out.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
