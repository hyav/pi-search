import assert from "node:assert";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { limitSearchOutput } from "../src/output.js";

describe("search output budget", () => {
	it("propagates cancellation before writing oversized output", async () => {
		const controller = new AbortController();
		const reason = new Error("output cancelled by caller");
		controller.abort(reason);

		await assert.rejects(limitSearchOutput("x".repeat(60 * 1024), controller.signal), (error) => error === reason);
	});

	it("truncates oversized output and preserves the full result in a temp file", async () => {
		const full = "x".repeat(60 * 1024);
		const limited = await limitSearchOutput(full);
		assert.ok(limited.text.length < full.length);
		assert.ok(limited.fullOutputPath);
		assert.match(limited.text, /Full output:/);
		assert.strictEqual(await readFile(limited.fullOutputPath!, "utf8"), full);
	});
});
