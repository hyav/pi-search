import assert from "node:assert";
import { describe, it } from "node:test";
import { normalizeDirectResponse } from "../src/web-fetch.js";

describe("raw fetch mode", () => {
	it("preserves HTML exactly when raw=true", () => {
		const html = "<!doctype html><html><body><p>Hello</p></body></html>";
		assert.deepStrictEqual(normalizeDirectResponse(html, "text/html", true), {
			text: html,
			contentType: "text/html",
		});
	});
});
