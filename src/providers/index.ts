// Provider registry — pluggable factory + metadata + dynamic helpers
//
// Adding a provider:
//   1. Create providers/<name>.ts implementing Provider + exporting META
//   2. Add it to this directory; routing, search, fetch, and config pick it up automatically

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Provider, ProviderMeta } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROVIDERS_MUTABLE: ProviderMeta[] = [];
type ProviderConstructor = new (apiKey: any) => Provider;
const PROVIDER_CLASSES = new Map<string, ProviderConstructor>();

async function loadProvidersFromDir(dirPath: string, relativeImportPrefix?: string) {
	if (!existsSync(dirPath)) return;
	const files = readdirSync(dirPath);
	for (const file of files) {
		if (
			(file.endsWith(".ts") || file.endsWith(".js")) &&
			!file.endsWith(".test.ts") &&
			!file.endsWith(".test.js") &&
			!file.endsWith(".spec.ts") &&
			!file.endsWith(".spec.js") &&
			!file.endsWith(".d.ts") &&
			!file.startsWith("index.") &&
			!file.startsWith("types.")
		) {
			try {
				const nameWithoutExt = file.slice(0, -3);
				const mod = relativeImportPrefix
					? await import(`${relativeImportPrefix}${nameWithoutExt}.js`)
					: await import(pathToFileURL(join(dirPath, `${nameWithoutExt}.js`)).href);

				let meta: ProviderMeta | undefined;
				let providerClass: ProviderConstructor | undefined;

				for (const [key, value] of Object.entries(mod)) {
					if (value && typeof value === "object" && "name" in value && "capabilities" in value) {
						meta = value as ProviderMeta;
					}
					if (typeof value === "function" && key.endsWith("Provider")) {
						providerClass = value as ProviderConstructor;
					}
				}

				if (meta && providerClass) {
					PROVIDERS_MUTABLE.push(meta);
					PROVIDER_CLASSES.set(meta.name, providerClass);
				}
			} catch (err) {
				console.error(`Failed to load provider module from ${file}:`, err instanceof Error ? err.message : err);
			}
		}
	}
}

// Scan provider directory
await loadProvidersFromDir(__dirname, "./");

export const PROVIDERS: readonly ProviderMeta[] = PROVIDERS_MUTABLE;

export function searchProviderNames(): string[] {
	return PROVIDERS.filter((p) => p.capabilities.generalSearch).map((p) => p.name);
}

export function fetchProviderNames(): string[] {
	return PROVIDERS.filter((p) => p.capabilities.contentExtraction).map((p) => p.name);
}

export function allVerticals(): string[] {
	return PROVIDERS.flatMap((p) => p.verticals ?? []);
}

export function buildSearchChain(): string[] {
	return PROVIDERS.filter((p) => p.capabilities.generalSearch && p.searchFallbackPriority !== undefined)
		.sort((a, b) => a.searchFallbackPriority! - b.searchFallbackPriority!)
		.map((p) => p.name);
}

export function buildFetchChain(): string[] {
	return PROVIDERS.filter((p) => p.capabilities.contentExtraction && p.fetchFallbackPriority !== undefined)
		.sort((a, b) => a.fetchFallbackPriority! - b.fetchFallbackPriority!)
		.map((p) => p.name);
}

export function searchPromptGuidelines(): string[] {
	const lines: string[] = [
		"Use web_search for information beyond your training data — current events, recent docs, live data, academic papers, stock prices, CVEs.",
		"For web_search, choose a provider based on the query domain.",
	];

	for (const meta of PROVIDERS) {
		if (meta.searchHint) {
			lines.push(`For web_search, ${meta.label} (provider='${meta.name}'): ${meta.searchHint}`);
		}
	}

	const verts = allVerticals();
	const verticalProviders = PROVIDERS.filter((p) => p.capabilities.verticalSearch && p.verticals?.length);
	if (verticalProviders.length > 0 && verts.length > 0) {
		lines.push("For structured vertical data in web_search, select a vertical-capable provider and pass a vertical.");
		for (const p of verticalProviders) {
			lines.push(
				`For web_search, ${p.label} supports these verticals: ${p.verticals!.map((v) => `'${v}'`).join(", ")}.`,
			);
		}
		lines.push("Example for web_search: provider='anysearch' + vertical='finance.us_stock' for a stock price query.");
	}

	lines.push(
		"If unsure which provider fits, omit provider in web_search — it uses a cost-priority fallback chain (general-purpose first).",
		'After answering with web_search, include a "Sources:" section with markdown hyperlinks: [Title](URL).',
		"Use web_fetch after web_search to read full page content — web_search returns snippets only.",
		"Use {queries:[...]} with 2-4 varied angles in web_search for broader coverage — each query routes independently.",
	);

	return lines;
}

export function fetchPromptGuidelines(): string[] {
	const lines: string[] = [
		"Use web_fetch to read the full content of a URL — use it after web_search when a snippet is too short.",
		"For web_fetch, choose a provider based on the page type.",
	];

	for (const meta of PROVIDERS) {
		if (meta.fetchHint) {
			lines.push(`For web_fetch, ${meta.label} (provider='${meta.name}'): ${meta.fetchHint}`);
		}
	}

	lines.push(
		"If unsure which provider fits, omit provider in web_fetch — it uses a cost-priority fallback chain (fast/free first, heavy JS-rendering last).",
		'After reading content with web_fetch, include a "Sources:" section with markdown hyperlinks to the fetched URLs.',
		"Large web_fetch results are truncated — the full content path is reported in the result, so use the read tool to access it.",
	);

	return lines;
}

export interface ProviderOptions {
	apiKey: string | undefined;
}

export function createProvider(name: string, opts: ProviderOptions): Provider {
	const { apiKey } = opts;
	const meta = PROVIDERS.find((p) => p.name === name);
	if (!meta) {
		throw new Error(`Unknown provider: "${name}". Available: ${PROVIDERS.map((p) => p.name).join(", ")}`);
	}

	const keyRequired = meta.apiKeyRequired ?? true;
	if (keyRequired && !apiKey) {
		throw new Error(`${meta.label} requires an API key`);
	}

	const ProviderClass = PROVIDER_CLASSES.get(name);
	if (!ProviderClass) {
		throw new Error(`Implementation class for provider "${name}" not found`);
	}

	return new ProviderClass(apiKey);
}

export function createAvailableProviders(apiKeys: Record<string, string | undefined>): Map<string, Provider> {
	const providers = new Map<string, Provider>();
	for (const meta of PROVIDERS) {
		const key = apiKeys[meta.name];
		const keyRequired = meta.apiKeyRequired ?? true;
		if (!key && keyRequired) continue;
		try {
			providers.set(meta.name, createProvider(meta.name, { apiKey: key }));
		} catch (err) {
			console.error(`Failed to initialize provider "${meta.name}":`, err instanceof Error ? err.message : err);
			// skip providers that fail to initialize
		}
	}
	return providers;
}
