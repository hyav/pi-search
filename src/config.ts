// Configuration persistence — <Pi agent dir>/pi-search/config.json.
// Legacy pi-search-kit and ~/.pi/pi-search paths remain read-only fallbacks.
//
// Env vars take precedence over config file values:
//   TAVILY_API_KEY, ANYSEARCH_API_KEY, JINA_API_KEY

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const LEGACY_CONFIG_PATH = join(homedir(), ".pi", "pi-search-kit", "config.json");
const LEGACY_CONFIG_PATH_NEW = join(homedir(), ".pi", "pi-search", "config.json");

function resolveDefaultConfigPath(): string | undefined {
	const piConfigPath = join(getAgentDir(), "pi-search", "config.json");
	if (existsSync(piConfigPath)) return piConfigPath;
	const piConfigPathKit = join(getAgentDir(), "pi-search-kit", "config.json");
	if (existsSync(piConfigPathKit)) return piConfigPathKit;
	if (existsSync(LEGACY_CONFIG_PATH_NEW)) return LEGACY_CONFIG_PATH_NEW;
	if (existsSync(LEGACY_CONFIG_PATH)) return LEGACY_CONFIG_PATH;
	return undefined;
}

export interface SearchConfig {
	apiKeys?: Record<string, string>;
	defaults?: {
		max_results?: number;
	};
}

const DEFAULT_CONFIG: SearchConfig = {};

export function loadConfig(configPath?: string): SearchConfig {
	const resolvedPath = configPath ?? resolveDefaultConfigPath();
	if (!resolvedPath || !existsSync(resolvedPath)) return { ...DEFAULT_CONFIG };
	try {
		const raw = readFileSync(resolvedPath, "utf-8");
		return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as SearchConfig) };
	} catch (err) {
		console.error("Failed to parse config.json:", err instanceof Error ? err.message : err);
		return { ...DEFAULT_CONFIG };
	}
}

export function resolveApiKey(name: string, envVar: string, config: SearchConfig): string | undefined {
	// env var wins
	const envKey = process.env[envVar]?.trim();
	if (envKey) return envKey;

	// config file
	return config.apiKeys?.[name]?.trim() || undefined;
}
