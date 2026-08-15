#!/usr/bin/env python3
"""
Parse cached DataWindow Reference pages into server/data/pbXXXX_datawindow.json.

Method pages carry the return type in the syntax line
(`long dwcontrol.Retrieve ( ... )`) and name the objects they apply to in an
"Applies to" table ("DataWindow control, DataWindowChild object, DataStore
object"), which becomes the appliesTo list used for member completion.
"""
import json
import pathlib
import re
import warnings

from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

from parse import (
    apply_syntax_hints,
    collect,
    infer_param_type,
    optional_depths,
    parse_arg_tables,
    section_map,
    squash,
)

warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

BASE = pathlib.Path(__file__).parent
OUT_DIR = BASE.parent.parent / "server" / "data"
if not OUT_DIR.is_dir():
    OUT_DIR = BASE

SCALARS = {
    "string", "integer", "int", "long", "longlong", "double", "decimal", "dec",
    "real", "boolean", "blob", "date", "datetime", "time", "any", "ulong",
    "uint", "byte", "character", "char", "none", "void",
}

# Objects named in "Method applies to" cells, normalized to type names the
# language server resolves receivers to.
APPLIES_MAP = {
    "datawindow": "DataWindow",
    "datawindowchild": "DataWindowChild",
    "datastore": "DataStore",
    "datawindowcontrol": "DataWindow",
    "childdatawindow": "DataWindowChild",
    "graph": "Graph",
}


def applies_cells(elems):
    """Second-column cells of the `DataWindow type / Method applies to` table."""
    cells = []
    for el in elems:
        if not hasattr(el, "find_all"):
            continue
        for table in ([el] if getattr(el, "name", "") == "table" else el.find_all("table")):
            headers = [squash(th.get_text()).lower() for th in table.find_all("th")]
            if not headers or "applies to" not in " ".join(headers):
                continue
            body = table.find("tbody") or table
            for tr in body.find_all("tr"):
                tds = tr.find_all("td")
                if len(tds) >= 2:
                    cells.append(squash(tds[1].get_text(" ")))
    return cells


def normalize_applies(text):
    """Object names named in an applies-to cell, longest name matched first."""
    out = []
    if not text:
        return out
    for raw in re.split(r"[,;]| and | or ", text):
        token = re.sub(r"\b(PowerBuilder|control|object|the|a|an)\b", "", raw, flags=re.I)
        token = squash(re.sub(r"[^\w ]", " ", token)).replace(" ", "")
        name = APPLIES_MAP.get(token.lower())
        if name and name not in out:
            out.append(name)
    return out


def parse_page(path, name, kind):
    soup = BeautifulSoup(path.read_text(encoding="utf-8", errors="replace"), "lxml")
    sec = soup.find("div", class_="section")
    if sec is None:
        return None
    title = sec.find(["h2", "h3", "h4"], class_="title")
    entry_name = squash(title.get_text()) if title else name
    entry_name = re.sub(r"\s*\(obsolete\)\s*", "", entry_name, flags=re.I).strip()
    if not re.fullmatch(r"[A-Za-z_]\w*", entry_name):
        return None

    sections = section_map(sec)
    doc_parts = [squash(e.get_text(" ")) for e in collect(sections, lambda h: h == "Description")
                 if e.name == "p"]
    documentation = " ".join(p for p in doc_parts if p)

    # Every code sample in the Syntax area; pick the one naming this entry.
    syn_elems = collect(sections, lambda h: h.startswith("Syntax") or h == "PowerBuilder")
    pres = [squash(e.get_text(" ")) for e in syn_elems if e.name == "pre"]
    for e in syn_elems:
        if e.name != "pre":
            pres.extend(squash(p.get_text(" ")) for p in e.find_all("pre"))
    syntax = next((s for s in pres if re.search(rf"\.\s*{entry_name}\b", s, re.I)), None)
    if syntax is None:
        syntax = pres[0] if pres else ""

    return_type = None
    lead = re.match(r"^([A-Za-z_]\w*)\s+[A-Za-z_]\w*\s*\.", syntax or "")
    if lead and lead.group(1).lower() in SCALARS:
        return_type = lead.group(1).lower()
    if return_type is None:
        ret_paras = [squash(e.get_text(" "))
                     for e in collect(sections, lambda h: h.lower().startswith("return"))
                     if e.name == "p"]
        first = ret_paras[0] if ret_paras else ""
        m = re.match(r"^([A-Za-z]+)\s*[.:]", first)
        if m and m.group(1).lower() in SCALARS:
            return_type = m.group(1).lower()
    if return_type is None:
        return_type = "long" if kind != "event" else "none"

    receiver = None
    rec = re.search(r"([A-Za-z_]\w*)\s*\.\s*" + re.escape(entry_name), syntax or "", re.I)
    if rec:
        receiver = rec.group(1).lower()

    depth_map = optional_depths(syntax or "")
    params, seen = [], set()
    arg_elems = syn_elems + collect(sections, lambda h: h.startswith("Argument"))
    for raw_name, raw_desc in parse_arg_tables(arg_elems):
        pname = squash(re.sub(r"\(.*?\)", "", raw_name))
        pname = pname.split()[0] if pname else raw_name
        if not pname or pname.lower() in seen:
            continue
        seen.add(pname.lower())
        if receiver and pname.lower() == receiver:
            continue  # the receiver is not an argument callers pass
        pdesc = squash(re.sub(r"^\(optional\)\s*", "", raw_desc, flags=re.I))
        param = {"name": pname, "type": infer_param_type(pname, pdesc), "description": pdesc}
        if "(optional" in raw_name.lower() or raw_desc.lower().startswith("(optional") \
                or depth_map.get(pname.lower(), 0) > 0:
            param["optional"] = True
        params.append(param)

    apply_syntax_hints(params, syntax)

    applies_elems = collect(sections, lambda h: h == "Applies to")
    applies_to = []
    for cell in applies_cells(applies_elems):
        for name in normalize_applies(cell):
            if name not in applies_to:
                applies_to.append(name)
    if kind == "graph-method" and "Graph" not in applies_to:
        applies_to.append("Graph")
    if not applies_to:
        applies_to = ["DataWindow", "DataStore"]

    return {
        "name": entry_name,
        "returnType": return_type,
        "documentation": documentation,
        "syntax": syntax,
        "params": params,
        "appliesTo": applies_to,
        "variadic": bool(re.search(r"\.\s*\.\s*\.", syntax or "")),
    }


def main():
    for version in ("pb2022", "pb2025"):
        cache_dir = BASE / "cache-dw" / version
        manifest_file = BASE / f"{version}_dw_manifest.json"
        if not manifest_file.exists():
            print(f"{version}: no manifest, run crawl_dw.py first")
            continue
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))

        methods, events, failed = [], [], []
        for page, info in sorted(manifest.items(), key=lambda kv: kv[1]["name"].lower()):
            path = cache_dir / page
            if not path.exists():
                continue
            try:
                rec = parse_page(path, info["name"], info["kind"])
            except Exception as e:  # noqa: BLE001 - report and continue
                failed.append(f"{page}: {e}")
                continue
            if rec is None:
                continue
            (events if info["kind"] == "event" else methods).append(rec)

        def dedupe(entries):
            out, seen = [], set()
            for e in sorted(entries, key=lambda x: x["name"].lower()):
                if e["name"].lower() in seen:
                    continue
                seen.add(e["name"].lower())
                out.append(e)
            return out

        methods, events = dedupe(methods), dedupe(events)
        out_file = OUT_DIR / f"{version}_datawindow.json"
        out_file.write_text(json.dumps(
            {"version": version.replace("pb", ""), "methods": methods, "events": events},
            indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"{version}: {len(methods)} methods, {len(events)} events -> {out_file.name}; "
              f"{len(failed)} failures")
        for f in failed[:10]:
            print("  FAIL", f)


if __name__ == "__main__":
    main()
