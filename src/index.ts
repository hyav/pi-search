// @hyav/pi-search — unified web search extension for Pi
//
// Registers:
//   web_search  — search with LLM-driven provider routing
//   web_fetch   — fetch and extract content from a URL
//
// Public adapter API: custom provider adapters import defineProvider from this
// package; built-in providers in src/providers/ are reference templates.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadUserAdapters } from "./adapter-loader.js";
import { registerWebFetchTool } from "./web-fetch.js";
import { registerWebSearchTool } from "./web-search.js";

export type { ProviderAdapter } from "./adapter-api.js";
export { defineProvider, registerProvider } from "./adapter-api.js";
export type {
	CrawlResult,
	FetchResponse,
	Provider,
	ProviderCapabilities,
	ProviderMeta,
	SearchResponse,
	SearchResult,
} from "./providers/types.js";

export default async function (pi: ExtensionAPI) {
	await loadUserAdapters();
	registerWebSearchTool(pi);
	registerWebFetchTool(pi);
}
