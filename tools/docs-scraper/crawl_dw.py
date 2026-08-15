#!/usr/bin/env python3
"""
Download the DataWindow Reference method and event pages (PB2022 + PB2025).

The DataWindow API (Retrieve, Update, InsertRow, GetItemString, ...) lives in
its own book, separate from the PowerScript Reference — the PowerScript pages
only cross-link to it.
"""
import concurrent.futures as cf
import json
import pathlib
import re
import time

import requests

BASE = pathlib.Path(__file__).parent
SESSION = requests.Session()
SESSION.headers["User-Agent"] = "Mozilla/5.0 (docs-research)"

VERSIONS = {
    "pb2022": "https://docs.appeon.com/pb2022/datawindow_reference/",
    "pb2025": "https://docs.appeon.com/pb2025/datawindow_reference/",
}

# Chapter anchors -> the kind of entry their sections describe.
CHAPTERS = [
    ("XREF_40567_CHAPTER_9_Methods.html", "method"),
    ("dwmeth_CHAPTER_10_Methods.html", "graph-method"),
    ("XREF_48155_CHAPTER_8.html", "event"),
]


def chapter_sections(html, href):
    """Section links belonging to one chapter (up to the next chapter marker)."""
    start = html.find(f'<span class="chapter"><a href="{href}">')
    if start < 0:
        return []
    next_chapter = html.find('<span class="chapter">', start + 10)
    segment = html[start:next_chapter if next_chapter > 0 else len(html)]
    return re.findall(r'<span class="section"><a href="([^"]+)">([^<]+)</a>', segment)


def fetch(url, out):
    if out.exists() and out.stat().st_size > 1000:
        return "cached"
    for attempt in range(4):
        try:
            r = SESSION.get(url, timeout=60)
            if r.status_code == 200:
                out.write_bytes(r.content)
                return "ok"
            if r.status_code == 404:
                return "404"
        except requests.RequestException:
            pass
        time.sleep(1 + attempt)
    return "fail"


def main():
    for version, base_url in VERSIONS.items():
        cache_dir = BASE / "cache-dw" / version
        cache_dir.mkdir(parents=True, exist_ok=True)
        idx = BASE / f"{version}_dw_index.html"
        if not idx.exists():
            r = SESSION.get(base_url, timeout=60)
            r.raise_for_status()
            idx.write_text(r.text, encoding="utf-8")
        html = idx.read_text(encoding="utf-8")

        manifest = {}
        targets = []
        for href, kind in CHAPTERS:
            for page, name in chapter_sections(html, href):
                name = re.sub(r"\s+", " ", name).strip()
                # Skip the chapters' prose sections (categories, cross-reference).
                if " " in name and not name.endswith(")"):
                    continue
                manifest[page] = {"kind": kind, "name": name}
                targets.append(page)

        print(f"{version}: {len(targets)} pages", flush=True)
        counts = {}
        with cf.ThreadPoolExecutor(max_workers=10) as ex:
            futs = [ex.submit(fetch, base_url + p, cache_dir / p) for p in targets]
            for fut in cf.as_completed(futs):
                res = fut.result()
                counts[res] = counts.get(res, 0) + 1
        (BASE / f"{version}_dw_manifest.json").write_text(
            json.dumps(manifest, indent=2), encoding="utf-8")
        print(f"{version}: {counts}", flush=True)


if __name__ == "__main__":
    main()
