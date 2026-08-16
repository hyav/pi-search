import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationResult,
	truncateHead,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";

const OUTPUT_TEMP_PREFIX = "pisearch-output-";

export interface LimitedSearchOutput {
	text: string;
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

export async function limitSearchOutput(content: string, signal?: AbortSignal): Promise<LimitedSearchOutput> {
	signal?.throwIfAborted();
	const truncation = truncateHead(content, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
	if (!truncation.truncated) return { text: content };

	const dir = await mkdtemp(join(tmpdir(), OUTPUT_TEMP_PREFIX));
	const fullOutputPath = join(dir, "content.txt");
	await withFileMutationQueue(fullOutputPath, async () => {
		signal?.throwIfAborted();
		try {
			await writeFile(fullOutputPath, content, { encoding: "utf8", mode: 0o600, signal });
		} catch (error) {
			signal?.throwIfAborted();
			throw error;
		}
	});
	signal?.throwIfAborted();
	const text =
		truncation.content +
		`\n\n[Truncated: ${truncation.outputLines}/${truncation.totalLines} lines` +
		` (${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)}).` +
		` Full output: ${fullOutputPath}]`;
	return { text, truncation, fullOutputPath };
}
