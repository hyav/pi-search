import { defineProvider } from "../adapter-api.js";
import { fetchWithTimeout } from "../utils.js";
import type { CrawlResult, FetchResponse, Provider, SearchResponse, SearchResult } from "./types.js";

// Tavily REST API client
//
// Endpoints:
//   POST https://api.tavily.com/search    — web search
//   POST https://api.tavily.com/extract   — content extraction
//   POST https://api.tavily.com/crawl     — site crawl
//   POST https://api.tavily.com/map       — URL discovery
//   POST https://api.tavily.com/research  — deep research

const BASE = "https://api.tavily.com";

interface TavilyRawResult {
	title?: string;
	url?: string;
	content?: string;
	score?: number;
}

interface TavilyExtractResult {
	url?: string;
	raw_content?: string;
	title?: string;
}

interface TavilyExtractResponse {
	results?: TavilyExtractResult[];
	failed_results?: Array<{ url?: string; error?: string }>;
}

interface TavilyCrawlPage {
	url?: string;
	title?: string;
	raw_content?: string;
}

interface TavilyMapResponse {
	results?: string[];
}

interface TavilyResearchResponse {
	answer?: string;
}

function authHeaders(apiKey: string | undefined, allowKeyless = false): Record<string, string> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	} else if (allowKeyless) {
		headers["X-Tavily-Access-Mode"] = "keyless";
	}
	return headers;
}

function requireApiKey(apiKey: string | undefined, operation: string): string {
	if (!apiKey) throw new Error(`Tavily ${operation} requires an API key`);
	return apiKey;
}

function normalizeResults(raw: TavilyRawResult[]): SearchResult[] {
	return raw.map((r) => ({
		title: r.title ?? "",
		url: r.url ?? "",
		snippet: r.content ?? "",
		score: r.score,
	}));
}

export class TavilyProvider implements Provider {
	readonly name = "tavily";
	readonly label = "Tavily";
	readonly capabilities = {
		generalSearch: true,
		verticalSearch: false,
		contentExtraction: true,
		crawl: true,
		siteMap: true,
		deepResearch: true,
		batchSearch: false,
		hasMetadata: false,
	};

	constructor(private readonly apiKey: string | undefined) {}

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
		const res = await fetchWithTimeout(`${BASE}/search`, {
			method: "POST",
			headers: authHeaders(this.apiKey, true),
			body: JSON.stringify({ query, max_results: maxResults }),
			signal,
		});
		if (!res.ok) {
			throw new Error(`Tavily search error (${res.status}): ${await res.text()}`);
		}
		const data = (await res.json()) as { results?: TavilyRawResult[] };
		return { results: normalizeResults(data.results ?? []) };
	}

	async fetch(url: string, signal?: AbortSignal): Promise<FetchResponse> {
		const res = await fetchWithTimeout(`${BASE}/extract`, {
			method: "POST",
			headers: authHeaders(this.apiKey, true),
			body: JSON.stringify({ urls: [url] }),
			signal,
		});
		if (!res.ok) {
			throw new Error(`Tavily extract error (${res.status}): ${await res.text()}`);
		}
		const data = (await res.json()) as TavilyExtractResponse;
		if (data.failed_results?.length) {
			const f = data.failed_results[0];
			throw new Error(`Tavily extract failed for ${f.url ?? url}: ${f.error ?? "unknown"}`);
		}
		const r = data.results?.[0];
		if (!r?.raw_content) throw new Error(`Tavily extract: no content for ${url}`);
		return { text: r.raw_content, title: r.title, contentType: "text/markdown" };
	}

	async crawl(url: string, maxPages: number, signal?: AbortSignal): Promise<CrawlResult[]> {
		const apiKey = requireApiKey(this.apiKey, "crawl");
		const res = await fetchWithTimeout(
			`${BASE}/crawl`,
			{
				method: "POST",
				headers: authHeaders(apiKey),
				body: JSON.stringify({ url, max_pages: maxPages }),
				signal,
			},
			60_000,
		);
		if (!res.ok) throw new Error(`Tavily crawl error (${res.status}): ${await res.text()}`);
		const data = (await res.json()) as { results?: TavilyCrawlPage[] };
		return (data.results ?? []).map((p) => ({
			url: p.url ?? "",
			title: p.title ?? "",
			content: p.raw_content ?? "",
		}));
	}

	async map(url: string, signal?: AbortSignal): Promise<string[]> {
		const apiKey = requireApiKey(this.apiKey, "map");
		const res = await fetchWithTimeout(`${BASE}/map`, {
			method: "POST",
			headers: authHeaders(apiKey),
			body: JSON.stringify({ url }),
			signal,
		});
		if (!res.ok) throw new Error(`Tavily map error (${res.status}): ${await res.text()}`);
		const data = (await res.json()) as TavilyMapResponse;
		return data.results ?? [];
	}

	async research(query: string, signal?: AbortSignal): Promise<string> {
		const apiKey = requireApiKey(this.apiKey, "research");
		const res = await fetchWithTimeout(
			`${BASE}/research`,
			{
				method: "POST",
				headers: authHeaders(apiKey),
				body: JSON.stringify({ query }),
				signal,
			},
			120_000,
		);
		if (!res.ok) throw new Error(`Tavily research error (${res.status}): ${await res.text()}`);
		const data = (await res.json()) as TavilyResearchResponse;
		return data.answer ?? "";
	}
}

export default defineProvider({
	name: "tavily",
	label: "Tavily",
	envVar: "TAVILY_API_KEY",
	capabilities: {
		generalSearch: true,
		verticalSearch: false,
		contentExtraction: true,
		crawl: true,
		siteMap: true,
		deepResearch: true,
		batchSearch: false,
		hasMetadata: false,
	},
	searchHint:
		"Optimized for general-purpose AI agent retrieval. Focuses on tech documentation, programming Q&A, and general facts by raw text block extraction and noise filtering.",
	fetchHint:
		"General-purpose markdown web extractor. Strips web noise (headers/footers/ads) with balanced retrieval speed and output structure.",
	searchFallbackPriority: 10,
	fetchFallbackPriority: 10,
	apiKeyRequired: false,
	create: ({ apiKey }) => new TavilyProvider(apiKey),
});
