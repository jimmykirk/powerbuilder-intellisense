#!/usr/bin/env python3
"""
Parse the cached Objects and Controls class pages into per-class property
catalogs (pbXXXX_properties.json), and harvest enumerated datatype values
(pbXXXX_enums.json) from both the property tables and the function catalogs'
parameter descriptions ("Values are: Left! Right! Center!").
"""
import json
import pathlib
import re
import warnings

from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

BASE = pathlib.Path(__file__).parent
OUT_DIR = BASE.parent.parent / "server" / "data"
if not OUT_DIR.is_dir():
    OUT_DIR = BASE


def squash(text):
    return re.sub(r"\s+", " ", text or "").strip()


def harvest_enum_values(text):
    """Returns `X!` tokens listed after an explicit 'Values are'-style marker."""
    marker = re.search(r"values\s+(?:are|include|can be)[:\s]", text, re.I)
    if not marker:
        return []
    tail = text[marker.end():]
    values = []
    for tok in re.findall(r"\b([A-Za-z]\w*)!", tail):
        val = tok + "!"
        if val not in values:
            values.append(val)
    return values


def parse_class_page(path):
    soup = BeautifulSoup(path.read_text(encoding="utf-8", errors="replace"), "lxml")
    sec = soup.find("div", class_="section")
    if sec is None:
        return None
    title = sec.find(["h2", "h3"], class_="title")
    if title is None:
        return None
    name = squash(title.get_text())
    name = re.sub(r"\s+(control|object)s?$", "", name, flags=re.I)
    name = re.sub(r"\s*\(.*\)$", "", name).strip()

    properties = []
    enums = {}
    seen = set()
    for table in sec.find_all("table"):
        headers = [squash(th.get_text()) for th in table.find_all("th")]
        if len(headers) < 3 or "property" not in headers[0].lower() \
                or not headers[1].lower().startswith("datatype"):
            continue
        body = table.find("tbody") or table
        for tr in body.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) < 3:
                continue
            pname = squash(tds[0].get_text(" "))
            ptype = squash(tds[1].get_text(" "))
            pdesc = squash(tds[2].get_text(" "))
            if not re.fullmatch(r"[A-Za-z_]\w*(\[\s*\])?", pname):
                continue
            enum_match = re.match(r"([A-Za-z_]\w*)\s*\(enumerated\)", ptype)
            if enum_match:
                ptype = enum_match.group(1)
                values = harvest_enum_values(pdesc)
                if values:
                    enums.setdefault(ptype, []).extend(
                        v for v in values if v not in enums.get(ptype, []))
            key = pname.lower()
            if key in seen:
                continue
            seen.add(key)
            properties.append({"name": pname, "type": ptype,
                               "description": pdesc[:500]})
    if not properties:
        return None
    return {"name": name, "properties": properties}, enums


def main():
    for version in ("pb2022", "pb2025"):
        cache_dir = BASE / "cache-oc" / version
        classes = []
        enums = {}

        for path in sorted(cache_dir.glob("*.html"), key=lambda p: p.name.lower()):
            result = parse_class_page(path)
            if result is None:
                continue
            cls, page_enums = result
            classes.append(cls)
            for ename, values in page_enums.items():
                bucket = enums.setdefault(ename, [])
                bucket.extend(v for v in values if v not in bucket)

        # Enum values also live in function parameter descriptions.
        fn_file = OUT_DIR / f"{version}_functions.json"
        if fn_file.exists():
            for fn in json.loads(fn_file.read_text(encoding="utf-8"))["functions"]:
                for param in fn["params"]:
                    ptype = param.get("type", "")
                    if not re.fullmatch(r"[A-Z]\w*", ptype):
                        continue  # enum type names are capitalized identifiers
                    values = harvest_enum_values(param.get("description", ""))
                    if values:
                        bucket = enums.setdefault(ptype, [])
                        bucket.extend(v for v in values if v not in bucket)

        classes.sort(key=lambda c: c["name"].lower())
        props_out = OUT_DIR / f"{version}_properties.json"
        props_out.write_text(json.dumps(
            {"version": version.replace("pb", ""), "classes": classes},
            indent=2, ensure_ascii=False), encoding="utf-8")
        nprops = sum(len(c["properties"]) for c in classes)
        print(f"{version}: {len(classes)} classes, {nprops} properties "
              f"-> {props_out.name}")

        enum_list = [{"name": k, "values": v}
                     for k, v in sorted(enums.items(), key=lambda e: e[0].lower())
                     if len(v) >= 2]
        enums_out = OUT_DIR / f"{version}_enums.json"
        enums_out.write_text(json.dumps(
            {"version": version.replace("pb", ""), "enums": enum_list},
            indent=2, ensure_ascii=False), encoding="utf-8")
        nvals = sum(len(e["values"]) for e in enum_list)
        print(f"{version}: {len(enum_list)} enums, {nvals} values -> {enums_out.name}")


if __name__ == "__main__":
    main()
