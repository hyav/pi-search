// pi-search-kit — unified web search extension for Pi
//
// Registers:
//   web_search  — search with LLM-driven provider routing
//   web_fetch   — fetch and extract content from a URL
//
// Registers built-in Providers and, in source checkouts, repository-only maintainer adapters.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerWebFetchTool } from "./web-fetch.js";
import { registerWebSearchTool } from "./web-search.js";

export default function (pi: ExtensionAPI) {
	registerWebSearchTool(pi);
	registerWebFetchTool(pi);
}
