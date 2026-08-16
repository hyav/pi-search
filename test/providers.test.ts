import assert from "node:assert";
import { describe, it } from "node:test";
import {
	buildFetchChain,
	buildSearchChain,
	fetchProviderNames,
	PROVIDERS,
	searchProviderNames,
} from "../src/providers/index.js";

describe("Provider META consistency", () => {
	it("each META contains name, label, envVar, and capabilities", () => {
		for (const m of PROVIDERS) {
			assert.ok(m.name && m.label && m.envVar, `${m.name} missing fundamental fields`);
			assert.ok(m.capabilities, `${m.name} missing capabilities`);
		}
	});

	it("generalSearch=true providers declare searchHint and searchFallbackPriority", () => {
		for (const m of PROVIDERS) {
			if (m.capabilities.generalSearch) {
				assert.ok(m.searchHint, `${m.name} missing searchHint`);
				assert.ok(m.searchFallbackPriority !== undefined, `${m.name} missing searchFallbackPriority`);
			}
		}
	});

	it("contentExtraction=true providers declare fetchHint and fetchFallbackPriority", () => {
		for (const m of PROVIDERS) {
			if (m.capabilities.contentExtraction) {
				assert.ok(m.fetchHint, `${m.name} missing fetchHint`);
				assert.ok(m.fetchFallbackPriority !== undefined, `${m.name} missing fetchFallbackPriority`);
			}
		}
	});

	it("generalSearch=false providers do not declare searchHint or searchFallbackPriority", () => {
		for (const m of PROVIDERS) {
			if (!m.capabilities.generalSearch) {
				assert.strictEqual(m.searchHint, undefined, `${m.name} should not have searchHint`);
				assert.strictEqual(m.searchFallbackPriority, undefined, `${m.name} should not have searchFallbackPriority`);
			}
		}
	});

	it("verticals are declared only when verticalSearch=true", () => {
		for (const m of PROVIDERS) {
			if (m.verticals?.length) {
				assert.ok(m.capabilities.verticalSearch, `${m.name} has verticals but verticalSearch=false`);
			}
		}
	});
});

describe("Dynamic enum/chain generation", () => {
	it("search provider enum contains all generalSearch=true provider names", () => {
		const names = searchProviderNames();
		for (const provider of PROVIDERS.filter((meta) => meta.capabilities.generalSearch)) {
			assert.ok(names.includes(provider.name), `${provider.name} should be exposed for search`);
		}
	});

	it("fetch provider enum contains all contentExtraction=true provider names", () => {
		const names = fetchProviderNames();
		for (const provider of PROVIDERS.filter((meta) => meta.capabilities.contentExtraction)) {
			assert.ok(names.includes(provider.name), `${provider.name} should be exposed for fetch`);
		}
	});

	it("search fallback chain sorts ascending by searchFallbackPriority", () => {
		const chain = buildSearchChain();
		const priorities = new Map(PROVIDERS.map((provider) => [provider.name, provider.searchFallbackPriority]));
		for (let i = 1; i < chain.length; i++) {
			assert.ok(
				priorities.get(chain[i - 1])! <= priorities.get(chain[i])!,
				`search chain is not sorted at ${chain[i - 1]} → ${chain[i]}`,
			);
		}
		assert.deepStrictEqual(
			chain.filter((name) => name === "tavily" || name === "anysearch"),
			["tavily", "anysearch"],
		);
	});

	it("fetch fallback chain sorts ascending by fetchFallbackPriority", () => {
		const chain = buildFetchChain();
		const priorities = new Map(PROVIDERS.map((provider) => [provider.name, provider.fetchFallbackPriority]));
		for (let i = 1; i < chain.length; i++) {
			assert.ok(
				priorities.get(chain[i - 1])! <= priorities.get(chain[i])!,
				`fetch chain is not sorted at ${chain[i - 1]} → ${chain[i]}`,
			);
		}
		assert.deepStrictEqual(
			chain.filter((name) => name === "tavily" || name === "jina" || name === "anysearch"),
			["tavily", "jina", "anysearch"],
		);
	});
});

describe("Zero static coupling architecture", () => {
	it("tool entrypoints and provider registry never hardcode specific provider files", async () => {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");

		for (const relativePath of ["../src/web-search.ts", "../src/web-fetch.ts", "../src/index.ts", "../index.ts"]) {
			const content = await fs.readFile(path.join(import.meta.dirname, relativePath), "utf-8");
			for (const specificProvider of [
				"./tavily",
				"./jina",
				"./anysearch",
				"./providers/tavily",
				"./providers/jina",
				"./providers/anysearch",
			]) {
				assert.equal(
					content.includes(`from "${specificProvider}`),
					false,
					`${relativePath} must not statically import ${specificProvider} to preserve file-level drop-in autonomy`,
				);
			}
		}
	});
});
