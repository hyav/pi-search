// Provider interface — each provider implements search + optional fetch

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	publishedAt?: string;
	score?: number;
}

export interface SearchResponse {
	results: SearchResult[];
}

export interface FetchResponse {
	text: string;
	title?: string;
	contentType?: string;
}

export interface CrawlResult {
	url: string;
	title: string;
	content: string;
}

// Capability flags — each provider declares what it can do.
export interface ProviderCapabilities {
	generalSearch: boolean;
	verticalSearch: boolean;
	contentExtraction: boolean;
	crawl: boolean;
	siteMap: boolean;
	deepResearch: boolean;
	batchSearch: boolean;
	hasMetadata: boolean;
}

// Every provider must implement this interface. search() and fetch() are optional —
// a provider implements whichever it supports and declares them in capabilities.
export interface Provider {
	readonly name: string;
	readonly label: string;
	readonly capabilities: ProviderCapabilities;

	search?(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse>;
	fetch?(url: string, signal?: AbortSignal): Promise<FetchResponse>;

	// Advanced features (all optional)
	crawl?(url: string, maxPages: number, signal?: AbortSignal): Promise<CrawlResult[]>;
	map?(url: string, signal?: AbortSignal): Promise<string[]>;
	research?(query: string, signal?: AbortSignal): Promise<string>;

	verticalSearch?(
		domain: string,
		subDomain: string,
		query: string,
		maxResults: number,
		signal?: AbortSignal,
	): Promise<SearchResponse>;
	batchSearch?(queries: string[], maxResults: number, signal?: AbortSignal): Promise<SearchResponse[]>;
}

// META — static metadata for each provider, available before instantiation.
export interface ProviderMeta {
	name: string;
	label: string;
	envVar: string;
	capabilities: ProviderCapabilities;

	// LLM routing hints (per capability axis)
	searchHint?: string;
	fetchHint?: string;

	// Vertical search domains (only for vertical-capable providers)
	verticals?: readonly string[];

	// Fallback chain ordering (lower = tried first); undefined = excluded from chain
	searchFallbackPriority?: number;
	fetchFallbackPriority?: number;

	// Whether an API key is required to instantiate (default true)
	apiKeyRequired?: boolean;
}
