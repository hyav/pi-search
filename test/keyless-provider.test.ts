import assert from "node:assert";
import { describe, it, mock } from "node:test";
import { AnysearchProvider } from "../src/providers/anysearch.js";
import { JinaProvider } from "../src/providers/jina.js";
import { TavilyProvider } from "../src/providers/tavily.js";

function header(init: RequestInit | undefined, name: string): string | null {
	return new Headers(init?.headers).get(name);
}

describe("keyless providers", () => {
	it("uses Tavily keyless access mode without an Authorization header", async () => {
		const response = new Response(JSON.stringify({ results: [] }), { status: 200 });
		const fetchMock = mock.method(globalThis, "fetch", () => Promise.resolve(response));

		try {
			await new TavilyProvider(undefined).search("test", 5);
			const [, init] = fetchMock.mock.calls[0].arguments as [string, RequestInit];
			assert.strictEqual(header(init, "x-tavily-access-mode"), "keyless");
			assert.strictEqual(header(init, "authorization"), null);
		} finally {
			fetchMock.mock.restore();
		}
	});

	it("omits Authorization for anonymous AnySearch requests", async () => {
		const response = new Response(JSON.stringify({ code: 0, message: "success", data: { results: [] } }), {
			status: 200,
		});
		const fetchMock = mock.method(globalThis, "fetch", () => Promise.resolve(response));

		try {
			await new AnysearchProvider(undefined).search("test", 5);
			const [, init] = fetchMock.mock.calls[0].arguments as [string, RequestInit];
			assert.strictEqual(header(init, "authorization"), null);
		} finally {
			fetchMock.mock.restore();
		}
	});

	it("propagates caller cancellation from AnySearch batch search", async () => {
		const controller = new AbortController();
		const reason = new Error("AnySearch batch cancelled by caller");
		controller.abort(reason);

		await assert.rejects(
			new AnysearchProvider(undefined).batchSearch(["first", "second"], 5, controller.signal),
			(error) => error === reason,
		);
	});

	it("omits Authorization for anonymous Jina requests", async () => {
		const fetchMock = mock.method(globalThis, "fetch", () =>
			Promise.resolve(new Response("content", { status: 200 })),
		);

		try {
			await new JinaProvider(undefined).fetch("https://example.com");
			const [, init] = fetchMock.mock.calls[0].arguments as [string, RequestInit];
			assert.strictEqual(header(init, "authorization"), null);
		} finally {
			fetchMock.mock.restore();
		}
	});

	it("reports AnySearch API errors from fetch", async () => {
		const response = new Response(JSON.stringify({ code: 401, message: "invalid key" }), { status: 200 });
		const fetchMock = mock.method(globalThis, "fetch", () => Promise.resolve(response));

		try {
			await assert.rejects(
				new AnysearchProvider("anysearch-test-key").fetch("https://example.com"),
				/AnySearch API error: invalid key/,
			);
		} finally {
			fetchMock.mock.restore();
		}
	});

	describe("configured keys", () => {
		it("uses a configured Tavily key for search and fetch", async () => {
			const responses = [
				new Response(JSON.stringify({ results: [] }), { status: 200 }),
				new Response(JSON.stringify({ results: [{ raw_content: "content" }] }), { status: 200 }),
			];
			const fetchMock = mock.method(globalThis, "fetch", () => Promise.resolve(responses.shift()!));

			try {
				const provider = new TavilyProvider("tavily-test-key");
				await provider.search("test", 5);
				await provider.fetch("https://example.com");

				for (const call of fetchMock.mock.calls) {
					const [, init] = call.arguments as [string, RequestInit];
					assert.strictEqual(header(init, "authorization"), "Bearer tavily-test-key");
					assert.strictEqual(header(init, "x-tavily-access-mode"), null);
				}
			} finally {
				fetchMock.mock.restore();
			}
		});

		it("uses a configured AnySearch key for search and fetch", async () => {
			const responses = [
				new Response(JSON.stringify({ code: 0, message: "success", data: { results: [] } }), { status: 200 }),
				new Response(
					JSON.stringify({
						code: 0,
						message: "success",
						data: { results: [{ content: "content" }] },
					}),
					{ status: 200 },
				),
			];
			const fetchMock = mock.method(globalThis, "fetch", () => Promise.resolve(responses.shift()!));

			try {
				const provider = new AnysearchProvider("anysearch-test-key");
				await provider.search("test", 5);
				await provider.fetch("https://example.com");

				for (const call of fetchMock.mock.calls) {
					const [, init] = call.arguments as [string, RequestInit];
					assert.strictEqual(header(init, "authorization"), "Bearer anysearch-test-key");
				}
			} finally {
				fetchMock.mock.restore();
			}
		});

		it("uses a configured Jina key for fetch", async () => {
			const fetchMock = mock.method(globalThis, "fetch", () =>
				Promise.resolve(new Response("content", { status: 200 })),
			);

			try {
				await new JinaProvider("jina-test-key").fetch("https://example.com");
				const [, init] = fetchMock.mock.calls[0].arguments as [string, RequestInit];
				assert.strictEqual(header(init, "authorization"), "Bearer jina-test-key");
			} finally {
				fetchMock.mock.restore();
			}
		});
	});
});
