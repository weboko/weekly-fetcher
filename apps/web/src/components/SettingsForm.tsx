import { createDefaultFetchWindow, DEFAULT_SCORING_WEIGHTS, UPDATE_PLACEHOLDER, type AppSettings } from "@weekly/shared";
import { useEffect, useState } from "react";

interface SettingsFormProps {
  initialSettings: AppSettings;
  onSave: (settings: AppSettings) => Promise<void>;
  onFetch: (settings: AppSettings, githubToken: string) => Promise<void>;
  isFetching: boolean;
}

export function SettingsForm({ initialSettings, onSave, onFetch, isFetching }: SettingsFormProps) {
  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const [githubToken, setGithubToken] = useState("");
  const [fetchError, setFetchError] = useState("");

  useEffect(() => {
    setSettings(initialSettings);
    setFetchError("");
  }, [initialSettings]);

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function handleFetch() {
    setFetchError("");

    if (settings.sourceConfig.githubTargets.length > 0 && !githubToken.trim()) {
      setFetchError("GitHub targets require a GitHub token for fetches.");
      return;
    }

    try {
      await onFetch(settings, githubToken.trim());
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : "Fetch failed");
    }
  }

  return (
    <section className="panel settings-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Configuration</p>
          <h2>Settings</h2>
        </div>
        <button className="secondary-button" onClick={() => setSettings(initialSettings)}>
          Reset
        </button>
      </div>

      <label>
        GitHub targets
        <textarea
          value={settings.sourceConfig.githubTargets.join("\n")}
          onChange={(event) =>
            update("sourceConfig", {
              ...settings.sourceConfig,
              githubTargets: event.target.value
                .split("\n")
                .map((value) => value.trim())
                .filter(Boolean),
            })
          }
          placeholder={"owner/repo\norg:owner"}
        />
        <small>One per line. Use <code>owner/repo</code> for a single repo or <code>org:owner</code> for all active public repos in an organization.</small>
      </label>

      <label>
        Forum URLs
        <textarea
          value={settings.sourceConfig.forums.join("\n")}
          onChange={(event) =>
            update("sourceConfig", {
              ...settings.sourceConfig,
              forums: event.target.value
                .split("\n")
                .map((value) => value.trim())
                .filter(Boolean),
            })
          }
        />
      </label>

      <div className="grid two">
        <label>
          Start date
          <input
            type="date"
            value={settings.fetchWindow.startDate}
            onChange={(event) =>
              update("fetchWindow", {
                ...settings.fetchWindow,
                startDate: event.target.value,
              })
            }
          />
        </label>
        <label>
          End date
          <input
            type="date"
            value={settings.fetchWindow.endDate}
            onChange={(event) =>
              update("fetchWindow", {
                ...settings.fetchWindow,
                endDate: event.target.value,
              })
            }
          />
        </label>
      </div>

      <div className="grid two">
        <label>
          Time zone
          <input
            type="text"
            value={settings.fetchWindow.timeZone}
            onChange={(event) =>
              update("fetchWindow", {
                ...settings.fetchWindow,
                timeZone: event.target.value,
              })
            }
          />
        </label>
        <label>
          Token limit
          <input
            type="number"
            value={settings.tokenLimit}
            onChange={(event) => update("tokenLimit", Number(event.target.value))}
          />
        </label>
      </div>

      <label>
        Prompt template
        <textarea
          value={settings.promptTemplate}
          onChange={(event) => update("promptTemplate", event.target.value)}
          rows={10}
        />
        <small>Use {UPDATE_PLACEHOLDER} where selected items should be inserted.</small>
      </label>

      <div className="grid three">
        <label>
          Delivery weight
          <input
            type="number"
            step="0.05"
            value={settings.scoringWeights.deliveryWeight}
            onChange={(event) =>
              update("scoringWeights", {
                ...settings.scoringWeights,
                deliveryWeight: Number(event.target.value),
              })
            }
          />
        </label>
        <label>
          Engagement weight
          <input
            type="number"
            step="0.05"
            value={settings.scoringWeights.engagementWeight}
            onChange={(event) =>
              update("scoringWeights", {
                ...settings.scoringWeights,
                engagementWeight: Number(event.target.value),
              })
            }
          />
        </label>
        <label>
          AI weight
          <input
            type="number"
            step="0.05"
            value={settings.scoringWeights.aiWeight}
            onChange={(event) =>
              update("scoringWeights", {
                ...settings.scoringWeights,
                aiWeight: Number(event.target.value),
              })
            }
          />
        </label>
      </div>

      <div className="grid two">
        <label>
          Comment weight
          <input
            type="number"
            step="1"
            value={settings.scoringWeights.engagementParams.commentWeight}
            onChange={(event) =>
              update("scoringWeights", {
                ...settings.scoringWeights,
                engagementParams: {
                  ...settings.scoringWeights.engagementParams,
                  commentWeight: Number(event.target.value),
                },
              })
            }
          />
        </label>
        <label>
          Reaction weight
          <input
            type="number"
            step="1"
            value={settings.scoringWeights.engagementParams.reactionWeight}
            onChange={(event) =>
              update("scoringWeights", {
                ...settings.scoringWeights,
                engagementParams: {
                  ...settings.scoringWeights.engagementParams,
                  reactionWeight: Number(event.target.value),
                },
              })
            }
          />
        </label>
      </div>

      <label>
        GitHub token
        <input
          type="password"
          value={githubToken}
          onChange={(event) => {
            setGithubToken(event.target.value);
            setFetchError("");
          }}
          placeholder="Required for GitHub fetches; used for the next fetch only"
        />
      </label>
      {fetchError ? <p className="warning-text">{fetchError}</p> : null}

      <div className="button-row">
        <button
          className="secondary-button"
          onClick={() =>
            setSettings({
              ...initialSettings,
              fetchWindow: createDefaultFetchWindow(),
              scoringWeights: DEFAULT_SCORING_WEIGHTS,
            })
          }
        >
          Use defaults
        </button>
        <button className="secondary-button" onClick={() => void onSave(settings)}>
          Save settings
        </button>
        <button className="primary-button" disabled={isFetching} onClick={() => void handleFetch()}>
          {isFetching ? "Fetching…" : "Fetch weekly activity"}
        </button>
      </div>
    </section>
  );
}
