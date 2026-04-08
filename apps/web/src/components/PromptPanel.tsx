import { fillPromptTemplate, type ActivityItem } from "@weekly/shared";
import { useEffect, useMemo, useState } from "react";

import { estimateTokens } from "../lib/token";

interface PromptPanelProps {
  template: string;
  selectedItems: ActivityItem[];
  tokenLimit: number;
}

export function PromptPanel({ template, selectedItems, tokenLimit }: PromptPanelProps) {
  const prompt = useMemo(() => fillPromptTemplate(template, selectedItems), [selectedItems, template]);
  const [tokens, setTokens] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void estimateTokens(prompt).then((count) => {
      if (!cancelled) {
        setTokens(count);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [prompt]);

  return (
    <section className="panel prompt-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Output</p>
          <h2>Prompt preview</h2>
        </div>
        <div className={`token-pill ${tokens > tokenLimit ? "warning" : ""}`}>
          {tokens} tokens / limit {tokenLimit}
        </div>
      </div>
      {tokens > tokenLimit ? <p className="warning-text">The generated prompt exceeds the configured limit. Generation stays available.</p> : null}
      <textarea value={prompt} readOnly rows={18} />
    </section>
  );
}
