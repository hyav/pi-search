import assert from "node:assert";
import { describe, it } from "node:test";
import { createAvailableProviders, createProvider, PROVIDERS } from "../src/providers/index.js";

describe("createProvider", () => {
	it("creates Tavily instance when API key is provided", () => {
		const p = createProvider("tavily", { apiKey: "test-key" });
		assert.ok(p);
		assert.strictEqual(p.name, "tavily");
		assert.ok(p.capabilities.generalSearch);
		assert.ok(typeof p.search === "function");
		assert.ok(typeof p.fetch === "function");
	});

	it("creates Jina instance when API key is provided", () => {
		const p = createProvider("jina", { apiKey: "test-key" });
		assert.ok(p);
		assert.strictEqual(p.name, "jina");
		assert.ok(p.capabilities.contentExtraction);
		assert.strictEqual(p.search, undefined, "Jina should not have search()");
		assert.ok(typeof p.fetch === "function");
	});

	it("creates Jina instance without API key (apiKey undefined)", () => {
		const p = createProvider("jina", { apiKey: undefined });
		assert.ok(p);
		assert.strictEqual(p.name, "jina");
	});

	it("creates AnySearch instance without API key (apiKey undefined)", () => {
		const p = createProvider("anysearch", { apiKey: undefined });
		assert.ok(p);
		assert.strictEqual(p.name, "anysearch");
		assert.ok(p.capabilities.generalSearch);
	});

	it("throws error for unknown provider", () => {
		assert.throws(() => createProvider("unknown", { apiKey: "k" }));
	});
});

describe("createAvailableProviders", () => {
	it("creates all built-in providers when keys are provided", () => {
		const providers = createAvailableProviders({
			tavily: "k1",
			anysearch: "k2",
			jina: "k3",
		});
		assert.ok(providers.has("tavily"));
		assert.ok(providers.has("anysearch"));
		assert.ok(providers.has("jina"));
		assert.strictEqual(providers.size, 3);
	});

	it("creates keyless-capable built-in providers when keys are absent", () => {
		const providers = createAvailableProviders({});
		assert.ok(providers.has("tavily"), "Tavily keyless should be created");
		assert.ok(providers.has("anysearch"), "AnySearch anonymous access should be created");
		assert.ok(providers.has("jina"), "Jina keyless should be created");
	});

	it("creates all loaded providers when all keys are supplied", () => {
		const keys: Record<string, string> = {};
		for (const p of PROVIDERS) {
			keys[p.name] = "k";
		}
		const providers = createAvailableProviders(keys);
		assert.strictEqual(providers.size, PROVIDERS.length);
	});

	it("throws error when creating a key-required provider with undefined key", () => {
		const required = PROVIDERS.find((provider) => provider.apiKeyRequired !== false);
		if (!required) return;
		assert.throws(
			() => createProvider(required.name, { apiKey: undefined }),
			new RegExp(`${required.label} requires an API key`),
		);
	});

	it("throws error when creating a key-required provider with empty string key", () => {
		const required = PROVIDERS.find((provider) => provider.apiKeyRequired !== false);
		if (!required) return;
		assert.throws(
			() => createProvider(required.name, { apiKey: "" }),
			new RegExp(`${required.label} requires an API key`),
		);
	});
});
