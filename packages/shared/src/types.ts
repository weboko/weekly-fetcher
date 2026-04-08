export type SourceKind = "github" | "discourse";
export type ItemType = "pull_request" | "issue" | "forum_topic";
export type WarningSeverity = "info" | "warning" | "error";

export interface FetchWindow {
  startDate: string;
  endDate: string;
  timeZone: string;
}

export interface SourceConfig {
  githubRepos: string[];
  forums: string[];
}

export interface DeliveryParams {
  mergedPrBase: number;
  completedIssueBase: number;
  activePrBase: number;
  activeIssueBase: number;
  forumBase: number;
  lowValueClosureBase: number;
  linkedBonus: number;
  diffUnit: number;
}

export interface EngagementParams {
  commentWeight: number;
  reactionWeight: number;
  activityBonus: number;
}

export interface ScoringWeights {
  deliveryWeight: number;
  engagementWeight: number;
  aiWeight: number;
  deliveryParams: DeliveryParams;
  engagementParams: EngagementParams;
}

export interface DatasetWarning {
  id: string;
  sourceKey: string;
  severity: WarningSeverity;
  message: string;
}

export interface LinkedItemRef {
  kind: "explicit" | "textual" | "timeline";
  target: string;
  label?: string;
}

export interface ActivityExcerpt {
  id: string;
  kind: "comment" | "reply" | "body";
  author: string;
  body: string;
  createdAt: string;
  reactionCount: number;
  url?: string;
}

export interface ItemMetrics {
  commentsCount: number;
  reactionsCount: number;
  diffSize: number | null;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
}

export interface ActivityEvent {
  id: string;
  type: "created" | "commented" | "replied" | "merged" | "closed" | "reopened" | "completed" | "forum_activity";
  createdAt: string;
}

export interface ActivityWindowSummary {
  sincePostedAt: string | null;
  activeStart: string;
  activeEnd: string;
}

export interface ItemScore {
  delivery: number;
  engagement: number;
  aiRelevance: number | null;
  total: number;
}

export interface ItemState {
  reviewed: boolean;
  selected: boolean;
  includedInGeneratedPrompt: boolean;
  posted: boolean;
  selectionOrder: number | null;
}

export interface GitHubSourceMeta {
  source: "github";
  organization: string;
  repository: string;
  number: number;
  labels: string[];
  stateReason: string | null;
}

export interface DiscourseSourceMeta {
  source: "discourse";
  forumUrl: string;
  forumName: string;
  topicId: number;
  slug?: string;
}

export type SourceMeta = GitHubSourceMeta | DiscourseSourceMeta;

export interface ActivityItem {
  id: string;
  itemKey: string;
  source: SourceKind;
  type: ItemType;
  sourceMeta: SourceMeta;
  title: string;
  body: string;
  summary: string;
  url: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  latestActivityAt: string;
  linkedItems: LinkedItemRef[];
  excerpts: ActivityExcerpt[];
  metrics: ItemMetrics;
  events: ActivityEvent[];
  score: ItemScore;
  activityWindow: ActivityWindowSummary;
  alreadyShared: boolean;
  reactivated: boolean;
  warnings: string[];
  state: ItemState;
}

export interface DatasetRecord {
  id: string;
  cacheKey: string;
  createdAt: string;
  fetchWindow: FetchWindow;
  sourceConfig: SourceConfig;
  scoringWeights: ScoringWeights;
  warnings: DatasetWarning[];
  items: ActivityItem[];
}

export interface AppSettings {
  sourceConfig: SourceConfig;
  promptTemplate: string;
  scoringWeights: ScoringWeights;
  tokenLimit: number;
  fetchWindow: FetchWindow;
}

export interface FetchRequest {
  sourceConfig: SourceConfig;
  fetchWindow: FetchWindow;
  scoringWeights: ScoringWeights;
  githubToken?: string;
}

export interface FetchResponse {
  dataset: DatasetRecord;
}

export interface UpdateItemStateRequest {
  reviewed?: boolean;
  selected?: boolean;
  includedInGeneratedPrompt?: boolean;
  selectionOrder?: number | null;
}

export interface PostItemRequest {
  datasetId: string;
}

