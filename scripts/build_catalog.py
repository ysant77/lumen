#!/usr/bin/env python3
"""Build src/data/catalog.json and src/data/roadmap.json from the roadmap workbooks.

Usage:
    python scripts/build_catalog.py /path/to/AI_papers

The workbooks are private and are NOT part of this repository; the generated
JSON (metadata only: titles, links, phases, exercises, guidance) is committed.

Identity policy:
  * An item's id is STABLE. scripts/id_registry.json maps a content slug
    (collection + short name) to its id; regeneration looks ids up there, so
    reordering rows in Excel never renumbers existing ids. New items receive
    the next free id in their collection.
  * If an id ever must change, add old->new to scripts/id_aliases.json; the
    app migrates local user data once at startup (see src/lib/migrate.ts).
"""

import json
import os
import re
import sys
from datetime import date

import openpyxl

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
REGISTRY_PATH = os.path.join(SCRIPTS_DIR, "id_registry.json")
ALIASES_PATH = os.path.join(SCRIPTS_DIR, "id_aliases.json")


def slug(s, maxlen=60):
    s = re.sub(r"[^\w\s\-\+\.]", "", str(s))
    s = re.sub(r"[\s\.]+", "_", s.strip())
    return s[:maxlen].strip("_")


def content_slug(collection_id, short_name):
    s = str(short_name).lower().replace("+", "plus")  # SatMAE vs SatMAE++ etc.
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return f"{collection_id}:{s}"


class IdRegistry:
    """content slug -> stable id; never renumbers, appends new ids."""

    def __init__(self):
        self.map = {}
        if os.path.exists(REGISTRY_PATH):
            with open(REGISTRY_PATH) as fh:
                self.map = json.load(fh)

    def resolve(self, collection_id, short_name, positional_id):
        key = content_slug(collection_id, short_name)
        if key in self.map:
            return self.map[key]
        existing = set(self.map.values())
        candidate = positional_id
        n = int(positional_id.split("-")[1])
        while candidate in existing:
            n += 1
            candidate = f"{collection_id}-{n:02d}"
        self.map[key] = candidate
        return candidate

    def save(self):
        with open(REGISTRY_PATH, "w") as fh:
            json.dump(dict(sorted(self.map.items())), fh, indent=1)


def phase_dir(phase):
    m = re.match(r"(\d+)\.\s*(.*)", str(phase))
    return f"{m.group(1)}_{slug(m.group(2))}" if m else slug(phase)


def header_map(rows):
    for i, r in enumerate(rows):
        if r and any(c and "URL" in str(c) for c in r):
            return i, {str(c).strip(): j for j, c in enumerate(r) if c}
    raise RuntimeError("header row not found")


def cell(r, hdr, name):
    j = hdr.get(name)
    if j is None or j >= len(r):
        return None
    v = r[j]
    return v.strip() if isinstance(v, str) else v


def load_rows(base, fname, sheet):
    wb = openpyxl.load_workbook(os.path.join(base, fname))
    rows = list(wb[sheet].iter_rows(values_only=True))
    hi, hdr = header_map(rows)
    return hdr, [r for r in rows[hi + 1:] if r and any(v is not None for v in r)]


def pdf_path(base, top, phase, order, short, year):
    d = os.path.join(top, phase_dir(phase))
    f = f"{int(order):02d}_{slug(short)}_{year}.pdf"
    return (d, f) if os.path.exists(os.path.join(base, d, f)) else (d, None)


def build(base):
    collections = []

    # ---- LLM papers ----
    hdr, rows = load_rows(base, "LLM_AI_Paper_Reading_Roadmap.xlsx", "Paper Roadmap")
    items = []
    for r in rows:
        order = cell(r, hdr, "Suggested Order")
        if order is None:
            continue
        phase = cell(r, hdr, "Phase")
        short = cell(r, hdr, "Paper / Short Name")
        year = cell(r, hdr, "Year")
        d, f = pdf_path(base, "01_LLM_AI_Papers", phase, order, short, year)
        items.append({
            "id": REGISTRY.resolve("llm", short, f"llm-{int(order):02d}"),
            "slug": content_slug("llm", short),
            "order": int(order),
            "phase": phase,
            "shortName": short,
            "title": cell(r, hdr, "Full Title"),
            "year": year,
            "authors": cell(r, hdr, "Authors / Org"),
            "category": cell(r, hdr, "Category"),
            "difficulty": cell(r, hdr, "Difficulty"),
            "priority": cell(r, hdr, "Priority"),
            "readDepth": cell(r, hdr, "Read Depth"),
            "why": cell(r, hdr, "Why It Matters"),
            "exercise": cell(r, hdr, "Hands-on Exercise"),
            "pageUrl": cell(r, hdr, "Paper Page URL"),
            "pdfUrl": cell(r, hdr, "Direct PDF URL"),
            "pdfFile": f,
            "pdfDir": d,
        })
    collections.append({
        "id": "llm", "icon": "brain",
        "title": "LLM & AI Research",
        "subtitle": "Foundations, block anatomy, alignment, systems, reasoning, frontier architectures",
        "items": items,
    })

    # ---- CV / SAR / EO papers ----
    hdr, rows = load_rows(base, "Computer_Vision_SAR_EO_Roadmap.xlsx", "Paper Roadmap")
    items = []
    for r in rows:
        order = cell(r, hdr, "Order")
        if order is None:
            continue
        phase = cell(r, hdr, "Phase")
        short = cell(r, hdr, "Short Name")
        year = cell(r, hdr, "Year")
        d, f = pdf_path(base, "02_Computer_Vision_SAR_EO", phase, order, short, year)
        items.append({
            "id": REGISTRY.resolve("cv", short, f"cv-{int(order):02d}"),
            "slug": content_slug("cv", short),
            "order": int(order),
            "phase": phase,
            "shortName": short,
            "title": cell(r, hdr, "Title"),
            "year": year,
            "resourceType": cell(r, hdr, "Resource Type"),
            "difficulty": cell(r, hdr, "Difficulty"),
            "priority": cell(r, hdr, "Priority"),
            "relevance": {
                "coreg": cell(r, hdr, "Co-reg Relevance (0-3)"),
                "forecast": cell(r, hdr, "Forecast Relevance (0-3)"),
                "sar": cell(r, hdr, "SAR Relevance (0-3)"),
            },
            "why": cell(r, hdr, "Why It Matters"),
            "exercise": cell(r, hdr, "Hands-on / Experiment"),
            "pageUrl": cell(r, hdr, "Resource Page URL"),
            "pdfUrl": cell(r, hdr, "Direct PDF URL"),
            "pdfFile": f,
            "pdfDir": d,
        })
    collections.append({
        "id": "cv", "icon": "satellite",
        "title": "Computer Vision, SAR & Earth Observation",
        "subtitle": "Vision foundations, SSL, registration, multimodal EO, SAR physics, forecasting",
        "items": items,
    })

    # ---- Regulated AI ----
    hdr, rows = load_rows(base, "Regulated_AI_Law_Banking_Roadmap.xlsx", "Roadmap")
    items = []
    for r in rows:
        order = cell(r, hdr, "Order")
        if order is None:
            continue
        phase = cell(r, hdr, "Phase")
        short = cell(r, hdr, "Short Name")
        year = cell(r, hdr, "Year")
        d, f = pdf_path(base, "03_Regulated_AI_Law_Banking", phase, order, short, year)
        items.append({
            "id": REGISTRY.resolve("reg", short, f"reg-{int(order):02d}"),
            "slug": content_slug("reg", short),
            "order": int(order),
            "phase": phase,
            "shortName": short,
            "title": cell(r, hdr, "Title"),
            "year": year,
            "domain": cell(r, hdr, "Domain"),
            "resourceType": cell(r, hdr, "Resource Type"),
            "difficulty": cell(r, hdr, "Difficulty"),
            "priority": cell(r, hdr, "Priority"),
            "relevance": {
                "law": cell(r, hdr, "Law Relevance (0-3)"),
                "bank": cell(r, hdr, "Bank Relevance (0-3)"),
            },
            "why": cell(r, hdr, "Why It Matters"),
            "exercise": cell(r, hdr, "Hands-on / Output"),
            "pageUrl": cell(r, hdr, "Resource Page URL"),
            "pdfUrl": cell(r, hdr, "Direct PDF URL"),
            "pdfFile": f,
            "pdfDir": d,
        })
    collections.append({
        "id": "reg", "icon": "scale",
        "title": "Regulated AI: Law & Banking",
        "subtitle": "Domain data, evaluation, uncertainty, privacy, governance, operational controls",
        "items": items,
    })

    # ---- Books & courses ----
    hdr, rows = load_rows(base, "AI_ML_Books_Courses_Tutorials_Roadmap.xlsx", "Learning Roadmap")
    book_pdfs = {
        "Mathematics for Machine Learning": "Mathematics_for_Machine_Learning_2020.pdf",
        "Probabilistic Machine Learning: An Introduction": "Probabilistic_ML_Introduction_Murphy_2022.pdf",
        "Probabilistic Machine Learning: Advanced Topics": "Probabilistic_ML_Advanced_Topics_Murphy_2023.pdf",
        "Understanding Deep Learning": "Understanding_Deep_Learning_Prince_2023.pdf",
        "Dive into Deep Learning": "Dive_into_Deep_Learning_2023.pdf",
    }
    items = []
    for r in rows:
        order = cell(r, hdr, "Order")
        if order is None:
            continue
        name = cell(r, hdr, "Resource")
        f = book_pdfs.get(name)
        if f and not os.path.exists(os.path.join(base, "04_Books_and_Course_Materials", f)):
            f = None
        items.append({
            "id": REGISTRY.resolve("lib", name, f"lib-{int(order):02d}"),
            "slug": content_slug("lib", name),
            "order": int(order),
            "phase": cell(r, hdr, "Phase"),
            "shortName": name,
            "title": name,
            "year": cell(r, hdr, "Year"),
            "authors": cell(r, hdr, "Author / Provider"),
            "resourceType": cell(r, hdr, "Resource Type"),
            "difficulty": cell(r, hdr, "Difficulty"),
            "priority": cell(r, hdr, "Priority"),
            "effort": cell(r, hdr, "Suggested Effort"),
            "focus": cell(r, hdr, "Primary Focus"),
            "why": cell(r, hdr, "Why It Is Worth Your Time"),
            "exercise": cell(r, hdr, "What To Actually Complete"),
            "pageUrl": cell(r, hdr, "Main URL"),
            "pdfUrl": cell(r, hdr, "Companion / Video URL"),
            "pdfFile": f,
            "pdfDir": "04_Books_and_Course_Materials" if f else None,
        })
    collections.append({
        "id": "lib", "icon": "book",
        "title": "Books, Courses & Tutorials",
        "subtitle": "Math refresh, DL core, vision, GPU systems, SAR/EO, trustworthy AI",
        "items": items,
    })

    for c in collections:
        phases = []
        for it in c["items"]:
            if it["phase"] not in phases:
                phases.append(it["phase"])
        c["phases"] = phases

    return {
        "version": 1,
        "generatedAt": date.today().isoformat(),
        "collections": collections,
    }


# ---------------------------------------------------------------------------
# roadmap.json: overview guidance, capstones, mission references, 16-week plan
# ---------------------------------------------------------------------------

def sheet_rows(base, fname, sheet):
    wb = openpyxl.load_workbook(os.path.join(base, fname))
    if sheet not in wb.sheetnames:
        return []
    return [
        [c.strip() if isinstance(c, str) else c for c in row]
        for row in wb[sheet].iter_rows(values_only=True)
    ]


def parse_overview(rows):
    """Extract phase purposes + long 'how to use' guidance bullets."""
    phases, guidance = [], []
    header_idx = None
    for i, r in enumerate(rows):
        cells = [str(c) for c in r if c]
        if r and r[0] == "Phase":
            header_idx = i
            continue
        if header_idx is not None and i > header_idx and r and r[0]:
            name = str(r[0])
            if re.match(r"^\d+\.", name):
                purpose = next((str(c) for c in r[2:] if c and len(str(c)) > 5), "")
                phases.append({"name": name, "purpose": purpose})
        for c in cells:
            if len(c) > 120 and ("•" in c or "\n" in c or c.count(")") >= 3):
                for line in re.split(r"\n|(?<=\.)\s*•\s*", c):
                    line = line.strip("•– ").strip()
                    if len(line) > 15:
                        guidance.append(line)
    # de-dup, keep order
    seen, out = set(), []
    for g in guidance:
        if g not in seen:
            seen.add(g)
            out.append(g)
    return phases, out


def parse_table(rows, first_header):
    """Parse a header-driven table (capstones / mission refs / starter plan)."""
    out = []
    header = None
    for r in rows:
        if r and str(r[0] or "") == first_header:
            header = [str(c) if c else "" for c in r]
            continue
        if header and r and r[0] is not None:
            entry = {}
            for k, v in zip(header, r):
                if k and v is not None:
                    entry[k] = str(v) if not isinstance(v, (int, float)) else v
            if len(entry) >= 2:
                out.append(entry)
    return out


def build_roadmap(base):
    aliases = {}
    if os.path.exists(ALIASES_PATH):
        with open(ALIASES_PATH) as fh:
            aliases = json.load(fh)

    coll_meta = {
        "llm": ("LLM_AI_Paper_Reading_Roadmap.xlsx", None),
        "cv": ("Computer_Vision_SAR_EO_Roadmap.xlsx", "Capstones"),
        "reg": ("Regulated_AI_Law_Banking_Roadmap.xlsx", "Capstones"),
        "lib": ("AI_ML_Books_Courses_Tutorials_Roadmap.xlsx", None),
    }
    collections, capstones = {}, {}
    for cid, (fname, capstone_sheet) in coll_meta.items():
        phases, guidance = parse_overview(sheet_rows(base, fname, "Overview"))
        collections[cid] = {"phases": phases, "guidance": guidance}
        if capstone_sheet:
            caps = parse_table(sheet_rows(base, fname, capstone_sheet), "#")
            capstones[cid] = caps

    mission_refs = parse_table(
        sheet_rows(base, "Computer_Vision_SAR_EO_Roadmap.xlsx", "Mission References"), "Mission"
    )
    starter = parse_table(
        sheet_rows(base, "AI_ML_Books_Courses_Tutorials_Roadmap.xlsx", "16-Week Starter"), "Window"
    )

    return {
        "version": 1,
        "generatedAt": date.today().isoformat(),
        "idAliases": aliases,
        "collections": collections,
        "capstones": capstones,
        "missionRefs": mission_refs,
        "starterWindows": starter,
    }


if __name__ == "__main__":
    base = sys.argv[1] if len(sys.argv) > 1 else "."
    REGISTRY = IdRegistry()
    catalog = build(base)
    REGISTRY.save()
    data_dir = os.path.join(os.path.dirname(__file__), "..", "src", "data")
    with open(os.path.join(data_dir, "catalog.json"), "w") as fh:
        json.dump(catalog, fh, indent=1, ensure_ascii=False)
    roadmap = build_roadmap(base)
    with open(os.path.join(data_dir, "roadmap.json"), "w") as fh:
        json.dump(roadmap, fh, indent=1, ensure_ascii=False)
    n = sum(len(c["items"]) for c in catalog["collections"])
    withpdf = sum(1 for c in catalog["collections"] for i in c["items"] if i["pdfFile"])
    caps = sum(len(v) for v in roadmap["capstones"].values())
    print(f"catalog.json: {n} items ({withpdf} with local PDFs); registry: {len(REGISTRY.map)} ids")
    print(
        f"roadmap.json: guidance for {len(roadmap['collections'])} collections, "
        f"{caps} capstones, {len(roadmap['missionRefs'])} mission refs, "
        f"{len(roadmap['starterWindows'])} starter windows"
    )
else:
    REGISTRY = IdRegistry()
