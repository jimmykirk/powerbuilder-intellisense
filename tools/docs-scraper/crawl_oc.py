#!/usr/bin/env python3
"""Download the per-class pages of the Objects and Controls book (PB2022+PB2025)."""
import concurrent.futures as cf
import pathlib
import re
import time

import requests

BASE = pathlib.Path(__file__).parent
SESSION = requests.Session()
SESSION.headers["User-Agent"] = "Mozilla/5.0 (docs-research)"

VERSIONS = {
    "pb2022": "https://docs.appeon.com/pb2022/objects_and_controls/",
    "pb2025": "https://docs.appeon.com/pb2025/objects_and_controls/",
}


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
        cache_dir = BASE / "cache-oc" / version
        cache_dir.mkdir(parents=True, exist_ok=True)
        idx = BASE / f"{version}_oc_index.html"
        if not idx.exists():
            r = SESSION.get(base_url, timeout=60)
            r.raise_for_status()
            idx.write_text(r.text, encoding="utf-8")
        html = idx.read_text(encoding="utf-8")
        links = sorted(set(re.findall(
            r'href="([^"/:]+_(?:object|control)\.html)"', html)))
        print(f"{version}: {len(links)} class pages", flush=True)
        counts = {}
        with cf.ThreadPoolExecutor(max_workers=10) as ex:
            futs = [ex.submit(fetch, base_url + l, cache_dir / l) for l in links]
            for fut in cf.as_completed(futs):
                res = fut.result()
                counts[res] = counts.get(res, 0) + 1
        print(f"{version}: {counts}", flush=True)


if __name__ == "__main__":
    main()
