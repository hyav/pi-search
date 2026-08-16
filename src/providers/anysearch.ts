import { fetchWithTimeout } from "../utils.js";
import type { FetchResponse, Provider, ProviderMeta, SearchResponse, SearchResult } from "./types.js";

// Anysearch REST API client
//
// Endpoints:
//   POST https://api.anysearch.com/v1/search  — general + vertical search
//   POST https://api.anysearch.com/v1/extract — content extraction
//
// Vertical domains: finance, academic, security, travel, legal, health,
//   geo, code, ecommerce, gaming, film, music, business, ip, environment,
//   energy, home, education, religion, fashion, tech
//
// Docs: https://www.anysearch.com/docs

const BASE = "https://api.anysearch.com";

interface AnysearchRawResult {
	title?: string;
	url?: string;
	description?: string;
	content?: string;
	raw_content?: string;
	score?: number;
	quality_score?: number;
	published_at?: string;
	source?: string;
}

// Actual API wraps response in { code, message, data: { results, metadata } }
interface AnysearchEnvelope {
	code: number;
	message: string;
	data: {
		results?: AnysearchRawResult[];
		metadata?: {
			total_results?: number;
			search_time_ms?: number;
			request_id?: string;
		};
	};
}

function authHeaders(apiKey: string | undefined): Record<string, string> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
	return headers;
}

function normalizeResults(raw: AnysearchRawResult[]): SearchResult[] {
	return raw.map((r) => ({
		title: r.title ?? "",
		url: r.url ?? "",
		snippet: (r.content && r.content.length > 10 ? r.content : r.description) ?? "",
		score: r.quality_score ?? r.score,
		publishedAt: r.published_at,
	}));
}

async function doSearch(
	apiKey: string | undefined,
	body: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<AnysearchEnvelope["data"]> {
	const res = await fetchWithTimeout(`${BASE}/v1/search`, {
		method: "POST",
		headers: authHeaders(apiKey),
		body: JSON.stringify(body),
		signal,
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`AnySearch search error (${res.status}): ${text}`);
	}
	const envelope = (await res.json()) as AnysearchEnvelope;
	if (envelope.code !== 0) {
		throw new Error(`AnySearch API error: ${envelope.message}`);
	}
	return envelope.data;
}

export const ANYSEARCH_META = {
	name: "anysearch",
	label: "AnySearch",
	envVar: "ANYSEARCH_API_KEY",
	capabilities: {
		generalSearch: true,
		verticalSearch: true,
		contentExtraction: true,
		crawl: false,
		siteMap: false,
		deepResearch: false,
		batchSearch: true,
		hasMetadata: true,
	},
	searchHint:
		"Provides structured vertical search (like US stocks, academic archives, security vulnerabilities, or travel metadata) tailored for niche domains when a specific 'vertical' is specified.",
	fetchHint:
		"Extracts structured metadata (e.g. pub dates, authors, specifications) along with the core content from domain-specific vertical pages.",
	verticals: ["finance.us_stock", "academic.search", "security.scan", "travel"] as const,
	searchFallbackPriority: 30,
	fetchFallbackPriority: 25,
	apiKeyRequired: false,
} as const satisfies ProviderMeta;

export class AnysearchProvider implements Provider {
	readonly name = ANYSEARCH_META.name;
	readonly label = ANYSEARCH_META.label;
	readonly capabilities = ANYSEARCH_META.capabilities;

	constructor(private readonly apiKey: string | undefined) {}

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
		const data = await doSearch(this.apiKey, { query, max_results: maxResults }, signal);
		return { results: normalizeResults(data.results ?? []) };
	}

	async verticalSearch(
		domain: string,
		subDomain: string,
		query: string,
		maxResults: number,
		signal?: AbortSignal,
	): Promise<SearchResponse> {
		const data = await doSearch(
			this.apiKey,
			{
				query,
				max_results: maxResults,
				domains: [domain],
				tags: [subDomain],
			},
			signal,
		);
		return { results: normalizeResults(data.results ?? []) };
	}

	async batchSearch(queries: string[], maxResults: number, signal?: AbortSignal): Promise<SearchResponse[]> {
		signal?.throwIfAborted();
		// Anysearch v1 doesn't have a native batch endpoint — run in parallel
		const results = await Promise.all(
			queries.map(async (q) => {
				try {
					return await this.search(q, maxResults, signal);
				} catch (_err) {
					signal?.throwIfAborted();
					return { results: [] as SearchResult[] };
				}
			}),
		);
		signal?.throwIfAborted();
		return results;
	}

	async fetch(url: string, signal?: AbortSignal): Promise<FetchResponse> {
		const res = await fetchWithTimeout(`${BASE}/v1/extract`, {
			method: "POST",
			headers: authHeaders(this.apiKey),
			body: JSON.stringify({ url }),
			signal,
		});
		if (!res.ok) {
			throw new Error(`AnySearch extract error (${res.status}): ${await res.text().catch(() => "")}`);
		}
		const envelope = (await res.json()) as {
			code: number;
			message: string;
			data?: { results?: AnysearchRawResult[] };
		};
		if (envelope.code !== 0) {
			throw new Error(`AnySearch API error: ${envelope.message}`);
		}
		const r = envelope.data?.results?.[0];
		if (!r?.content && !r?.raw_content) {
			throw new Error(`AnySearch extract: no content for ${url}`);
		}
		return {
			text: (r.raw_content ?? r.content)!,
			title: r.title,
			contentType: "text/markdown",
		};
	}
}
