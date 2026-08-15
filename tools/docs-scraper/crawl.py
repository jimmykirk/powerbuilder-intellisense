#!/usr/bin/env python3
"""Download all PowerScript function pages for PB2022 + PB2025 into a local cache."""
import concurrent.futures as cf
import pathlib
import re
import sys
import time

import requests

BASE = pathlib.Path(__file__).parent
SESSION = requests.Session()
SESSION.headers["User-Agent"] = "Mozilla/5.0 (docs-research; contact jimmy.kirk@gmail.com)"

VERSIONS = {
    "pb2022": "https://docs.appeon.com/pb2022/powerscript_reference/",
    "pb2025": "https://docs.appeon.com/pb2025/powerscript_reference/",
}


def get_func_links(version, base_url):
    idx_file = BASE / f"{version}_index.html"
    if not idx_file.exists():
        r = SESSION.get(base_url, timeout=60)
        r.raise_for_status()
        idx_file.write_text(r.text, encoding="utf-8")
    html = idx_file.read_text(encoding="utf-8")
    links = sorted(set(re.findall(r'href="([^"/:]+_(?:func|event)\.html)"', html)))
    return links


def fetch(version, base_url, link, cache_dir):
    out = cache_dir / link
    if out.exists() and out.stat().st_size > 1000:
        return "cached"
    for attempt in range(4):
        try:
            r = SESSION.get(base_url + link, timeout=60)
            if r.status_code == 200:
                out.write_bytes(r.content)
                return "ok"
            if r.status_code == 404:
                return f"404:{link}"
        except requests.RequestException as e:
            if attempt == 3:
                return f"err:{link}:{e}"
        time.sleep(1 + attempt)
    return f"fail:{link}"


def main():
    for version, base_url in VERSIONS.items():
        cache_dir = BASE / "cache" / version
        cache_dir.mkdir(parents=True, exist_ok=True)
        links = get_func_links(version, base_url)
        print(f"{version}: {len(links)} function pages", flush=True)
        results = {}
        with cf.ThreadPoolExecutor(max_workers=10) as ex:
            futs = {ex.submit(fetch, version, base_url, l, cache_dir): l for l in links}
            done = 0
            for fut in cf.as_completed(futs):
                res = fut.result()
                results[res.split(":")[0]] = results.get(res.split(":")[0], 0) + 1
                if res not in ("ok", "cached"):
                    print("  ", res, flush=True)
                done += 1
                if done % 100 == 0:
                    print(f"  {version}: {done}/{len(links)}", flush=True)
        print(f"{version} summary: {results}", flush=True)


if __name__ == "__main__":
    main()
