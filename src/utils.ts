import dnsPromises from "node:dns/promises";
import type { LookupFunction } from "node:net";

export const dnsClient = {
	resolve4: (hostname: string): Promise<string[]> => dnsPromises.resolve4(hostname),
	resolve6: (hostname: string): Promise<string[]> => dnsPromises.resolve6(hostname),
	lookup: (hostname: string, options: { all: true }): Promise<Array<{ address: string; family: number }>> =>
		dnsPromises.lookup(hostname, options),
};

import type { SearchResult } from "./providers/types.js";

export const MAX_DIRECT_RESPONSE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;

export function deduplicateResults(allResults: SearchResult[]): SearchResult[] {
	const seen = new Set<string>();
	const unique: SearchResult[] = [];
	for (const r of allResults) {
		const key = r.url.toLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			unique.push(r);
		}
	}
	return unique;
}

type IPv4Address = [number, number, number, number];

function stripIpBrackets(ip: string): string {
	const trimmed = ip.trim();
	return trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
}

function parseIPv4(ip: string): IPv4Address | null {
	const parts = ip.split(".");
	if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return null;
	const values = parts.map(Number);
	if (values.some((value) => value < 0 || value > 255)) return null;
	return values as IPv4Address;
}

function parseIPv6Groups(ip: string): number[] | null {
	const halves = ip.split("::");
	if (halves.length > 2) return null;

	const parsePart = (part: string): number[] | null => {
		if (!part) return [];
		const groups = part.split(":");
		const lastGroup = groups.at(-1);
		if (lastGroup?.includes(".")) {
			const ipv4 = parseIPv4(lastGroup);
			if (!ipv4) return null;
			groups.splice(
				groups.length - 1,
				1,
				((ipv4[0] << 8) | ipv4[1]).toString(16),
				((ipv4[2] << 8) | ipv4[3]).toString(16),
			);
		}

		const values = groups.map((group) => {
			if (!/^[0-9a-f]{1,4}$/i.test(group)) return -1;
			return Number.parseInt(group, 16);
		});
		return values.some((value) => value < 0) ? null : values;
	};

	const left = parsePart(halves[0]);
	const right = parsePart(halves.length === 2 ? halves[1] : "");
	if (!left || !right) return null;

	const totalGroups = left.length + right.length;
	if (halves.length === 1) {
		return totalGroups === 8 ? [...left, ...right] : null;
	}
	if (totalGroups >= 8) return null;
	return [...left, ...new Array(8 - totalGroups).fill(0), ...right];
}

type IPv4Cidr = readonly [address: IPv4Address, prefixLength: number];

// Deny every IPv4 range that is private, local, shared, documentation-only,
// benchmarking, multicast, or reserved. Direct fetching is allowed only to
// ordinary globally routable unicast addresses.
const NON_PUBLIC_IPV4_CIDRS: readonly IPv4Cidr[] = [
	[[0, 0, 0, 0], 8],
	[[10, 0, 0, 0], 8],
	[[100, 64, 0, 0], 10],
	[[127, 0, 0, 0], 8],
	[[169, 254, 0, 0], 16],
	[[172, 16, 0, 0], 12],
	[[192, 0, 0, 0], 24],
	[[192, 0, 2, 0], 24],
	[[192, 88, 99, 0], 24],
	[[192, 168, 0, 0], 16],
	[[198, 18, 0, 0], 15],
	[[198, 51, 100, 0], 24],
	[[203, 0, 113, 0], 24],
	[[224, 0, 0, 0], 4],
	[[240, 0, 0, 0], 4],
];

// Special-purpose ranges inside today's global-unicast 2000::/3 allocation.
// Addresses outside 2000::/3 are denied separately instead of assuming that
// unallocated IPv6 space is publicly routable.
const NON_PUBLIC_GLOBAL_UNICAST_IPV6_CIDRS = [
	["2001::", 23],
	["2001:db8::", 32],
	["2002::", 16],
	["3fff::", 20],
] as const;

function ipv4ToNumber([a, b, c, d]: IPv4Address): number {
	return (((a * 256 + b) * 256 + c) * 256 + d) >>> 0;
}

function isIPv4InCidr(address: IPv4Address, [base, prefixLength]: IPv4Cidr): boolean {
	const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
	return (ipv4ToNumber(address) & mask) === (ipv4ToNumber(base) & mask);
}

function isPrivateIPv4(address: IPv4Address): boolean {
	return NON_PUBLIC_IPV4_CIDRS.some((cidr) => isIPv4InCidr(address, cidr));
}

function ipv6ToBigInt(groups: readonly number[]): bigint {
	return groups.reduce((value, group) => (value << 16n) | BigInt(group), 0n);
}

function isIPv6InCidr(address: readonly number[], baseText: string, prefixLength: number): boolean {
	const base = parseIPv6Groups(baseText);
	if (!base) throw new Error(`Invalid internal IPv6 CIDR base: ${baseText}`);
	const shift = BigInt(128 - prefixLength);
	return ipv6ToBigInt(address) >> shift === ipv6ToBigInt(base) >> shift;
}

export function isPrivateIP(ip: string): boolean {
	const normalized = stripIpBrackets(ip).split("%", 1)[0];
	const ipv4 = parseIPv4(normalized);
	if (ipv4) return isPrivateIPv4(ipv4);

	const ipv6 = parseIPv6Groups(normalized);
	if (!ipv6) return true;

	// IPv4-mapped IPv6 addresses must use the same IPv4 policy.
	const isMappedIPv4 = ipv6.slice(0, 5).every((group) => group === 0) && ipv6[5] === 0xffff;
	if (isMappedIPv4) {
		const mapped: IPv4Address = [ipv6[6] >> 8, ipv6[6] & 0xff, ipv6[7] >> 8, ipv6[7] & 0xff];
		return isPrivateIPv4(mapped);
	}

	if (!isIPv6InCidr(ipv6, "2000::", 3)) return true;
	return NON_PUBLIC_GLOBAL_UNICAST_IPV6_CIDRS.some(([base, prefixLength]) => isIPv6InCidr(ipv6, base, prefixLength));
}

const DNS_RESOLUTION_TIMEOUT_MS = 5000;

async function resolveAllAddresses(hostname: string, signal?: AbortSignal): Promise<string[]> {
	const lookupPromise = dnsClient.lookup(hostname, { all: true });
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(
			() => reject(new Error(`DNS resolution timed out after ${DNS_RESOLUTION_TIMEOUT_MS}ms`)),
			DNS_RESOLUTION_TIMEOUT_MS,
		);
	});
	let removeAbortListener: (() => void) | undefined;
	const cancellation = signal
		? new Promise<never>((_resolve, reject) => {
				const onAbort = () => reject(abortReason(signal));
				if (signal.aborted) {
					onAbort();
					return;
				}
				signal.addEventListener("abort", onAbort, { once: true });
				removeAbortListener = () => signal.removeEventListener("abort", onAbort);
			})
		: undefined;

	try {
		const resolution = Promise.allSettled([
			lookupPromise,
			dnsClient.resolve4(hostname),
			dnsClient.resolve6(hostname),
		]);
		const pending = cancellation ? [resolution, timeout, cancellation] : [resolution, timeout];
		const results = await Promise.race(pending);
		const addresses: string[] = [];
		const [lookup, ipv4, ipv6] = results;
		if (lookup.status === "fulfilled") {
			const values = Array.isArray(lookup.value) ? lookup.value : [lookup.value];
			addresses.push(...values.map(({ address }) => address));
		}
		if (ipv4.status === "fulfilled") addresses.push(...ipv4.value);
		if (ipv6.status === "fulfilled") addresses.push(...ipv6.value);
		return [...new Set(addresses)];
	} finally {
		if (timer) clearTimeout(timer);
		removeAbortListener?.();
	}
}

const NON_PUBLIC_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".test", ".invalid", ".example"];

export function validateHttpUrl(urlStr: string): URL {
	const url = new URL(urlStr);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`Unsupported URL protocol: ${url.protocol}`);
	}
	if (url.username || url.password) {
		throw new Error("URL must not include credentials");
	}
	const hostname = url.hostname;
	if (!hostname) throw new Error("URL must include a hostname");

	const normalizedHostname = stripIpBrackets(hostname);
	const isIP = parseIPv4(normalizedHostname) !== null || parseIPv6Groups(normalizedHostname) !== null;
	if (isIP && isPrivateIP(normalizedHostname)) throw new Error(`Blocked non-public IP access: ${hostname}`);
	if (!isIP) {
		const canonicalHostname = normalizedHostname.toLowerCase().replace(/\.$/, "");
		if (
			!canonicalHostname.includes(".") ||
			canonicalHostname === "localhost" ||
			NON_PUBLIC_HOST_SUFFIXES.some((suffix) => canonicalHostname.endsWith(suffix))
		) {
			throw new Error(`Blocked non-public hostname: ${hostname}`);
		}
	}
	return url;
}

// Resolve and classify every address before locking a direct connection to
// one checked IP, preventing private-address access and DNS rebinding.
export async function assertSafeDns(urlStr: string, signal?: AbortSignal): Promise<{ url: string; ip: string }> {
	const url = validateHttpUrl(urlStr);
	if (signal?.aborted) throw abortReason(signal);
	const hostname = url.hostname;
	const normalizedHostname = stripIpBrackets(hostname);
	const isIP = parseIPv4(normalizedHostname) !== null || parseIPv6Groups(normalizedHostname) !== null;
	if (isIP) return { url: urlStr, ip: normalizedHostname };

	const addresses = await resolveAllAddresses(hostname, signal);
	if (addresses.length === 0) throw new Error(`DNS resolution failed for ${hostname}`);
	for (const address of addresses) {
		if (isPrivateIP(address)) {
			throw new Error(`SSRF Blocked: Resolving to non-public address: ${address}`);
		}
	}

	return { url: urlStr, ip: addresses[0] };
}

interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

export class SafeMemoryCache<T> {
	private cache = new Map<string, CacheEntry<T>>();
	constructor(
		private ttlMs: number = 300000,
		private maxEntries: number = 100,
	) {}

	get(key: string): T | null {
		const entry = this.cache.get(key);
		if (!entry) return null;
		if (Date.now() > entry.expiresAt) {
			this.cache.delete(key);
			return null;
		}
		return entry.value;
	}

	set(key: string, value: T): void {
		if (this.cache.size >= this.maxEntries) {
			// FIFO cache eviction
			const firstKey = this.cache.keys().next().value;
			if (firstKey) this.cache.delete(firstKey);
		}
		this.cache.set(key, {
			value,
			expiresAt: Date.now() + this.ttlMs,
		});
	}

	clear(): void {
		this.cache.clear();
	}
}

import http from "node:http";
import https from "node:https";

// Native fetch replacement enforcing pinned IP against DNS rebinding while preserving HTTPS validation
export function safeFetch(urlStr: string, safeIp: string, options: RequestInit = {}): Promise<Response> {
	const url = new URL(urlStr);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return Promise.reject(new Error(`Unsupported URL protocol: ${url.protocol}`));
	}
	const isHttps = url.protocol === "https:";
	const lib = isHttps ? https : http;

	const headers: Record<string, string> = {};
	if (options.headers) {
		if (options.headers instanceof Headers) {
			options.headers.forEach((val, key) => {
				headers[key] = val;
			});
		} else if (Array.isArray(options.headers)) {
			for (const [key, val] of options.headers) {
				headers[key] = val;
			}
		} else {
			Object.assign(headers, options.headers);
		}
	}

	// Custom lookup enforcing the connection to the validated safe IP
	const customLookup: LookupFunction = (_hostname, opts, callback) => {
		const family = safeIp.includes(":") ? 6 : 4;
		if (opts?.all) {
			callback(null, [{ address: safeIp, family }]);
		} else {
			callback(null, safeIp, family);
		}
	};

	const reqOptions: http.RequestOptions = {
		method: options.method || "GET",
		headers,
		lookup: customLookup,
		signal: options.signal ?? undefined,
	};

	return new Promise<Response>((resolve, reject) => {
		let settled = false;
		const fail = (err: Error) => {
			if (settled) return;
			settled = true;
			reject(err);
		};
		const req = lib.request(urlStr, reqOptions, (res) => {
			const declaredLength = Number(res.headers["content-length"]);
			if (Number.isFinite(declaredLength) && declaredLength > MAX_DIRECT_RESPONSE_BYTES) {
				const err = new Error(`PAYLOAD_TOO_LARGE: response exceeds ${MAX_DIRECT_RESPONSE_BYTES} bytes`);
				res.destroy(err);
				req.destroy(err);
				fail(err);
				return;
			}

			const chunks: Buffer[] = [];
			let totalBytes = 0;
			res.on("data", (chunk: Buffer | Uint8Array | string) => {
				if (settled) return;
				const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
				totalBytes += buffer.byteLength;
				if (totalBytes > MAX_DIRECT_RESPONSE_BYTES) {
					const err = new Error(`PAYLOAD_TOO_LARGE: response exceeds ${MAX_DIRECT_RESPONSE_BYTES} bytes`);
					res.destroy(err);
					req.destroy(err);
					fail(err);
					return;
				}
				chunks.push(buffer);
			});
			res.on("error", fail);
			res.on("end", () => {
				if (settled) return;
				settled = true;
				const responseHeaders = new Headers();
				for (const [key, val] of Object.entries(res.headers)) {
					if (Array.isArray(val)) {
						for (const v of val) responseHeaders.append(key, v);
					} else if (val !== undefined) {
						responseHeaders.set(key, val);
					}
				}
				const response = new Response(Buffer.concat(chunks, totalBytes), {
					status: res.statusCode,
					statusText: res.statusMessage,
					headers: responseHeaders,
				});
				Object.defineProperty(response, "url", { value: urlStr });
				resolve(response);
			});
		});

		req.on("error", fail);

		if (options.body) {
			if (typeof options.body === "string" || Buffer.isBuffer(options.body)) {
				req.write(options.body);
			} else {
				req.write(String(options.body));
			}
		}
		req.end();
	});
}

async function bufferResponseWithLimit(response: Response, maxResponseBytes: number): Promise<Response> {
	const declaredLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
		await response.body?.cancel().catch(() => undefined);
		throw new Error(`PAYLOAD_TOO_LARGE: response exceeds ${maxResponseBytes} bytes`);
	}
	if (!response.body) return response;

	const reader = response.body.getReader();
	const chunks: Buffer[] = [];
	let totalBytes = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		totalBytes += value.byteLength;
		if (totalBytes > maxResponseBytes) {
			await reader.cancel().catch(() => undefined);
			throw new Error(`PAYLOAD_TOO_LARGE: response exceeds ${maxResponseBytes} bytes`);
		}
		chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
	}

	const body =
		totalBytes === 0 && [204, 205, 304].includes(response.status) ? null : Buffer.concat(chunks, totalBytes);
	const buffered = new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
	if (response.url) Object.defineProperty(buffered, "url", { value: response.url });
	return buffered;
}

// Bound the complete request, including response-body reads, and return a
// replayable buffered Response so callers cannot accidentally bypass limits.
export async function fetchWithTimeout(
	url: string,
	options: RequestInit = {},
	timeoutMs: number = DEFAULT_PROVIDER_TIMEOUT_MS,
	safeIp?: string,
	maxResponseBytes: number = MAX_DIRECT_RESPONSE_BYTES,
): Promise<Response> {
	const timeoutController = new AbortController();
	let timeoutReject: ((error: Error) => void) | undefined;
	const timeoutPromise = new Promise<never>((_resolve, reject) => {
		timeoutReject = reject;
	});
	const timer = setTimeout(() => {
		timeoutController.abort(new Error("timeout"));
		timeoutReject?.(new Error(`Network request timed out after ${timeoutMs}ms`));
	}, timeoutMs);
	const signal = options.signal
		? AbortSignal.any([options.signal, timeoutController.signal])
		: timeoutController.signal;
	let removeCallerAbortListener: (() => void) | undefined;
	const callerSignal = options.signal;
	const callerAbortPromise = callerSignal
		? new Promise<never>((_resolve, reject) => {
				const onAbort = () => reject(abortReason(callerSignal));
				if (callerSignal.aborted) {
					onAbort();
					return;
				}
				callerSignal.addEventListener("abort", onAbort, { once: true });
				removeCallerAbortListener = () => callerSignal.removeEventListener("abort", onAbort);
			})
		: undefined;
	try {
		const request = (async () => {
			const response = safeIp
				? await safeFetch(url, safeIp, { ...options, signal })
				: await fetch(url, { ...options, signal });
			return bufferResponseWithLimit(response, maxResponseBytes);
		})();
		const pending = callerAbortPromise ? [request, timeoutPromise, callerAbortPromise] : [request, timeoutPromise];
		return await Promise.race(pending);
	} catch (err) {
		if (timeoutController.signal.aborted && !options.signal?.aborted) {
			throw new Error(`Network request timed out after ${timeoutMs}ms`, { cause: err });
		}
		throw err;
	} finally {
		clearTimeout(timer);
		removeCallerAbortListener?.();
	}
}

function abortReason(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new Error("Network request aborted");
}

async function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) throw abortReason(signal);
	await new Promise<void>((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout>;
		const onAbort = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			reject(signal ? abortReason(signal) : new Error("Network request aborted"));
		};
		timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, delayMs);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

// Limited retry for HTTP 429 and transient transport failures; caller cancellation and payload limits do not retry.
export async function fetchWithRetry(
	url: string,
	options: RequestInit = {},
	maxRetries: number = 1,
	safeIp?: string,
): Promise<Response> {
	let lastError: Error | null = null;
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			if (options.signal?.aborted) throw abortReason(options.signal);
			if (attempt > 0) {
				const backoff = 1000 * 2 ** attempt + Math.random() * 200;
				await waitForRetry(backoff, options.signal ?? undefined);
			}
			const res = await fetchWithTimeout(url, options, 8000, safeIp);
			if (res.status === 429 && attempt < maxRetries) {
				continue;
			}
			return res;
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			if (options.signal?.aborted) throw abortReason(options.signal);
			if (lastError.message.startsWith("PAYLOAD_TOO_LARGE") || attempt === maxRetries) break;
		}
	}
	throw lastError ?? new Error(`Request failed`);
}

/**
 * High-performance, ReDoS-safe HTML-to-Markdown extractor.
 * Automatically applies chunk truncation and plaintext degradation for pages >200KB to protect the main thread.
 */
export function cleanHtmlToMarkdown(html: string): string {
	if (!html) return "";

	let text = html;
	const threshold = 200000; // 200KB

	// If size exceeds threshold, perform coarse string truncation before regex parsing
	if (text.length > threshold) {
		// Prefer extracting content within <main>, <article>, or <body>
		for (const tag of ["main", "article", "body"]) {
			const startTag = `<${tag}`;
			const endTag = `</${tag}>`;
			const startIdx = text.indexOf(startTag);
			if (startIdx !== -1) {
				const endIdx = text.indexOf(endTag, startIdx);
				if (endIdx !== -1) {
					text = text.substring(startIdx, endIdx + endTag.length);
					break;
				}
			}
		}
	}

	// Linear fallback if content still exceeds threshold without running backtracking regexes
	if (text.length > threshold) {
		return text
			.replace(/<(script|style|noscript|svg|iframe|head)[^>]*>([\s\S]*?)<\/\1>/gi, "")
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	// Lightweight markdown transformation within safe byte budget
	text = text.replace(/<(script|style|noscript|svg|iframe|head)[^>]*>([\s\S]*?)<\/\1>/gi, "");
	text = text.replace(/<!--[\s\S]*?-->/g, "");

	// Strip semantic headers, footers, navs, and asides
	text = text.replace(/<(header|footer|nav|aside)[^>]*>([\s\S]*?)<\/\1>/gi, "");

	// Strip ads, navigation, and sidebar containers by attribute
	text = text.replace(
		/<[^>]+(id|class)="[^"]*(sidebar|footer|nav|header|ad-|banner|menu)[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/gi,
		"",
	);

	// Headings
	text = text.replace(
		/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi,
		(_, content) => `\n\n# ${content.replace(/<[^>]+>/g, "").trim()}\n`,
	);

	// Hyperlinks
	text = text.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, innerText) => {
		const cleanText = innerText.replace(/<[^>]+>/g, "").trim();
		return cleanText ? ` [${cleanText}](${href}) ` : "";
	});

	// Code blocks
	text = text.replace(/<pre[^>]*>[\s\S]*?<code[^>]*>([\s\S]*?)<\/code>[\s\S]*?<\/pre>/gi, (_, code) => {
		const cleanCode = code.replace(/<[^>]+>/g, "");
		return `\n\`\`\`\n${cleanCode}\n\`\`\`\n`;
	});

	// Images
	text = text.replace(/<img([^>]+)>/gi, (_, attrs) => {
		const srcMatch = attrs.match(/src="([^"]*)"/i);
		const altMatch = attrs.match(/alt="([^"]*)"/i);
		const src = srcMatch ? srcMatch[1] : "";
		const alt = altMatch ? altMatch[1] : "";
		return src ? ` ![${alt}](${src}) ` : "";
	});

	// Paragraphs and breaks
	text = text.replace(/<p[^>]*>/gi, "\n\n").replace(/<\/p>/gi, "");
	text = text.replace(/<br\s*\/?>/gi, "\n");

	// Strip remaining HTML tags
	text = text.replace(/<[^>]+>/g, " ");

	// Collapse whitespace
	text = text.replace(/[ \t]+/g, " ");
	text = text.replace(/\n\s*\n/g, "\n\n");

	return text.trim();
}
