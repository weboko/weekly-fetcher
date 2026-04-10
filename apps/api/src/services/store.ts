import { buildSummary, computeScores, createDefaultAppSettings, normalizeAppSettings, normalizeSourceConfig, type ActivityItem, type AppSettings, type DatasetRecord, type FetchWindow, type ItemState, type PostItemRequest, type ScoringWeights } from "@weekly/shared";
import { createHash, randomUUID } from "node:crypto";

import type { SqliteDatabase } from "../db";
import { computeActivityWindow, isReactivated, type PostedMarker } from "./reactivation";

const DEFAULT_SETTINGS: AppSettings = {
  ...createDefaultAppSettings(),
  promptTemplate: `Create a weekly social update based on the following items.\n\n{{update_list}}`,
};

function rowToState(row: Record<string, unknown> | undefined): ItemState {
  if (!row) {
    return {
      reviewed: false,
      selected: false,
      includedInGeneratedPrompt: false,
      posted: false,
      selectionOrder: null,
    };
  }

  return {
    reviewed: Boolean(row.reviewed),
    selected: Boolean(row.selected),
    includedInGeneratedPrompt: Boolean(row.included_in_generated_prompt),
    posted: Boolean(row.posted),
    selectionOrder: typeof row.selection_order === "number" ? row.selection_order : null,
  };
}

export function buildCacheKey(window: FetchWindow, sourceConfig: AppSettings["sourceConfig"]): string {
  return createHash("sha256")
    .update(JSON.stringify({ window, sourceConfig: normalizeSourceConfig(sourceConfig) }))
    .digest("hex");
}

export function getSettings(db: SqliteDatabase): AppSettings {
  const row = db.prepare("SELECT json FROM settings WHERE id = 1").get() as { json: string } | undefined;
  return row ? normalizeAppSettings(JSON.parse(row.json) as AppSettings) : DEFAULT_SETTINGS;
}

export function saveSettings(db: SqliteDatabase, settings: AppSettings): AppSettings {
  const normalizedSettings = normalizeAppSettings(settings);
  db.prepare("INSERT INTO settings (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json").run(JSON.stringify(normalizedSettings));
  return normalizedSettings;
}

export function getLatestPostedMarker(db: SqliteDatabase, itemKey: string): PostedMarker | null {
  const row = db
    .prepare("SELECT posted_at FROM posted_markers WHERE item_key = ? ORDER BY posted_at DESC LIMIT 1")
    .get(itemKey) as { posted_at: string } | undefined;

  return row ? { postedAt: row.posted_at } : null;
}

export function finalizeItem(
  db: SqliteDatabase,
  rawItem: Omit<ActivityItem, "score" | "summary" | "alreadyShared" | "reactivated" | "activityWindow">,
  scoringWeights: ScoringWeights,
): ActivityItem {
  const postedMarker = getLatestPostedMarker(db, rawItem.itemKey);
  const reactivated = isReactivated(rawItem.events, postedMarker);
  const activityWindow = computeActivityWindow(rawItem.events, postedMarker);
  const alreadyShared = Boolean(postedMarker);
  const baseItem = {
    ...rawItem,
    alreadyShared,
    reactivated,
    activityWindow,
  };

  const summary = buildSummary(baseItem);
  const score = computeScores(baseItem, scoringWeights);

  return {
    ...baseItem,
    summary,
    score,
  };
}

export function replaceDataset(db: SqliteDatabase, dataset: DatasetRecord): DatasetRecord {
  const transaction = db.transaction(() => {
    const existing = db.prepare("SELECT id FROM datasets WHERE cache_key = ?").get(dataset.cacheKey) as { id: string } | undefined;
    if (existing) {
      db.prepare("DELETE FROM datasets WHERE id = ?").run(existing.id);
    }

    db.prepare(
      `INSERT INTO datasets (id, cache_key, created_at, fetch_window_json, source_config_json, scoring_weights_json, warnings_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      dataset.id,
      dataset.cacheKey,
      dataset.createdAt,
      JSON.stringify(dataset.fetchWindow),
      JSON.stringify(dataset.sourceConfig),
      JSON.stringify(dataset.scoringWeights),
      JSON.stringify(dataset.warnings),
    );

    const insertItem = db.prepare("INSERT INTO activity_items (id, dataset_id, item_key, json) VALUES (?, ?, ?, ?)");
    const insertExcerpt = db.prepare("INSERT INTO activity_excerpts (id, item_id, kind, rank, json) VALUES (?, ?, ?, ?, ?)");
    const insertState = db.prepare(
      `INSERT INTO dataset_item_state (item_id, dataset_id, reviewed, selected, included_in_generated_prompt, posted, selection_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const item of dataset.items) {
      insertItem.run(item.id, dataset.id, item.itemKey, JSON.stringify({ ...item, excerpts: undefined, state: undefined }));
      item.excerpts.forEach((excerpt, index) => {
        insertExcerpt.run(`${item.id}:${excerpt.id}`, item.id, excerpt.kind, index, JSON.stringify(excerpt));
      });
      insertState.run(
        item.id,
        dataset.id,
        item.state.reviewed ? 1 : 0,
        item.state.selected ? 1 : 0,
        item.state.includedInGeneratedPrompt ? 1 : 0,
        item.state.posted ? 1 : 0,
        item.state.selectionOrder,
        new Date().toISOString(),
      );
    }
  });

  transaction();
  return getDataset(db, dataset.id) ?? dataset;
}

export function inflateDataset(db: SqliteDatabase, row: Record<string, string>): DatasetRecord {
  const itemRows = db.prepare("SELECT id, json FROM activity_items WHERE dataset_id = ?").all(row.id) as Array<{ id: string; json: string }>;
  const stateRows = db
    .prepare("SELECT * FROM dataset_item_state WHERE dataset_id = ?")
    .all(row.id) as Array<Record<string, unknown>>;
  const stateMap = new Map(stateRows.map((stateRow) => [String(stateRow.item_id), stateRow]));

  const items = itemRows.map((itemRow) => {
    const item = JSON.parse(itemRow.json) as Omit<ActivityItem, "excerpts" | "state">;
    const excerpts = db
      .prepare("SELECT json FROM activity_excerpts WHERE item_id = ? ORDER BY rank ASC")
      .all(itemRow.id) as Array<{ json: string }>;

    return {
      ...item,
      discussionTimeline: item.discussionTimeline ?? [],
      excerpts: excerpts.map((excerptRow) => JSON.parse(excerptRow.json)),
      state: rowToState(stateMap.get(itemRow.id)),
      alreadyShared: Boolean(getLatestPostedMarker(db, item.itemKey)),
    } as ActivityItem;
  });

  return {
    id: row.id,
    cacheKey: row.cache_key,
    createdAt: row.created_at,
    fetchWindow: JSON.parse(row.fetch_window_json),
    sourceConfig: normalizeSourceConfig(JSON.parse(row.source_config_json) as AppSettings["sourceConfig"]),
    scoringWeights: JSON.parse(row.scoring_weights_json),
    warnings: JSON.parse(row.warnings_json),
    items,
  };
}

export function getDataset(db: SqliteDatabase, datasetId: string): DatasetRecord | null {
  const row = db.prepare("SELECT * FROM datasets WHERE id = ?").get(datasetId) as Record<string, string> | undefined;
  return row ? inflateDataset(db, row) : null;
}

export function getDatasetByCacheKey(db: SqliteDatabase, cacheKey: string): DatasetRecord | null {
  const row = db.prepare("SELECT * FROM datasets WHERE cache_key = ?").get(cacheKey) as Record<string, string> | undefined;
  return row ? inflateDataset(db, row) : null;
}

export function updateItemState(
  db: SqliteDatabase,
  datasetId: string,
  itemId: string,
  patch: Partial<ItemState>,
): DatasetRecord | null {
  const current = db.prepare("SELECT * FROM dataset_item_state WHERE item_id = ? AND dataset_id = ?").get(itemId, datasetId) as Record<string, unknown> | undefined;
  if (!current) {
    return null;
  }

  const nextState = {
    reviewed: patch.reviewed ?? Boolean(current.reviewed),
    selected: patch.selected ?? Boolean(current.selected),
    included_in_generated_prompt:
      patch.includedInGeneratedPrompt ?? Boolean(current.included_in_generated_prompt),
    posted: patch.posted ?? Boolean(current.posted),
    selection_order:
      patch.selectionOrder === undefined
        ? (typeof current.selection_order === "number" ? current.selection_order : null)
        : patch.selectionOrder,
  };

  db.prepare(
    `UPDATE dataset_item_state
     SET reviewed = ?, selected = ?, included_in_generated_prompt = ?, posted = ?, selection_order = ?, updated_at = ?
     WHERE item_id = ? AND dataset_id = ?`,
  ).run(
    nextState.reviewed ? 1 : 0,
    nextState.selected ? 1 : 0,
    nextState.included_in_generated_prompt ? 1 : 0,
    nextState.posted ? 1 : 0,
    nextState.selection_order,
    new Date().toISOString(),
    itemId,
    datasetId,
  );

  return getDataset(db, datasetId);
}

export function markItemPosted(db: SqliteDatabase, itemKey: string, request: PostItemRequest): DatasetRecord | null {
  const itemRow = db
    .prepare("SELECT id FROM activity_items WHERE dataset_id = ? AND item_key = ?")
    .get(request.datasetId, itemKey) as { id: string } | undefined;

  if (!itemRow) {
    return null;
  }

  const postedAt = new Date().toISOString();
  const transaction = db.transaction(() => {
    db.prepare("INSERT INTO posted_markers (id, item_key, dataset_id, posted_at) VALUES (?, ?, ?, ?)")
      .run(randomUUID(), itemKey, request.datasetId, postedAt);
    db.prepare(
      "UPDATE dataset_item_state SET posted = 1, updated_at = ? WHERE item_id = ? AND dataset_id = ?",
    ).run(postedAt, itemRow.id, request.datasetId);
  });
  transaction();

  return getDataset(db, request.datasetId);
}

export function createEmptyDatasetRecord(
  fetchWindow: FetchWindow,
  sourceConfig: AppSettings["sourceConfig"],
  scoringWeights: ScoringWeights,
): DatasetRecord {
  const normalizedSourceConfig = normalizeSourceConfig(sourceConfig);

  return {
    id: randomUUID(),
    cacheKey: buildCacheKey(fetchWindow, normalizedSourceConfig),
    createdAt: new Date().toISOString(),
    fetchWindow,
    sourceConfig: normalizedSourceConfig,
    scoringWeights,
    warnings: [],
    items: [],
  };
}
