// Configuration persistence — <Pi agent dir>/extensions/pi-search/config.json.
//
// Env vars take precedence over config file values:
//   TAVILY_API_KEY, ANYSEARCH_API_KEY, JINA_API_KEY

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolve Pi's agent directory without importing Pi's bundled packages.
 * Mirrors Pi's getAgentDir(): `PI_CODING_AGENT_DIR` wins, `~/` expands to the
 * home directory, and the fallback is `~/.pi/agent`. Setups that place the Pi
 * directory under XDG (for example `$XDG_CONFIG_HOME/pi/agent`) do so through
 * this environment variable, so XDG layouts are honored automatically.
 */
export function resolveDefaultAgentDir(): string {
	const configured = process.env.PI_CODING_AGENT_DIR;
	const raw =
		configured !== undefined && configured.trim() !== "" ? configured.trim() : join(homedir(), ".pi", "agent");
	if (raw === "~") return homedir();
	if (raw.startsWith("~/")) return join(homedir(), raw.slice(2));
	return raw;
}

/** User-managed extension directory: <agent dir>/extensions/pi-search. */
export function getUserConfigDir(): string {
	return join(resolveDefaultAgentDir(), "extensions", "pi-search");
}

function resolveDefaultConfigPath(): string | undefined {
	const configPath = join(getUserConfigDir(), "config.json");
	return existsSync(configPath) ? configPath : undefined;
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
