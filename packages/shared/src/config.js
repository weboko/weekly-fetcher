import { createDefaultFetchWindow } from "./date";
import { DEFAULT_SCORING_WEIGHTS } from "./scoring";

export const DEFAULT_FORUMS = ["https://forum.research.logos.co/", "https://forum.logos.co/"];
export const DEFAULT_PROMPT_TEMPLATE = `Create a weekly social update prompt with the items below.\n\n{{update_list}}`;

export function normalizeSourceConfig(sourceConfig) {
  const githubTargets = sourceConfig?.githubTargets ?? sourceConfig?.githubRepos ?? [];
  const forums = sourceConfig?.forums ?? DEFAULT_FORUMS;

  return {
    githubTargets: githubTargets.map((value) => value.trim()).filter(Boolean),
    forums: forums.map((value) => value.trim()).filter(Boolean),
  };
}

export function createDefaultAppSettings(now = new Date()) {
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

export function normalizeAppSettings(settings) {
  const defaults = createDefaultAppSettings();

  return {
    sourceConfig: normalizeSourceConfig(settings?.sourceConfig),
    promptTemplate: settings?.promptTemplate ?? defaults.promptTemplate,
    scoringWeights: settings?.scoringWeights ?? defaults.scoringWeights,
    tokenLimit: settings?.tokenLimit ?? defaults.tokenLimit,
    fetchWindow: settings?.fetchWindow ?? defaults.fetchWindow,
  };
}
