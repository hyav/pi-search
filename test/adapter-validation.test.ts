import assert from "node:assert";
import { describe, it } from "node:test";
import { defineProvider, type ProviderAdapter, validateProviderAdapter } from "../src/adapter-api.js";

function baseAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
	return {
		name: "valid-test",
		label: "Valid Test",
		envVar: "VALID_TEST_API_KEY",
		capabilities: {
			generalSearch: true,
			verticalSearch: false,
			contentExtraction: false,
			crawl: false,
			siteMap: false,
			deepResearch: false,
			batchSearch: false,
			hasMetadata: false,
		},
		searchHint: "valid hint",
		searchFallbackPriority: 10,
		apiKeyRequired: false,
		create: () => ({
			name: "valid-test",
			label: "Valid Test",
			capabilities: {
				generalSearch: true,
				verticalSearch: false,
				contentExtraction: false,
				crawl: false,
				siteMap: false,
				deepResearch: false,
				batchSearch: false,
				hasMetadata: false,
			},
		}),
		...overrides,
	};
}

describe("validateProviderAdapter — runtime type checks", () => {
	it("accepts a fully valid adapter", () => {
		const adapter = baseAdapter();
		assert.doesNotThrow(() => validateProviderAdapter(adapter));
		assert.strictEqual(defineProvider(adapter), adapter);
	});

	it("rejects non-string name, label, and envVar values", () => {
		for (const [field, value] of [
			["name", 123],
			["name", ""],
			["name", "   "],
			["label", {}],
			["label", 0],
			["envVar", []],
			["envVar", true],
		] as const) {
			assert.throws(
				() => validateProviderAdapter(baseAdapter({ [field]: value })),
				/non-empty string/,
				`${field}=${JSON.stringify(value)} must be rejected`,
			);
		}
	});

	it("rejects missing capabilities and non-boolean capability flags", () => {
		assert.throws(() => validateProviderAdapter(baseAdapter({ capabilities: undefined as never })), /capabilities/);
		for (const key of [
			"generalSearch",
			"verticalSearch",
			"contentExtraction",
			"crawl",
			"siteMap",
			"deepResearch",
			"batchSearch",
			"hasMetadata",
		] as const) {
			assert.throws(
				() =>
					validateProviderAdapter(baseAdapter({ capabilities: { ...baseAdapter().capabilities, [key]: "yes" } })),
				new RegExp(`capabilities\\.${key} must be a boolean`),
				`capabilities.${key}="yes" must be rejected`,
			);
		}
	});

	it("rejects non-finite or non-number fallback priorities", () => {
		for (const value of ["10", NaN, Infinity, null, {}]) {
			assert.throws(
				() => validateProviderAdapter(baseAdapter({ searchFallbackPriority: value as never })),
				/finite number/,
			);
			assert.throws(
				() =>
					validateProviderAdapter(
						baseAdapter({
							capabilities: { ...baseAdapter().capabilities, contentExtraction: true },
							searchHint: undefined,
							searchFallbackPriority: undefined,
							fetchHint: "hint",
							fetchFallbackPriority: value as never,
						}),
					),
				/finite number/,
			);
		}
	});

	it("rejects non-string searchHint/fetchHint", () => {
		assert.throws(() => validateProviderAdapter(baseAdapter({ searchHint: 42 as never })), /searchHint/);
		assert.throws(
			() =>
				validateProviderAdapter(
					baseAdapter({
						capabilities: { ...baseAdapter().capabilities, contentExtraction: true },
						searchHint: undefined,
						searchFallbackPriority: undefined,
						fetchHint: [] as never,
					}),
				),
			/fetchHint/,
		);
	});

	it("rejects verticals that are not an array of non-empty strings", () => {
		for (const verticals of [[1, 2], [""], "finance.us_stock", 7]) {
			assert.throws(() => validateProviderAdapter(baseAdapter({ verticals: verticals as never })), /verticals/);
		}
	});

	it("rejects non-boolean apiKeyRequired", () => {
		assert.throws(() => validateProviderAdapter(baseAdapter({ apiKeyRequired: "yes" as never })), /apiKeyRequired/);
	});

	it("rejects a non-function create factory", () => {
		assert.throws(() => validateProviderAdapter(baseAdapter({ create: {} as never })), /create\(\)/);
	});
});
