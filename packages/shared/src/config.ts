import { createDefaultFetchWindow } from "./date";
import { DEFAULT_SCORING_WEIGHTS } from "./scoring";
import type { AppSettings, SourceConfig } from "./types";

export const DEFAULT_FORUMS = ["https://forum.research.logos.co/", "https://forum.logos.co/"];
export const DEFAULT_PROMPT_TEMPLATE = `Create a weekly social update prompt with the items below.\n\n{{update_list}}`;

type LegacySourceConfig = Partial<SourceConfig> & {
  githubRepos?: string[] | null;
};

type LegacyAppSettings = Partial<AppSettings> & {
  sourceConfig?: LegacySourceConfig | null;
};

function splitTargets(values: string[]): string[] {
  return values
    .join("\n")
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function normalizeSourceConfig(sourceConfig?: LegacySourceConfig | null): SourceConfig {
  const githubTargets = sourceConfig?.githubTargets ?? sourceConfig?.githubRepos ?? [];
  const forums = sourceConfig?.forums ?? DEFAULT_FORUMS;

  return {
    githubTargets: splitTargets(githubTargets),
    forums: forums.map((value) => value.trim()).filter(Boolean),
  };
}

export function createDefaultAppSettings(now = new Date()): AppSettings {
  return {
    sourceConfig: {
      githubTargets: [],
      forums: [...DEFAULT_FORUMS],
    },
    promptTemplate: DEFAULT_PROMPT_TEMPLATE,
    scoringWeights: DEFAULT_SCORING_WEIGHTS,
    tokenLimit: 18000,
    fetchWindow: createDefaultFetchWindow(now),
  };
}

export function normalizeAppSettings(settings?: LegacyAppSettings | null): AppSettings {
  const defaults = createDefaultAppSettings();

  return {
    sourceConfig: normalizeSourceConfig(settings?.sourceConfig),
    promptTemplate: settings?.promptTemplate ?? defaults.promptTemplate,
    scoringWeights: settings?.scoringWeights ?? defaults.scoringWeights,
    tokenLimit: settings?.tokenLimit ?? defaults.tokenLimit,
    fetchWindow: settings?.fetchWindow ?? defaults.fetchWindow,
  };
}
