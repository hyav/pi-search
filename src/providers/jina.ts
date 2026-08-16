import { defineProvider } from "../adapter-api.js";
import { fetchWithTimeout } from "../utils.js";
import type { FetchResponse, Provider } from "./types.js";

// Jina AI provider — reader only (search endpoint deliberately not exposed,
// see ADR-0003)
//
// r.jina.ai returns SSE (Server-Sent Events) format by default.
// We parse the first data event to extract clean markdown content.

interface JinaSSEData {
	title?: string;
	content?: string;
}

function parseSSE(text: string): JinaSSEData | null {
	// SSE format:
	//   event: data
	//   data: {"title":"...","content":"..."}
	//
	//   event: data
	//   data: {...}
	//
	// We extract the first data event only.
	const lines = text.split("\n");
	let dataLine = "";
	for (const line of lines) {
		if (line.startsWith("data:")) {
			dataLine = line.slice(5).trim();
			break;
		}
	}
	if (!dataLine) return null;
	try {
		return JSON.parse(dataLine) as JinaSSEData;
	} catch {
		return null;
	}
}

export class JinaProvider implements Provider {
	readonly name = "jina";
	readonly label = "Jina";
	readonly capabilities = {
		generalSearch: false,
		verticalSearch: false,
		contentExtraction: true,
		crawl: false,
		siteMap: false,
		deepResearch: false,
		batchSearch: false,
		hasMetadata: false,
	};

	constructor(private readonly apiKey: string | undefined) {}

	async fetch(url: string, signal?: AbortSignal): Promise<FetchResponse> {
		const headers: Record<string, string> = { Accept: "text/event-stream" };
		if (this.apiKey) {
			headers.Authorization = `Bearer ${this.apiKey}`;
		}
		const res = await fetchWithTimeout(`https://r.jina.ai/${url}`, { headers, signal });
		if (!res.ok) throw new Error(`Jina fetch error (${res.status}): ${await res.text()}`);
		const raw = await res.text();
		if (!raw.trim()) throw new Error(`Jina fetch: no content for ${url}`);

		// Parse SSE if the response looks like SSE
		const sse = parseSSE(raw);
		if (sse?.content) {
			return {
				text: sse.content,
				title: sse.title,
				contentType: "text/markdown",
			};
		}

		// Fallback: plain text response (backward compatible)
		return { text: raw, contentType: "text/markdown" };
	}
}

export default defineProvider({
	name: "jina",
	label: "Jina",
	envVar: "JINA_API_KEY",
	capabilities: {
		generalSearch: false,
		verticalSearch: false,
		contentExtraction: true,
		crawl: false,
		siteMap: false,
		deepResearch: false,
		batchSearch: false,
		hasMetadata: false,
	},
	// No searchHint — deliberately excluded from search routing
	fetchHint:
		"Fast, lightweight reader that converts web pages and PDF files into LLM-friendly Markdown. Features native PDF parsing and low latency, best for static articles and documents.",
	// No verticals
	// No searchFallbackPriority — excluded from search chain
	fetchFallbackPriority: 15,
	apiKeyRequired: false,
	create: ({ apiKey }) => new JinaProvider(apiKey),
});
