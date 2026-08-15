#!/usr/bin/env python3
"""Parse cached Appeon PowerScript reference pages into pbXXXX_functions.json."""
import json
import pathlib
import re
import sys

import warnings

from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

BASE = pathlib.Path(__file__).parent
# JSON outputs go to the language server's data directory (repo layout:
# tools/docs-scraper/ -> server/data/); fall back to this directory.
OUT_DIR = BASE.parent.parent / "server" / "data"
if not OUT_DIR.is_dir():
    OUT_DIR = BASE

# ---------------------------------------------------------------- categories
# Curated categories for global (system) functions, per the classic
# "PowerScript functions by category" grouping in the PB documentation.
GLOBAL_CATEGORIES = {
    "String": """Asc AscA Char CharA Fill FillA Left LeftA Len LenA Lower LTrim
        Match Mid MidA Pos PosA Replace ReplaceA Reverse Right RightA RTrim
        Space Trim Upper WordCap LastPos LeftTrim RightTrim""",
    "Numeric": """Abs ACos ASin ATan Ceiling Cos Exp Fact Int Log LogTen Max
        Min Mod Pi Rand Randomize Round Sign Sin Sqrt Tan Truncate""",
    "Date/Time": """Day DayName DayNumber DaysAfter Hour Minute Month Now
        RelativeDate RelativeTime Second SecondsAfter Today Year""",
    "Conversion": """Date DateTime Dec Double Integer Long LongLong Real
        String Time Blob Byte Hex IsDate IsNull IsNumber IsTime IsValid
        SetNull""",
    "File I/O": """FileClose FileCopy FileDelete FileEncoding FileExists
        FileLength FileLength64 FileMove FileOpen FileRead FileReadEx
        FileSeek FileSeek64 FileWrite FileWriteEx GetFileOpenName
        GetFileSaveName GetFolder GetCurrentDirectory ChangeDirectory
        CreateDirectory RemoveDirectory DirectoryExists GetContextService""",
    "Registry": """RegistryDelete RegistryGet RegistryKeys RegistrySet
        RegistryValues""",
    "Library": """LibraryCreate LibraryDelete LibraryDirectory
        LibraryDirectoryEx LibraryExport LibraryImport""",
    "Print": """Print PrintBitmap PrintCancel PrintClose PrintDataWindow
        PrintDefineFont PrintGetPrinter PrintGetPrinters PrintLine PrintOpen
        PrintOval PrintPage PrintRect PrintRoundRect PrintScreen PrintSend
        PrintSetFont PrintSetPrinter PrintSetSpacing PrintSetup
        PrintSetupPrinter PrintText PrintWidth PrintX PrintY""",
    "DDE": """CloseChannel ExecRemote GetCommandDDE GetCommandDDEOrigin
        GetDataDDE GetDataDDEOrigin GetRemote OpenChannel RespondRemote
        SetDataDDE SetRemote StartHotLink StartServerDDE StopHotLink
        StopServerDDE""",
    "Window": """Open OpenSheet OpenSheetInTabPro OpenSheetWithParm
        OpenSheetWithParmInTabPro OpenWithParm Close CloseWithReturn""",
    "International": """IsAllArabic IsAllHebrew IsAnyArabic IsAnyHebrew
        IsArabic IsArabicAndNumbers IsHebrew IsHebrewAndNumbers Reverse
        ToAnsi ToUnicode FromAnsi FromUnicode""",
    "Timing": "CPU Idle Timer",
    "System": """Beep ClassName Clipboard CommandParm DebugBreak
        GarbageCollect GarbageCollectGetTimeLimit GarbageCollectSetTimeLimit
        GetApplication GetEnvironment Handle IntHigh IntLow MessageBox
        PixelsToUnits Post PopulateError ProfileInt ProfileString Restart Run
        Send SetProfileString ShowHelp SignalError UnitsToPixels Yield
        RGB LowerBound UpperBound""",
}
NAME_TO_CATEGORY = {}
for cat, names in GLOBAL_CATEGORIES.items():
    for n in names.split():
        NAME_TO_CATEGORY[n.lower()] = cat

# Applies-to object name → friendlier category for a few non-obvious cases.
OBJECT_CATEGORY_OVERRIDES = {
    "crypterobject": "Encryption",
    "coderobject": "Encoding",
    "compressorobject": "Compression",
    "extractorobject": "Compression",
    "pbdom_attribute": "XML", "pbdom_builder": "XML", "pbdom_cdata": "XML",
    "pbdom_characterdata": "XML", "pbdom_comment": "XML",
    "pbdom_document": "XML", "pbdom_documenttype": "XML",
    "pbdom_element": "XML", "pbdom_entityreference": "XML",
    "pbdom_object": "XML", "pbdom_processinginstruction": "XML",
    "pbdom_text": "XML",
}

KNOWN_SCALARS = {
    "string", "integer", "int", "long", "longlong", "double", "decimal",
    "real", "boolean", "blob", "date", "datetime", "time", "any", "ulong",
    "uint", "byte", "char", "unsignedlong", "unsignedinteger", "none",
}
OBJECT_TYPE_WORDS = (
    "window|menu|datawindow|datastore|graph|structure|transaction|"
    "treeviewitem|listviewitem|powerobject|dragobject|windowobject|"
    "connection|mailsession|oleobject|omobject|omcontrol"
)


def squash(text):
    return re.sub(r"\s+", " ", text or "").strip()


def section_map(section_div):
    """Split the main content div into named sections keyed by bold headers."""
    sections = {}
    current = "_pre"
    sections[current] = []
    for child in section_div.children:
        if getattr(child, "name", None) is None:
            continue
        if child.name == "div" and ({"section", "simplesect"} &
                                    set(child.get("class") or [])):
            continue  # nested syntax-variant sections are merged separately
        if child.name == "p":
            strong = child.select_one("span.bold > strong")
            if strong and squash(strong.get_text()) and len(squash(child.get_text())) < 60 \
                    and squash(strong.get_text()) == squash(child.get_text()):
                current = squash(strong.get_text())
                sections.setdefault(current, [])
                continue
        sections.setdefault(current, []).append(child)
    return sections


def collect(sections, predicate):
    out = []
    for header, elems in sections.items():
        if predicate(header):
            out.extend(elems)
    return out


def parse_arg_tables(elems):
    """Yield (name_cell_text, desc_cell_text) from Argument/Description tables."""
    for el in elems:
        for table in ([el] if el.name == "table" else el.find_all("table")):
            headers = [squash(th.get_text()) for th in table.find_all("th")]
            if not headers or not headers[0].lower().startswith("argument"):
                continue
            body = table.find("tbody") or table
            for tr in body.find_all("tr"):
                tds = tr.find_all("td")
                if len(tds) >= 2:
                    yield squash(tds[0].get_text(" ")), squash(tds[1].get_text(" "))


def infer_param_type(name, desc):
    d = desc.lower()
    m = re.search(r"value of the ([A-Za-z_]+)\s+enumerated", desc)
    if m:
        return m.group(1)
    m = re.search(r"([A-Za-z_]+)\s+enumerated (?:datatype|value)", desc)
    if m and m.group(1).lower() not in ("the", "an", "a"):
        return m.group(1)
    head = d[:120]
    scalars = re.findall(
        r"\b(string|integer|long(?:long)?|double|decimal|real|boolean|blob|"
        r"datetime|date|time|any|unsignedlong|unsignedinteger|ulong|uint|byte)\b",
        head)
    if scalars:
        return scalars[0] if len(set(scalars)) == 1 else "any"
    m = re.search(r"\b(" + OBJECT_TYPE_WORDS + r")\b", head)
    if m:
        return m.group(1)
    return "any"


def syntax_param_hints(syntax):
    """
    Per-argument facts taken from the documented syntax line, which is more
    authoritative than the prose: `REF DataWindowChild dwchildvariable` gives
    both the by-reference marker and the real type, where the description only
    says "a variable in which ...".
    """
    hints = {}
    if not syntax:
        return hints
    inner = syntax[syntax.find("(") + 1:syntax.rfind(")")] if "(" in syntax else ""
    for segment in re.split(r",", inner):
        seg = squash(segment.replace("{", " ").replace("}", " "))
        seg = re.sub(r"\.\s*\.\s*\.", " ", seg)
        tokens = [t for t in seg.split() if t]
        if not tokens:
            continue
        is_ref = tokens[0].lower() == "ref"
        if is_ref:
            tokens = tokens[1:]
        if not tokens:
            continue
        name = tokens[-1].strip("[]")
        stype = tokens[-2] if len(tokens) >= 2 else None
        if not re.fullmatch(r"[A-Za-z_]\w*", name):
            continue
        if stype and not re.fullmatch(r"[A-Za-z_]\w*", stype):
            stype = None
        hints[name.lower()] = {"ref": is_ref, "type": stype}
    return hints


def apply_syntax_hints(params, syntax):
    """Marks by-reference params and prefers the syntax's declared type."""
    hints = syntax_param_hints(syntax)
    for param in params:
        hint = hints.get(param["name"].lower())
        if not hint:
            continue
        if hint["ref"]:
            param["ref"] = True
        # The syntax line is the actual declaration, so its type wins over the
        # type guessed from the argument's prose description.
        if hint["type"]:
            param["type"] = hint["type"]
    return params


def optional_depths(syntax):
    """Map each identifier occurring in the syntax line to its brace depth."""
    depths = {}
    depth = 0
    for m in re.finditer(r"[{}]|[A-Za-z_][A-Za-z0-9_]*", syntax):
        tok = m.group(0)
        if tok == "{":
            depth += 1
        elif tok == "}":
            depth = max(0, depth - 1)
        else:
            depths.setdefault(tok.lower(), depth)
    return depths


def parse_return_type(elems):
    paras = [squash(e.get_text(" ")) for e in elems if e.name in ("p", "pre")]
    paras = [p for p in paras if p]
    if not paras:
        return None
    first = paras[0]
    if re.match(r"^None\b", first):
        return "none"
    m = re.match(r"^([A-Za-z][A-Za-z ]{0,25}?)\s*[.:]", first)
    if m:
        word = m.group(1).strip()
        key = word.replace(" ", "").lower()
        if key in KNOWN_SCALARS:
            return {"unsignedlong": "ulong", "unsignedinteger": "uint",
                    "int": "integer"}.get(key, key)
        if re.fullmatch(r"[A-Za-z]+", word):
            return word  # enumerated / object type, keep original casing
    sent = re.split(r"(?<=[.!?])\s", first)[0].rstrip(".")
    return sent[:90] if sent else None


def applies_to_category(elems):
    text = next((squash(e.get_text(" ")) for e in elems
                 if hasattr(e, "get_text") and squash(e.get_text(" "))), None)
    return normalize_applies_text(text)


def normalize_applies_token(token):
    token = re.sub(r"\b(any|all|the|a|an|controls?|objects?|types?|only)\b",
                   "", token, flags=re.I)
    token = re.sub(r"\bin (windows?|user)\b.*$", "", token, flags=re.I)
    token = re.sub(r"\(including\b.*$", "", token, flags=re.I)
    token = token.strip("()")
    token = squash(token)
    # Reject prose fragments that leak out of irregular tables — a real object
    # name is one or two capitalized words with no sentence punctuation.
    if not token or len(token) > 32 or re.search(r"[.:]", token) \
            or len(token.split()) > 3:
        return None
    key = token.lower().replace(" ", "")
    if key in OBJECT_CATEGORY_OVERRIDES:
        return OBJECT_CATEGORY_OVERRIDES[key]
    fixes = {"windows": "Window", "datawindows": "DataWindow", "menus": "Menu"}
    return fixes.get(token.lower(), token)


def normalize_applies_text(text):
    if not text:
        return None
    return normalize_applies_token(re.split(r"[,;]| and | or ", text)[0])


def normalize_applies_list(text):
    """Every object named in an Applies-to / Objects cell, normalized."""
    if not text:
        return []
    out = []
    for raw in re.split(r"[,;]| and | or ", text):
        token = normalize_applies_token(raw)
        if token and token not in out:
            out.append(token)
    return out


def parse_event_id_tables(elems):
    """Yield (event_id, objects) rows from Event ID / Objects tables."""
    for el in elems:
        for table in ([el] if el.name == "table" else el.find_all("table")):
            headers = [squash(th.get_text()) for th in table.find_all("th")]
            if not headers or not headers[0].lower().startswith("event id"):
                continue
            body = table.find("tbody") or table
            for tr in body.find_all("tr"):
                tds = tr.find_all("td")
                if len(tds) >= 2:
                    yield squash(tds[0].get_text(" ")), squash(tds[1].get_text(" "))


def parse_variant(sub):
    """One syntax variant of a multi-syntax page: label, syntax, params, return."""
    smap = section_map(sub)
    title = sub.find(["h3", "h4", "h5"], class_="title")
    label = squash(title.get_text()) if title else None

    syn_elems = collect(smap, lambda h: h.startswith("Syntax"))
    syntaxes = [squash(e.get_text(" ")) for e in syn_elems if e.name == "pre"]
    for e in syn_elems:
        if e.name != "pre":
            syntaxes.extend(squash(p.get_text(" ")) for p in e.find_all("pre"))
    syntax = syntaxes[0] if syntaxes else None
    depth_map = optional_depths(" ".join(syntaxes))

    params, seen = [], set()
    arg_elems = syn_elems + collect(smap, lambda h: h.startswith("Argument"))
    for raw_name, raw_desc in parse_arg_tables(arg_elems):
        opt = "(optional)" in raw_name.lower() or raw_desc.lower().startswith("(optional)")
        pname = squash(re.sub(r"\(.*?\)", "", raw_name))
        pname = pname.split()[0] if pname else raw_name
        if not pname or pname.lower() in seen:
            continue
        seen.add(pname.lower())
        pdesc = squash(re.sub(r"^\(optional\)\s*", "", raw_desc, flags=re.I))
        if depth_map.get(pname.lower(), 0) > 0:
            opt = True
        param = {"name": pname, "type": infer_param_type(pname, pdesc),
                 "description": pdesc}
        if opt:
            param["optional"] = True
        params.append(param)

    ret_elems = collect(smap, lambda h: h.lower().startswith("return"))
    return_type = parse_return_type(ret_elems)

    if not syntax and not params and not (label and re.match(r"Syntax \d", label)):
        return None
    apply_syntax_hints(params, syntax)
    variant = {"params": params}
    if label:
        variant["label"] = label
    if syntax:
        variant["syntax"] = syntax
    if return_type:
        variant["returnType"] = return_type
    return variant


def parse_page(path, kind="func"):
    soup = BeautifulSoup(path.read_text(encoding="utf-8", errors="replace"), "lxml")
    section_div = soup.find("div", class_="section")
    if section_div is None:
        return None
    title = section_div.find(["h2", "h3", "h4"], class_="title")
    if title is None:
        return None
    name = squash(title.get_text())
    name = re.sub(r"\s*\(obsolete\)\s*", "", name, flags=re.I)
    sections = section_map(section_div)
    # Multi-syntax pages (Open, Close, AddData, ...) nest one sub-section per
    # syntax variant; merge their headers in document order, and additionally
    # capture each variant separately for per-variant signature help.
    merged = {k: list(v) for k, v in sections.items()}
    variant_subs = section_div.find_all("div", class_=("section", "simplesect"),
                                        recursive=False)
    for sub in variant_subs:
        for k, v in section_map(sub).items():
            merged.setdefault(k, []).extend(v)
    variants = [parse_variant(sub) for sub in variant_subs]
    variants = [v for v in variants if v is not None]

    desc_elems = collect(sections, lambda h: h == "Description")
    doc_parts = [squash(e.get_text(" ")) for e in desc_elems if e.name == "p"]
    documentation = " ".join(p for p in doc_parts if p)
    if not documentation:
        intro = [squash(e.get_text(" ")) for e in sections.get("_pre", [])
                 if e.name == "p"]
        documentation = " ".join(p for p in intro
                                 if p and not re.match(r"Syntax \d", p))
    if not documentation:
        sub_desc = collect(merged, lambda h: h == "Description")
        doc_parts = [squash(e.get_text(" ")) for e in sub_desc if e.name == "p"]
        documentation = " ".join(dict.fromkeys(p for p in doc_parts if p))
    elif kind == "event" and not desc_elems:
        # Multi-variant events lead with "…has different arguments for
        # different objects:" — append the per-variant descriptions.
        sub_desc = collect(merged, lambda h: h == "Description")
        doc_parts = [squash(e.get_text(" ")) for e in sub_desc if e.name == "p"]
        extra = " ".join(dict.fromkeys(p for p in doc_parts if p))
        documentation = squash(f"{documentation} {extra}")
    sections = merged

    syntax_elems = collect(sections, lambda h: h.startswith("Syntax"))
    syntaxes = [squash(e.get_text(" ")) for e in syntax_elems
                if e.name == "pre"]
    for e in syntax_elems:
        if e.name != "pre":
            syntaxes.extend(squash(p.get_text(" ")) for p in e.find_all("pre"))
    syntax = syntaxes[0] if syntaxes else ""
    depth_map = optional_depths(" ".join(syntaxes))

    params, seen = [], set()
    arg_elems = syntax_elems + collect(sections, lambda h: h.startswith("Argument"))
    for raw_name, raw_desc in parse_arg_tables(arg_elems):
        opt = "(optional)" in raw_name.lower() or raw_desc.lower().startswith("(optional)")
        pname = squash(re.sub(r"\(.*?\)", "", raw_name))
        pname = pname.split()[0] if pname else raw_name
        if not pname or pname.lower() in seen:
            continue
        seen.add(pname.lower())
        pdesc = squash(re.sub(r"^\(optional\)\s*", "", raw_desc, flags=re.I))
        if depth_map.get(pname.lower(), 0) > 0:
            opt = True
        param = {"name": pname, "type": infer_param_type(pname, pdesc),
                 "description": pdesc}
        if opt:
            param["optional"] = True
        params.append(param)

    apply_syntax_hints(params, syntax)

    ret_elems = collect(sections, lambda h: h.lower().startswith("return"))
    return_type = parse_return_type(ret_elems) or "none"

    applies_elems = collect(sections, lambda h: h == "Applies to")
    applies_text = ", ".join(
        squash(e.get_text(" ")) for e in applies_elems if hasattr(e, "get_text"))
    applies_to = normalize_applies_list(applies_text)
    category = NAME_TO_CATEGORY.get(name.lower()) if kind == "func" else None
    if kind == "event":
        id_rows = list(parse_event_id_tables(
            collect(sections, lambda h: h == "Event ID")))
        objs = next((o for _, o in id_rows if o and o.lower() != "none"), None)
        category = normalize_applies_text(objs)
        for _, o in id_rows:
            if o and o.lower() != "none":
                for token in normalize_applies_list(o):
                    if token not in applies_to:
                        applies_to.append(token)
    if category is None and applies_elems:
        category = applies_to_category(applies_elems)
    if category is None:
        category = "System"

    record = {
        "name": name,
        "returnType": return_type,
        "category": category,
        "documentation": documentation,
        "syntax": syntax,
        "params": params,
    }
    if applies_to:
        record["appliesTo"] = applies_to
    if len(variants) >= 2:
        record["variants"] = variants
    if kind == "event":
        del record["syntax"]
        ids = list(dict.fromkeys(
            i for i, _ in id_rows if i and i.lower() != "none"))
        record["eventId"] = ", ".join(ids) if ids else None
    return record


def main():
    for version in ("pb2022", "pb2025"):
        cache_dir = BASE / "cache" / version
        funcs, failed = [], []
        for path in sorted(cache_dir.glob("*_func.html"), key=lambda p: p.name.lower()):
            if path.name == "pronouns_func.html":
                continue  # language-topic page, not a function
            try:
                rec = parse_page(path)
            except Exception as e:
                failed.append(f"{path.name}: {e}")
                continue
            if rec is None:
                failed.append(f"{path.name}: no content section")
                continue
            funcs.append(rec)
        funcs.sort(key=lambda f: f["name"].lower())
        out = {"version": version.replace("pb", ""), "functions": funcs}
        out_file = OUT_DIR / f"{version}_functions.json"
        out_file.write_text(json.dumps(out, indent=2, ensure_ascii=False),
                            encoding="utf-8")
        print(f"{version}: {len(funcs)} functions -> {out_file.name}; "
              f"{len(failed)} failures")
        for f in failed[:20]:
            print("  FAIL", f)

        events, failed = [], []
        for path in sorted(cache_dir.glob("*_event.html"),
                           key=lambda p: p.name.lower()):
            try:
                rec = parse_page(path, kind="event")
            except Exception as e:
                failed.append(f"{path.name}: {e}")
                continue
            if rec is None:
                failed.append(f"{path.name}: no content section")
                continue
            events.append(rec)
        events.sort(key=lambda f: f["name"].lower())
        out = {"version": version.replace("pb", ""), "events": events}
        out_file = OUT_DIR / f"{version}_events.json"
        out_file.write_text(json.dumps(out, indent=2, ensure_ascii=False),
                            encoding="utf-8")
        print(f"{version}: {len(events)} events -> {out_file.name}; "
              f"{len(failed)} failures")
        for f in failed[:20]:
            print("  FAIL", f)


if __name__ == "__main__":
    main()
