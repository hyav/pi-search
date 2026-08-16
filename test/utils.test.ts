import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import {
	assertSafeDns,
	cleanHtmlToMarkdown,
	dnsClient,
	fetchWithRetry,
	fetchWithTimeout,
	isPrivateIP,
	MAX_DIRECT_RESPONSE_BYTES,
	SafeMemoryCache,
	safeFetch,
} from "../src/utils.js";

interface MockDnsAddresses {
	lookup?: string[];
	ipv4?: string[];
	ipv6?: string[];
}

async function withMockDns<T>(addresses: MockDnsAddresses, run: () => Promise<T>): Promise<T> {
	const originalLookup = dnsClient.lookup;
	const originalResolve4 = dnsClient.resolve4;
	const originalResolve6 = dnsClient.resolve6;

	dnsClient.lookup = (async () =>
		(addresses.lookup ?? []).map((address) => ({
			address,
			family: address.includes(":") ? 6 : 4,
		}))) as unknown as typeof dnsClient.lookup;
	dnsClient.resolve4 = (async () => addresses.ipv4 ?? []) as unknown as typeof dnsClient.resolve4;
	dnsClient.resolve6 = (async () => addresses.ipv6 ?? []) as unknown as typeof dnsClient.resolve6;

	try {
		return await run();
	} finally {
		dnsClient.lookup = originalLookup;
		dnsClient.resolve4 = originalResolve4;
		dnsClient.resolve6 = originalResolve6;
	}
}

describe("Utility Suite — isPrivateIP", () => {
	it("should flag private and non-public IPv4 addresses", () => {
		for (const address of [
			"0.0.0.0",
			"10.0.0.1",
			"100.64.0.1",
			"100.127.255.255",
			"127.0.0.1",
			"169.254.169.254",
			"172.16.0.1",
			"172.31.255.255",
			"192.0.2.1",
			"192.168.1.1",
			"198.18.0.1",
			"198.51.100.1",
			"203.0.113.1",
			"224.0.0.1",
			"255.255.255.255",
		]) {
			assert.strictEqual(isPrivateIP(address), true, address);
		}
	});

	it("should not flag globally routable IPv4 addresses", () => {
		for (const address of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "100.128.0.1", "172.15.255.255", "172.32.0.1"]) {
			assert.strictEqual(isPrivateIP(address), false, address);
		}
	});

	it("should flag private and non-public IPv6 addresses", () => {
		for (const address of [
			"::",
			"::1",
			"[::1]",
			"::ffff:127.0.0.1",
			"::ffff:10.0.0.1",
			"64:ff9b::127.0.0.1",
			"100::1",
			"2001::1",
			"2001:db8::1",
			"2002:7f00:1::",
			"3fff::1",
			"4000::1",
			"fc00::",
			"fdff::ffff",
			"fe80::1",
			"ff02::1",
		]) {
			assert.strictEqual(isPrivateIP(address), true, address);
		}
	});

	it("should not flag globally routable IPv6 addresses", () => {
		assert.strictEqual(isPrivateIP("2606:4700:4700::1111"), false);
	});
});

describe("Utility Suite — assertSafeDns", () => {
	it("should reject private or non-public IP inputs immediately", async () => {
		await assert.rejects(assertSafeDns("http://127.0.0.1/"), /Blocked non-public IP/);
		await assert.rejects(assertSafeDns("https://10.0.0.254/"), /Blocked non-public IP/);
		await assert.rejects(assertSafeDns("https://100.64.0.1/"), /Blocked non-public IP/);
	});

	it("should reject unsupported protocols, credentials, and local-only hostnames", async () => {
		await assert.rejects(assertSafeDns("file:///etc/passwd"), /Unsupported URL protocol/);
		await assert.rejects(assertSafeDns("https://user:secret@example.com/"), /must not include credentials/);
		await assert.rejects(assertSafeDns("http://localhost/"), /Blocked non-public hostname/);
		await assert.rejects(assertSafeDns("http://printer.local/"), /Blocked non-public hostname/);
		await assert.rejects(assertSafeDns("http://intranet/"), /Blocked non-public hostname/);
	});

	it("should accept safe public IPs immediately", async () => {
		const res = await assertSafeDns("https://8.8.8.8/");
		assert.deepStrictEqual(res, { url: "https://8.8.8.8/", ip: "8.8.8.8" });
	});

	it("should reject non-public IPv6 URL inputs, including mapped IPv4", async () => {
		await assert.rejects(assertSafeDns("http://[::1]/"), /Blocked non-public IP/);
		await assert.rejects(assertSafeDns("http://[fe80::1]/"), /Blocked non-public IP/);
		await assert.rejects(assertSafeDns("http://[::ffff:127.0.0.1]/"), /Blocked non-public IP/);
	});

	it("should normalize safe IPv6 URL inputs for the locked connection", async () => {
		const res = await assertSafeDns("https://[2606:4700:4700::1111]/");
		assert.deepStrictEqual(res, { url: "https://[2606:4700:4700::1111]/", ip: "2606:4700:4700::1111" });
	});

	it("should reject resolving to private or non-public addresses", async () => {
		await withMockDns({ lookup: ["127.0.0.1"] }, () =>
			assert.rejects(assertSafeDns("http://private-resolved-domain.example.net/"), /SSRF Blocked/),
		);
		await withMockDns({ lookup: ["198.51.100.1"] }, () =>
			assert.rejects(assertSafeDns("http://reserved-resolved-domain.example.net/"), /SSRF Blocked/),
		);
	});

	it("should reject domains resolving to multiple IPs containing a private address", async () => {
		await withMockDns({ lookup: ["8.8.8.8"], ipv4: ["8.8.8.8", "192.168.1.1"] }, () =>
			assert.rejects(
				assertSafeDns("https://mixed-resolved-domain.example.net/"),
				/SSRF Blocked/i,
				"Should block mixed IP resolution",
			),
		);
	});

	it("should accept public domain names", async () => {
		await withMockDns({ lookup: ["93.184.216.34"] }, async () => {
			const res = await assertSafeDns("https://public-resolved-domain.example.net/");
			assert.deepStrictEqual(res, { url: "https://public-resolved-domain.example.net/", ip: "93.184.216.34" });
		});
	});

	it("should propagate cancellation while DNS resolution is pending", async () => {
		const originalLookup = dnsClient.lookup;
		const originalResolve4 = dnsClient.resolve4;
		const originalResolve6 = dnsClient.resolve6;
		const pending = async () => new Promise<never>(() => undefined);
		dnsClient.lookup = pending as unknown as typeof dnsClient.lookup;
		dnsClient.resolve4 = pending as unknown as typeof dnsClient.resolve4;
		dnsClient.resolve6 = pending as unknown as typeof dnsClient.resolve6;
		const controller = new AbortController();

		try {
			const request = assertSafeDns("https://cancelled-dns.example.net/", controller.signal);
			controller.abort(new Error("DNS cancelled by caller"));
			await assert.rejects(request, /DNS cancelled by caller/);
		} finally {
			dnsClient.lookup = originalLookup;
			dnsClient.resolve4 = originalResolve4;
			dnsClient.resolve6 = originalResolve6;
		}
	});
});

describe("Utility Suite — safeFetch", () => {
	let server: any;
	let port: number;

	before(async () => {
		const http = await import("node:http");
		server = http.createServer((req, res) => {
			if (req.url === "/declared-too-large") {
				res.writeHead(200, { "Content-Length": String(MAX_DIRECT_RESPONSE_BYTES + 1) });
				res.end();
				return;
			}
			if (req.url === "/chunked-too-large") {
				res.writeHead(200, { "Content-Type": "application/octet-stream" });
				res.end(Buffer.alloc(MAX_DIRECT_RESPONSE_BYTES + 1));
				return;
			}
			res.writeHead(200, { "Content-Type": "text/plain" });
			res.end("Safe Hello");
		});
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", () => {
				port = (server.address() as any).port;
				resolve();
			});
		});
	});

	after(() => {
		server.close();
	});

	it("should enforce safeIp using custom lookup for HTTP connection", async () => {
		const url = `http://fake-domain-which-does-not-exist.com:${port}/`;
		const res = await safeFetch(url, "127.0.0.1");
		assert.strictEqual(res.status, 200);
		const text = await res.text();
		assert.strictEqual(text, "Safe Hello");
	});

	it("rejects declared and chunked responses above the byte budget", async () => {
		const base = `http://fake-domain-which-does-not-exist.com:${port}`;
		await assert.rejects(safeFetch(`${base}/declared-too-large`, "127.0.0.1"), /PAYLOAD_TOO_LARGE/);
		await assert.rejects(safeFetch(`${base}/chunked-too-large`, "127.0.0.1"), /PAYLOAD_TOO_LARGE/);
	});
});

describe("Utility Suite — SafeMemoryCache", () => {
	it("should save and retrieve cached values", () => {
		const cache = new SafeMemoryCache<string>(50, 5);
		cache.set("key1", "value1");
		assert.strictEqual(cache.get("key1"), "value1");
	});

	it("should handle expiration based on TTL", async () => {
		const cache = new SafeMemoryCache<string>(10, 5); // 10ms TTL
		cache.set("key1", "expired_val");

		assert.strictEqual(cache.get("key1"), "expired_val");

		await new Promise((resolve) => setTimeout(resolve, 15)); // wait 15ms

		assert.strictEqual(cache.get("key1"), null);
	});

	it("should enforce FIFO eviction policy on overflow", () => {
		const cache = new SafeMemoryCache<string>(1000, 3); // Max size: 3
		cache.set("a", "1");
		cache.set("b", "2");
		cache.set("c", "3");

		assert.strictEqual(cache.get("a"), "1");

		cache.set("d", "4"); // Overflows -> "a" gets evicted

		assert.strictEqual(cache.get("a"), null);
		assert.strictEqual(cache.get("b"), "2");
		assert.strictEqual(cache.get("c"), "3");
		assert.strictEqual(cache.get("d"), "4");
	});
});

describe("Utility Suite — fetchWithTimeout & fetchWithRetry", () => {
	let originalFetch: typeof global.fetch;

	before(() => {
		originalFetch = global.fetch;
	});

	after(() => {
		global.fetch = originalFetch;
	});

	it("should succeed if network request completes under the timeout", async () => {
		global.fetch = async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
			return new Response("Done");
		};

		const res = await fetchWithTimeout("https://test.com", {}, 100);
		assert.strictEqual(res.status, 200);
	});

	it("should reject with timeout error if request takes too long", async () => {
		global.fetch = async () => {
			await new Promise((resolve) => setTimeout(resolve, 100));
			return new Response("Slow");
		};

		await assert.rejects(fetchWithTimeout("https://test.com", {}, 10), /timed out after 10ms/);
	});

	it("should propagate caller cancellation even when the transport ignores its signal", async () => {
		const controller = new AbortController();
		global.fetch = async () => new Promise<Response>(() => undefined);
		const request = fetchWithTimeout("https://test.com", { signal: controller.signal }, 1000);
		setTimeout(() => controller.abort(new Error("cancelled by caller")), 10);

		await assert.rejects(request, /cancelled by caller/);
	});

	it("should keep the timeout active while reading the response body", async () => {
		global.fetch = async () =>
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("partial"));
					},
				}),
			);

		await assert.rejects(fetchWithTimeout("https://test.com", {}, 10), /timed out after 10ms/);
	});

	it("should reject declared and streamed responses above the byte budget", async () => {
		global.fetch = async () => new Response("12345", { headers: { "Content-Length": "5" } });
		await assert.rejects(fetchWithTimeout("https://test.com", {}, 100, undefined, 4), /PAYLOAD_TOO_LARGE/);

		global.fetch = async () => new Response("12345");
		await assert.rejects(fetchWithTimeout("https://test.com", {}, 100, undefined, 4), /PAYLOAD_TOO_LARGE/);
	});

	it("should propagate caller cancellation without retrying", async () => {
		const controller = new AbortController();
		controller.abort(new Error("cancelled by caller"));
		let calls = 0;
		global.fetch = async () => {
			calls++;
			return new Response("unexpected");
		};

		await assert.rejects(fetchWithRetry("https://test.com", { signal: controller.signal }, 2), /cancelled by caller/);
		assert.strictEqual(calls, 0);
	});

	it("should retry on HTTP 429", async () => {
		let calls = 0;
		global.fetch = async () => {
			calls++;
			if (calls === 1) {
				return new Response("Too Many Requests", { status: 429 });
			}
			return new Response("Success", { status: 200 });
		};

		const res = await fetchWithRetry("https://test.com", {}, 1);
		assert.strictEqual(calls, 2);
		assert.strictEqual(res.status, 200);
	});
});

describe("Utility Suite — cleanHtmlToMarkdown", () => {
	it("strips non-content tags and converts core rich text elements to Markdown", () => {
		const html = `
			<!DOCTYPE html>
			<html>
			<head><title>Test Page</title><style>body { color: red; }</style></head>
			<body>
				<header><h1>Header Title</h1></header>
				<nav><a href="/home">Home</a></nav>
				<main>
					<h1 class="title">Main Title</h1>
					<p>This is a paragraph with <a href="https://example.com">a link</a> inside.</p>
					<pre><code>const a = 1;</code></pre>
					<img src="img.png" alt="Test Image" />
				</main>
				<aside id="sidebar">Ad or sidebar content</aside>
				<footer>Footer info</footer>
				<script>console.log("hello");</script>
			</body>
			</html>
		`;

		const result = cleanHtmlToMarkdown(html);

		assert.ok(result.includes("# Main Title"));
		assert.ok(result.includes("[a link](https://example.com)"));
		assert.ok(result.includes("```\nconst a = 1;\n```"));
		assert.ok(result.includes("![Test Image](img.png)"));
		assert.ok(!result.includes("color: red"));
		assert.ok(!result.includes("console.log"));
		assert.ok(!result.includes("Header Title"));
		assert.ok(!result.includes("Home"));
		assert.ok(!result.includes("Ad or sidebar"));
		assert.ok(!result.includes("Footer info"));
	});

	it("truncates oversized HTML >200KB and falls back to safe linear stripping", () => {
		const hugeContent = "a".repeat(210000);
		const html = `
			<html>
			<body>
				<nav>navigation</nav>
				<main>
					<h1>Huge article</h1>
					<p>${hugeContent}</p>
				</main>
			</body>
			</html>
		`;

		const result = cleanHtmlToMarkdown(html);

		assert.ok(!result.includes("navigation"));
		assert.ok(result.includes("Huge article"));
		assert.ok(!result.includes("<h1>"));
		assert.strictEqual(result.length < 211000, true);
	});
});
