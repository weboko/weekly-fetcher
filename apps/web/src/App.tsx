import { useMutation, useQuery } from "@tanstack/react-query";
import { createDefaultFetchWindow, DEFAULT_SCORING_WEIGHTS, type ActivityItem, type AppSettings, type DatasetRecord } from "@weekly/shared";
import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";

import { ChartCard } from "./components/ChartCard";
import { DetailPanel } from "./components/DetailPanel";
import { PromptPanel } from "./components/PromptPanel";
import { ReviewTable } from "./components/ReviewTable";
import { SettingsForm } from "./components/SettingsForm";
import { fetchDataset, getDataset, getSettings, patchItemState, postItem, saveSettings } from "./lib/api";

const LAST_DATASET_KEY = "weekly:lastDatasetId";

function defaultSettings(): AppSettings {
  return {
    sourceConfig: {
      githubRepos: [],
      forums: ["https://forum.research.logos.co/", "https://forum.logos.co/"],
    },
    promptTemplate: `Create a weekly social update prompt with the items below.\n\n{{update_list}}`,
    scoringWeights: DEFAULT_SCORING_WEIGHTS,
    tokenLimit: 18000,
    fetchWindow: createDefaultFetchWindow(),
  };
}

function containerLabel(item: ActivityItem): string {
  return item.sourceMeta.source === "github"
    ? `${item.sourceMeta.organization}/${item.sourceMeta.repository}`
    : item.sourceMeta.forumName;
}

export function App() {
  const [dataset, setDataset] = useState<DatasetRecord | null>(null);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [topCount, setTopCount] = useState(5);
  const [filters, setFilters] = useState({
    source: "all",
    container: "",
    type: "all",
    scoreMin: "",
    alreadyShared: "all",
    createdAfter: "",
    completedAfter: "",
  });
  const [isPending, startTransition] = useTransition();

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
    initialData: defaultSettings,
  });

  useEffect(() => {
    const datasetId = localStorage.getItem(LAST_DATASET_KEY);
    if (!datasetId) {
      return;
    }
    void getDataset(datasetId)
      .then((response) => setDataset(response.dataset))
      .catch(() => undefined);
  }, []);

  const settingsMutation = useMutation({
    mutationFn: saveSettings,
  });

  const fetchMutation = useMutation({
    mutationFn: fetchDataset,
    onSuccess: (response) => {
      setDataset(response.dataset);
      localStorage.setItem(LAST_DATASET_KEY, response.dataset.id);
      settingsQuery.refetch();
    },
  });

  const deferredFilters = useDeferredValue(filters);

  const filteredItems = useMemo(() => {
    if (!dataset) {
      return [];
    }

    return dataset.items.filter((item) => {
      if (deferredFilters.source !== "all" && item.source !== deferredFilters.source) {
        return false;
      }
      if (deferredFilters.type !== "all" && item.type !== deferredFilters.type) {
        return false;
      }
      if (deferredFilters.container && !containerLabel(item).toLowerCase().includes(deferredFilters.container.toLowerCase())) {
        return false;
      }
      if (deferredFilters.alreadyShared !== "all") {
        const expected = deferredFilters.alreadyShared === "yes";
        if (item.alreadyShared !== expected) {
          return false;
        }
      }
      if (deferredFilters.scoreMin && item.score.total < Number(deferredFilters.scoreMin)) {
        return false;
      }
      if (deferredFilters.createdAfter && item.createdAt < `${deferredFilters.createdAfter}T00:00:00.000Z`) {
        return false;
      }
      if (deferredFilters.completedAfter) {
        if (!item.completedAt || item.completedAt < `${deferredFilters.completedAfter}T00:00:00.000Z`) {
          return false;
        }
      }
      return true;
    });
  }, [dataset, deferredFilters]);

  const selectedItems = useMemo(
    () => filteredItems.filter((item) => item.state.selected).sort((left, right) => (left.state.selectionOrder ?? 9999) - (right.state.selectionOrder ?? 9999)),
    [filteredItems],
  );

  const detailItem = useMemo(() => dataset?.items.find((item) => item.id === detailItemId) ?? null, [dataset, detailItemId]);

  async function refreshDataset(datasetId: string) {
    const response = await getDataset(datasetId);
    setDataset(response.dataset);
  }

  async function handleSaveSettings(nextSettings: AppSettings) {
    await settingsMutation.mutateAsync(nextSettings);
  }

  async function handleFetch(nextSettings: AppSettings, githubToken: string) {
    await handleSaveSettings(nextSettings);
    await fetchMutation.mutateAsync({
      sourceConfig: nextSettings.sourceConfig,
      fetchWindow: nextSettings.fetchWindow,
      scoringWeights: nextSettings.scoringWeights,
      githubToken: githubToken || undefined,
    });
  }

  async function handleToggleSelected(item: ActivityItem, selected: boolean) {
    if (!dataset) {
      return;
    }

    const selectedCount = dataset.items.filter((candidate) => candidate.state.selected).length;
    const response = await patchItemState(dataset.id, item.id, {
      selected,
      reviewed: true,
      selectionOrder: selected ? selectedCount + 1 : null,
    });
    setDataset(response.dataset);
  }

  async function markPosted(item: ActivityItem) {
    if (!dataset) {
      return;
    }
    const response = await postItem(item.itemKey, { datasetId: dataset.id });
    setDataset(response.dataset);
  }

  async function bulkSelectTop() {
    if (!dataset) {
      return;
    }
    const candidates = [...filteredItems].sort((left, right) => right.score.total - left.score.total).slice(0, topCount);
    for (const [index, item] of candidates.entries()) {
      await patchItemState(dataset.id, item.id, {
        selected: true,
        reviewed: true,
        selectionOrder: index + 1,
      });
    }
    await refreshDataset(dataset.id);
  }

  async function selectMergedPrs() {
    if (!dataset) {
      return;
    }
    const candidates = filteredItems.filter((item) => item.type === "pull_request" && item.status === "merged");
    for (const [index, item] of candidates.entries()) {
      await patchItemState(dataset.id, item.id, {
        selected: true,
        reviewed: true,
        selectionOrder: index + 1,
      });
    }
    await refreshDataset(dataset.id);
  }

  async function selectFiltered() {
    if (!dataset) {
      return;
    }
    for (const [index, item] of filteredItems.entries()) {
      await patchItemState(dataset.id, item.id, {
        selected: true,
        reviewed: true,
        selectionOrder: index + 1,
      });
    }
    await refreshDataset(dataset.id);
  }

  async function persistGenerated() {
    if (!dataset) {
      return;
    }
    startTransition(() => undefined);
    const itemsToPersist = selectedItems.filter((item) => !item.state.includedInGeneratedPrompt);
    for (const item of itemsToPersist) {
      await patchItemState(dataset.id, item.id, {
        includedInGeneratedPrompt: true,
      });
    }
    await refreshDataset(dataset.id);
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Weekly Social Update Prompt Builder</p>
          <h1>Review weekly activity, select signal, build the prompt.</h1>
        </div>
        <p className="subtle-copy">
          Single-operator workflow with durable fetch history, scoring, reactivation tracking, and a downloadable weekly chart.
        </p>
      </header>

      <section className="layout-grid">
        <SettingsForm
          initialSettings={settingsQuery.data ?? defaultSettings()}
          onSave={handleSaveSettings}
          onFetch={handleFetch}
          isFetching={fetchMutation.isPending}
        />

        <section className="main-column">
          <section className="panel filters-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Review</p>
                <h2>Fetched items</h2>
              </div>
              <div className="button-row">
                <input type="number" min="1" value={topCount} onChange={(event) => setTopCount(Number(event.target.value))} />
                <button className="secondary-button" onClick={() => void bulkSelectTop()}>
                  Select top N
                </button>
                <button className="secondary-button" onClick={() => void selectMergedPrs()}>
                  Select merged PRs
                </button>
                <button className="secondary-button" onClick={() => void selectFiltered()}>
                  Select filtered
                </button>
              </div>
            </div>
            <div className="grid filters-grid">
              <label>
                Source
                <select value={filters.source} onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value }))}>
                  <option value="all">All</option>
                  <option value="github">GitHub</option>
                  <option value="discourse">Forum</option>
                </select>
              </label>
              <label>
                Repo / forum
                <input value={filters.container} onChange={(event) => setFilters((current) => ({ ...current, container: event.target.value }))} />
              </label>
              <label>
                Item type
                <select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}>
                  <option value="all">All</option>
                  <option value="pull_request">Pull request</option>
                  <option value="issue">Issue</option>
                  <option value="forum_topic">Forum topic</option>
                </select>
              </label>
              <label>
                Min score
                <input value={filters.scoreMin} onChange={(event) => setFilters((current) => ({ ...current, scoreMin: event.target.value }))} />
              </label>
              <label>
                Already shared
                <select value={filters.alreadyShared} onChange={(event) => setFilters((current) => ({ ...current, alreadyShared: event.target.value }))}>
                  <option value="all">All</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label>
                Created after
                <input type="date" value={filters.createdAfter} onChange={(event) => setFilters((current) => ({ ...current, createdAfter: event.target.value }))} />
              </label>
              <label>
                Completed after
                <input type="date" value={filters.completedAfter} onChange={(event) => setFilters((current) => ({ ...current, completedAfter: event.target.value }))} />
              </label>
            </div>
            {dataset?.warnings.length ? (
              <div className="warnings-list">
                {dataset.warnings.map((warning) => (
                  <p key={warning.id} className={`warning-item ${warning.severity}`}>
                    {warning.severity}: {warning.message}
                  </p>
                ))}
              </div>
            ) : null}
            {dataset ? (
              <ReviewTable
                items={filteredItems}
                onToggleSelected={(item, selected) => void handleToggleSelected(item, selected)}
                onOpen={(item) => {
                  setDetailItemId(item.id);
                  void patchItemState(dataset.id, item.id, { reviewed: true }).then((response) => setDataset(response.dataset));
                }}
              />
            ) : (
              <p className="empty-state">Fetch a dataset to review activity.</p>
            )}
          </section>

          <div className="results-grid">
            <DetailPanel
              item={detailItem}
              onToggleSelected={(item, selected) => void handleToggleSelected(item, selected)}
              onMarkPosted={(item) => void markPosted(item)}
            />
            <div className="stack-column">
              <PromptPanel
                template={(settingsQuery.data ?? defaultSettings()).promptTemplate}
                selectedItems={selectedItems}
                tokenLimit={(settingsQuery.data ?? defaultSettings()).tokenLimit}
              />
              <div className="button-row align-end">
                <button className="primary-button" disabled={!selectedItems.length || isPending} onClick={() => void persistGenerated()}>
                  {isPending ? "Persisting…" : "Persist generated state"}
                </button>
              </div>
              <ChartCard items={dataset?.items ?? []} />
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

