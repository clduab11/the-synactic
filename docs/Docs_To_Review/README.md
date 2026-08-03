# Docs To Review (archival)

This directory is **not published by Mintlify** (`.mintignore` excludes it).

Files here are internal / archival / pending-audit. They are **not** the source of truth.

## Canonical docs live at the root of `docs/`

| If you want... | See |
|---|---|
| Architecture overview | `/docs/architecture.mdx` |
| API reference (RPC) | `/docs/api/*.openapi.yaml` + https://docs.worldmonitor.app |
| Non-RPC API endpoints | `/docs/api-{platform,brief,commerce,notifications,shipping-v2,proxies,oauth}.mdx` |
| MCP server | `/docs/mcp-server.mdx` |
| External data sources | `/docs/data-sources.mdx` |
| Release / desktop packaging | `/docs/release-packaging.mdx`, `/docs/desktop-app.mdx` |
| Country instability index | `/docs/country-instability-index.mdx` |

## Removed (2026-04-19)

- `API_REFERENCE.md` — referenced legacy pre-migration endpoints (`/api/acled`, `/api/finnhub`, `/api/fred-data`, etc.) that no longer exist. Superseded by the auto-generated OpenAPI specs under `/docs/api/`.
- `EXTERNAL_APIS.md` — duplicated content now in `/docs/data-sources.mdx`.

## Removed (2026-08-03)

Both were exact duplicates carrying no unique text, and nothing linked to the
copy in this directory — every inbound reference already pointed at the
canonical file. Removing a working-tree file does not destroy git history.

- `TAURI_VALIDATION_REPORT.md` — **byte-identical** to `/docs/TAURI_VALIDATION_REPORT.md` (3500 B, `diff` clean). All four inbound references (`/docs/release-packaging.mdx`, `/docs/zh/release-packaging.mdx`, `todo_docs.md`, and the root report itself) name the root copy. The root copy is a dated point-in-time validation run and is retained.
- `RELEASE_PACKAGING.md` — content-identical to `/docs/release-packaging.mdx`; the only difference was Mintlify front matter vs an H1. Zero references pointed here.

## Remaining files

The rest of this directory needs a case-by-case audit — contents may be stale, useful, or mergeable into canonical docs. Don't cite them externally until audited.
