import assert from "node:assert";
import { afterEach, describe, it, mock } from "node:test";
import { JinaProvider } from "../src/providers/jina.js";

// Sample SSE response from r.jina.ai (observed 2026-07-01)
const SSE_BODY =
	`event: data\ndata: {"title":"Test Page","content":"Hello World\\n\\nThis is extracted content.","httpStatus":200}\n\n` +
	`event: data\ndata: {"title":"Test Page","content":"Hello World\\n\\nThis is extracted content.","httpStatus":200}\n\n`;

function mockSSEFetch(status: number, body: string, contentType = "text/event-stream") {
	mock.method(globalThis, "fetch", () =>
		Promise.resolve({
			ok: status >= 200 && status < 300,
			status,
			text: () => Promise.resolve(body),
			headers: new Headers({ "content-type": contentType }),
		}),
	);
}

afterEach(() => {
	mock.restoreAll();
});

describe("JinaProvider.fetch — SSE parsing", () => {
	it("parses SSE responses and returns clean markdown content", async () => {
		mockSSEFetch(200, SSE_BODY);
		const provider = new JinaProvider("test-key");
		const result = await provider.fetch("https://example.com");

		// Should not contain raw SSE markers
		assert.ok(!result.text.includes("event:"), "should not contain event: marker");
		assert.ok(!result.text.includes("data:"), "should not contain data: marker");
		assert.ok(!result.text.includes("httpStatus"), "should not contain JSON metadata");

		// Should contain actual content
		assert.ok(result.text.includes("Hello World"), "should contain body text");
		assert.ok(result.text.includes("extracted content"), "should contain complete extracted text");

		// Should preserve title
		assert.strictEqual(result.title, "Test Page");

		// Content type should be markdown
		assert.strictEqual(result.contentType, "text/markdown");
	});

	it("extracts only the first SSE event for deduplication", async () => {
		mockSSEFetch(200, SSE_BODY);
		const provider = new JinaProvider(undefined);
		const result = await provider.fetch("https://example.com");

		const occurrences = (result.text.match(/Hello World/g) ?? []).length;
		assert.strictEqual(occurrences, 1, "should not contain duplicate content");
	});

	it("uses only the first event when multiple distinct SSE events are present", async () => {
		const multiSSE =
			`event: data\ndata: {"title":"First","content":"First content.","httpStatus":200}\n\n` +
			`event: data\ndata: {"title":"Second","content":"Second content.","httpStatus":200}\n\n`;
		mockSSEFetch(200, multiSSE);
		const provider = new JinaProvider(undefined);
		const result = await provider.fetch("https://example.com");

		assert.strictEqual(result.title, "First");
		assert.ok(result.text.includes("First content"));
		assert.ok(!result.text.includes("Second"));
	});

	it("returns raw text directly for non-SSE responses", async () => {
		mockSSEFetch(200, "Plain text content", "text/plain");
		const provider = new JinaProvider(undefined);
		const result = await provider.fetch("https://example.com");

		assert.strictEqual(result.text, "Plain text content");
	});
});
