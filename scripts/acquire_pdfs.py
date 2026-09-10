#!/usr/bin/env python3
"""Re-acquire the full lumen paper library on any machine.

Reads src/data/catalog.json, downloads every freely-available PDF from its
canonical source into an AI_papers/ tree (same layout the app's import
expects), and optionally zips it for one-tap import on iPad.

Usage:
    pip install requests
    python scripts/acquire_pdfs.py                 # -> ./AI_papers
    python scripts/acquire_pdfs.py --out ~/papers --zip --skip-books

Notes:
  * Only open-access material is downloaded (arXiv, ACL, NeurIPS, NIST, ...).
    Commercial books in the catalog are skipped automatically.
  * Resumable: existing valid files are skipped, so re-running is cheap.
  * A few hosts block scripts; those have working fallbacks baked in below.
"""

import argparse
import json
import os
import re
import sys
import time
import zipfile

try:
    import requests
except ImportError:
    sys.exit("please `pip install requests` first")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Accept": "application/pdf,*/*;q=0.8",
}

# Hosts that 403/challenge scripts -> equivalent open URLs that work headlessly.
FALLBACKS = {
    # AROSICS: MDPI blocks bots; the asset host does not.
    "https://www.mdpi.com/2072-4292/9/7/676/pdf": (
        "https://res.mdpi.com/remotesensing/remotesensing-09-00676/article_deploy/"
        "remotesensing-09-00676.pdf"
    ),
    # EU AI Act: EUR-Lex challenges bots; the Publications Office CELLAR endpoint
    # serves the official OJ PDF via content negotiation.
    "https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202401689": (
        "http://publications.europa.eu/resource/celex/32024R1689"
    ),
    # Physics-informed ML: Nature PDF is paywalled; green OA copy at OSTI.
    "https://www.nature.com/articles/s42254-021-00314-5.pdf": (
        "https://www.osti.gov/servlets/purl/2282016"
    ),
}

# Free books whose catalog "pdfUrl" column is a companion page, not a PDF.
BOOK_URLS = {
    "Mathematics_for_Machine_Learning_2020.pdf": "https://mml-book.github.io/book/mml-book.pdf",
    "Probabilistic_ML_Introduction_Murphy_2022.pdf": "https://github.com/probml/pml-book/releases/latest/download/book1.pdf",
    "Probabilistic_ML_Advanced_Topics_Murphy_2023.pdf": "https://github.com/probml/pml2-book/releases/latest/download/book2.pdf",
    "Dive_into_Deep_Learning_2023.pdf": "https://d2l.ai/d2l-en.pdf",
    # UDL releases move; resolved dynamically below.
    "Understanding_Deep_Learning_Prince_2023.pdf": "UDL_DYNAMIC",
}


def resolve_udl(session):
    """The UDL book PDF lives in a versioned GitHub release; find the current one."""
    js = session.get("https://udlbook.github.io/udlbook/", timeout=30).text
    m = re.search(r'src="(/udlbook/assets/[^"]+\.js)"', js)
    if m:
        bundle = session.get(f"https://udlbook.github.io{m.group(1)}", timeout=30).text
        m2 = re.search(
            r"https://github\.com/udlbook/udlbook/releases/download/[^\"']+\.pdf", bundle
        )
        if m2:
            return m2.group(0)
    return None


def pick_url(item):
    url = item.get("pdfUrl") or item.get("pageUrl") or ""
    m = re.search(r"arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5})", url)
    if m:
        return f"https://arxiv.org/pdf/{m.group(1)}"
    return FALLBACKS.get(url, url)


def download(session, url, dest, extra_headers=None):
    r = session.get(url, timeout=120, allow_redirects=True, headers=extra_headers or {})
    if r.status_code != 200 or not r.content.startswith(b"%PDF"):
        return f"HTTP {r.status_code}" if r.status_code != 200 else "not a PDF"
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as fh:
        fh.write(r.content)
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="AI_papers", help="output directory (default: ./AI_papers)")
    ap.add_argument("--zip", action="store_true", help="also produce AI_papers_import.zip")
    ap.add_argument("--skip-books", action="store_true", help="papers only (~350 MB vs ~900 MB)")
    args = ap.parse_args()

    catalog_path = os.path.join(os.path.dirname(__file__), "..", "src", "data", "catalog.json")
    with open(catalog_path) as fh:
        catalog = json.load(fh)

    session = requests.Session()
    session.headers.update(HEADERS)

    jobs = []
    for coll in catalog["collections"]:
        for item in coll["items"]:
            f = item.get("pdfFile")
            if not f:
                continue
            if coll["id"] == "lib":
                if args.skip_books:
                    continue
                url = BOOK_URLS.get(f)
                if url == "UDL_DYNAMIC":
                    url = resolve_udl(session)
                if not url:
                    continue
            else:
                url = pick_url(item)
            jobs.append((url, os.path.join(args.out, item["pdfDir"], f)))

    print(f"{len(jobs)} PDFs to acquire -> {os.path.abspath(args.out)}")
    ok = skipped = 0
    failures = []
    for i, (url, dest) in enumerate(jobs, 1):
        name = os.path.basename(dest)
        if os.path.exists(dest) and os.path.getsize(dest) > 10_000:
            skipped += 1
            continue
        extra = {"Accept": "application/pdf", "Accept-Language": "eng"} if "publications.europa.eu" in url else None
        err = download(session, url, dest, extra)
        if err:
            failures.append((name, url, err))
            print(f"[{i}/{len(jobs)}] FAIL {name}: {err}")
        else:
            ok += 1
            print(f"[{i}/{len(jobs)}] ok   {name}")
        time.sleep(1.0 if "arxiv.org" in url else 0.2)

    print(f"\ndownloaded {ok}, already present {skipped}, failed {len(failures)}")
    for name, url, err in failures:
        print(f"  {name}  {err}  {url}")

    if args.zip:
        zip_path = f"{args.out.rstrip('/')}_import.zip"
        print(f"writing {zip_path} …")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as zf:
            for root, _dirs, files in os.walk(args.out):
                for f in sorted(files):
                    if f.endswith(".pdf"):
                        p = os.path.join(root, f)
                        zf.write(p, os.path.relpath(p, os.path.dirname(args.out) or "."))
        print("done — import this zip in lumen → Settings → PDF library")

    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
