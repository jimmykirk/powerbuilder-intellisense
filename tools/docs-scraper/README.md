# PowerBuilder docs scraper

Extracts PowerScript function and event references from the Appeon docs
(https://docs.appeon.com/pb2022/powerscript_reference/ and .../pb2025/...)
into JSON for the PowerBuilder VS Code extension.

## Outputs

Written to `server/data/` (falls back to this directory if that doesn't exist):

- `pb2022_functions.json` / `pb2025_functions.json` — 914 / 1,118 functions:
  `name`, `returnType`, `category`, `documentation`, `syntax`, `params[]`
  (`name`, `type`, `description`, `optional`).
- `pb2022_events.json` / `pb2025_events.json` — 139 / 150 events: same shape
  but `eventId` (the `pbm_*` message ID, null where the docs list none)
  instead of `syntax`.

Notes:
- Categories are derived: classic PB groupings for global functions
  (String, Numeric, Date/Time, ...), the docs' "Applies to" object for member
  functions, and the Event ID table's Objects column for events.
- Param types are inferred from the argument descriptions; ambiguous → `any`.
- For object member functions the first param is the receiver
  (`controlname.AddData(...)` → `controlname`).
- Multi-variant pages (Open, Close, Clicked, GetItem*, ...) are flattened into
  one record: params are the union across variants, event IDs comma-joined.

## Regenerating

```
python3 -m venv venv
./venv/bin/pip install beautifulsoup4 lxml requests
./venv/bin/python crawl.py   # populates cache/ (skips already-cached pages)
./venv/bin/python parse.py   # writes the four JSON files
```

`cache/` holds the raw HTML pages (~620 MB); delete it and re-run `crawl.py`
to refresh against updated docs. `crawl.py` discovers pages from the
`pb20XX_index.html` copies — delete those too for a full refresh.

## DataWindow Reference

`crawl_dw.py` + `parse_dw.py` cover a second book — the DataWindow Reference —
which documents the DataWindow control/DataStore API (Retrieve, Update,
InsertRow, GetItemString, ...) and DataWindow events. The PowerScript
Reference only cross-links to it, so these entries are absent from
`*_functions.json` and live in `server/data/pbXXXX_datawindow.json`
(253/254 methods, 57 events).

```
./venv/bin/python crawl_dw.py   # populates cache-dw/ + *_dw_manifest.json
./venv/bin/python parse_dw.py   # writes server/data/pbXXXX_datawindow.json
```

Note that several names appear in both books for different objects
(`Retrieve` on RestClient vs DataWindow, `GetItemString` on JSONParser vs
DataWindow); the language server disambiguates by the resolved receiver type.
