import { formatDateLabel, type ActivityItem } from "@weekly/shared";

interface DetailPanelProps {
  item: ActivityItem | null;
  onToggleSelected: (item: ActivityItem, selected: boolean) => void;
  onMarkPosted: (item: ActivityItem) => void;
}

export function DetailPanel({ item, onToggleSelected, onMarkPosted }: DetailPanelProps) {
  if (!item) {
    return (
      <section className="panel detail-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Detail</p>
            <h2>No item selected</h2>
          </div>
        </div>
        <p>Select a row to inspect excerpts, linkage, and posting controls.</p>
      </section>
    );
  }

  return (
    <section className="panel detail-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">{item.source} / {item.type}</p>
          <h2>{item.title}</h2>
        </div>
        <div className="button-row">
          <button className="secondary-button" onClick={() => onToggleSelected(item, !item.state.selected)}>
            {item.state.selected ? "Unselect" : "Select"}
          </button>
          <button className="primary-button" onClick={() => onMarkPosted(item)}>
            Mark posted
          </button>
        </div>
      </div>

      <div className="metric-grid">
        <div>
          <span>Status</span>
          <strong>{item.status}</strong>
        </div>
        <div>
          <span>Total score</span>
          <strong>{item.score.total.toFixed(1)}</strong>
        </div>
        <div>
          <span>Created</span>
          <strong>{formatDateLabel(item.createdAt)}</strong>
        </div>
        <div>
          <span>Completed</span>
          <strong>{formatDateLabel(item.completedAt)}</strong>
        </div>
      </div>

      <p className="detail-summary">{item.summary}</p>
      <p>{item.body}</p>

      <div className="detail-section">
        <h3>Top discussion excerpts</h3>
        {item.excerpts.length === 0 ? <p>No discussion excerpts captured.</p> : null}
        {item.excerpts.map((excerpt) => (
          <article key={excerpt.id} className="excerpt-card">
            <strong>{excerpt.author}</strong>
            <span>{formatDateLabel(excerpt.createdAt)} · {excerpt.reactionCount} reactions</span>
            <p>{excerpt.body}</p>
          </article>
        ))}
      </div>

      <div className="detail-section">
        <h3>Linked items</h3>
        {item.linkedItems.length === 0 ? <p>No linked issues or PRs detected.</p> : null}
        {item.linkedItems.map((linkedItem) => (
          <p key={linkedItem.target}>{linkedItem.kind}: {linkedItem.target}</p>
        ))}
      </div>

      <div className="detail-section">
        <h3>Warnings</h3>
        {item.warnings.length === 0 ? <p>No item-level warnings.</p> : null}
        {item.warnings.map((warning) => (
          <p key={warning}>{warning}</p>
        ))}
      </div>

      <a href={item.url} target="_blank" rel="noreferrer">
        Open original source
      </a>
    </section>
  );
}

