import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type HunkConfig = {
  hunk: {
    enabled: boolean;
    binary: string;
  };
};

type HunkConfigInput = {
  hunk?: Partial<HunkConfig["hunk"]>;
};

export const DEFAULT_CONFIG: HunkConfig = {
  hunk: {
    enabled: true,
    binary: "hunk",
  },
};

export function mergeConfig(
  base: HunkConfig,
  next?: HunkConfigInput,
): HunkConfig {
  return {
    hunk: {
      enabled: next?.hunk?.enabled ?? base.hunk.enabled,
      binary: next?.hunk?.binary ?? base.hunk.binary,
    },
  };
}

function configFrom(value: unknown): HunkConfigInput | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    !candidate.hunk ||
    typeof candidate.hunk !== "object" ||
    Array.isArray(candidate.hunk)
  )
    return undefined;
  const raw = candidate.hunk as Record<string, unknown>;
  const hunk: Partial<HunkConfig["hunk"]> = {};
  if (typeof raw.enabled === "boolean") hunk.enabled = raw.enabled;
  if (typeof raw.binary === "string" && raw.binary.trim())
    hunk.binary = raw.binary.trim();
  return { hunk };
}

async function loadJsonFile(
  filePath: string,
): Promise<HunkConfigInput | undefined> {
  try {
    if (!existsSync(filePath)) return undefined;
    return configFrom(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch {
    return undefined;
  }
}

export async function loadConfig(cwd: string): Promise<HunkConfig> {
  const globalConfig = await loadJsonFile(
    path.join(os.homedir(), ".pi", "agent", "hunk.json"),
  );
  const projectConfig = await loadJsonFile(path.join(cwd, ".pi", "hunk.json"));
  return mergeConfig(mergeConfig(DEFAULT_CONFIG, globalConfig), projectConfig);
}
