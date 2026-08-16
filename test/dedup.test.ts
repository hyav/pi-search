import assert from "node:assert";
import { describe, it } from "node:test";
import type { SearchResult } from "../src/providers/types.js";
import { deduplicateResults } from "../src/utils.js";

describe("Search Results Deduplication (deduplicateResults)", () => {
	it("should return the exact same array if there are no duplicates", () => {
		const results: SearchResult[] = [
			{ title: "Page A", url: "https://example.com/a", snippet: "Snippet A" },
			{ title: "Page B", url: "https://example.com/b", snippet: "Snippet B" },
			{ title: "Page C", url: "https://example.com/c", snippet: "Snippet C" },
		];

		const deduped = deduplicateResults(results);
		assert.deepStrictEqual(deduped, results);
		assert.strictEqual(deduped.length, 3);
	});

	it("should remove exact duplicate URLs and keep the first occurrence", () => {
		const results: SearchResult[] = [
			{ title: "Page A1", url: "https://example.com/a", snippet: "Snippet A1" },
			{ title: "Page B", url: "https://example.com/b", snippet: "Snippet B" },
			{ title: "Page A2", url: "https://example.com/a", snippet: "Snippet A2" }, // Duplicate of 1st
			{ title: "Page C", url: "https://example.com/c", snippet: "Snippet C" },
		];

		const deduped = deduplicateResults(results);
		assert.strictEqual(deduped.length, 3);
		assert.strictEqual(deduped[0].title, "Page A1"); // Keep first occurrence
		assert.strictEqual(deduped[1].title, "Page B");
		assert.strictEqual(deduped[2].title, "Page C");
	});

	it("should perform case-insensitive deduplication for URLs", () => {
		const results: SearchResult[] = [
			{ title: "Upper Page", url: "HTTPS://EXAMPLE.COM/PAGE", snippet: "Upper case" },
			{ title: "Lower Page", url: "https://example.com/page", snippet: "Lower case" }, // Duplicate casing
			{ title: "Mixed Page", url: "Https://Example.Com/Page", snippet: "Mixed case" }, // Duplicate casing
		];

		const deduped = deduplicateResults(results);
		assert.strictEqual(deduped.length, 1);
		assert.strictEqual(deduped[0].title, "Upper Page"); // Keep first occurrence
	});

	it("should handle empty arrays without errors", () => {
		const results: SearchResult[] = [];
		const deduped = deduplicateResults(results);
		assert.deepStrictEqual(deduped, []);
	});
});
