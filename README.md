# @hyav/pi-search

[简体中文](README.zh-CN.md)

An LLM-routed web search and content extraction extension for [Pi](https://pi.dev), with built-in Tavily and AnySearch search plus Tavily, AnySearch, and Jina extraction.

[Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Security](SECURITY.md)

## Highlights

- LLM routing based on provider capability metadata instead of a hard-coded classifier
- Keyless search and extraction paths with cost-aware fallback
- General and vertical search plus web and PDF extraction
- SSRF defenses for direct fetches, bounded responses, cancellation, and timeouts
- Deduplicated output capped to Pi's 2,000-line or 50 KiB tool limit, with full results saved to a temporary file

## Install

Requires Node.js 22.19.0 or newer and Pi.

```sh
pi install npm:@hyav/pi-search
```

Ask Pi for information that requires a live web search. A successful installation exposes `web_search` and `web_fetch` and returns structured results from a selected built-in provider.

## Configure

Built-in Tavily and AnySearch search and Jina extraction work without API keys. Optional credentials unlock provider-specific capabilities:

| Provider | Environment variable | Effect |
|---|---|---|
| Tavily | `TAVILY_API_KEY` | Enables authenticated crawl, map, and research capabilities |
| AnySearch | `ANYSEARCH_API_KEY` | Authenticates general, vertical, and extraction requests |
| Jina | `JINA_API_KEY` | Authenticates web and PDF extraction |

Environment variables take precedence over `<agent-dir>/pi-search/config.json`, where `<agent-dir>` is `PI_CODING_AGENT_DIR` or `~/.pi/agent`. The legacy `~/.pi/pi-search/config.json` is read only when the preferred file is absent. Keep credential files readable only by your user.


## Use

The model calls `web_search` and `web_fetch` directly. Without an explicit provider, the fallback order is:

- Search: Tavily → AnySearch
- Extraction: Tavily → Jina → AnySearch

An explicitly selected provider never falls back silently; its failure is returned directly. If no configured or keyless providers match the requested capability, the tool fails with an explicit actionable error message.

## Before you use it

Search queries, requested URLs, and extracted content are sent to the selected external provider and remain subject to its pricing and data policies. Oversized results are retained in an operating-system temporary directory until you remove them or the OS cleans them up.

## License

[MIT](LICENSE)
