#!/usr/bin/env python3
"""Build src/data/catalog.json from the four roadmap workbooks.

Usage:
    python scripts/build_catalog.py /path/to/AI_papers

The workbooks are private and are NOT part of this repository; the generated
catalog.json (metadata only: titles, links, phases, exercises) is committed.
"""

import json
import os
import re
import sys
from datetime import date

import openpyxl


def slug(s, maxlen=60):
    s = re.sub(r"[^\w\s\-\+\.]", "", str(s))
    s = re.sub(r"[\s\.]+", "_", s.strip())
    return s[:maxlen].strip("_")


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
            "id": f"llm-{int(order):02d}",
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
            "id": f"cv-{int(order):02d}",
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
            "id": f"reg-{int(order):02d}",
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
            "id": f"lib-{int(order):02d}",
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


if __name__ == "__main__":
    base = sys.argv[1] if len(sys.argv) > 1 else "."
    catalog = build(base)
    out = os.path.join(os.path.dirname(__file__), "..", "src", "data", "catalog.json")
    with open(out, "w") as fh:
        json.dump(catalog, fh, indent=1, ensure_ascii=False)
    n = sum(len(c["items"]) for c in catalog["collections"])
    withpdf = sum(1 for c in catalog["collections"] for i in c["items"] if i["pdfFile"])
    print(f"catalog.json written: {n} items ({withpdf} with local PDFs) "
          f"across {len(catalog['collections'])} collections")
