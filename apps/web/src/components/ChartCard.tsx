import { type ActivityItem } from "@weekly/shared";
import { useMemo, useRef } from "react";

import { downloadSvgAsPng } from "../lib/chart";

interface ChartCardProps {
  items: ActivityItem[];
}

function count(items: ActivityItem[], predicate: (item: ActivityItem) => boolean) {
  return items.filter(predicate).length;
}

export function ChartCard({ items }: ChartCardProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const metrics = useMemo(() => {
    const githubItems = items.filter((item) => item.source === "github");
    const discourseItems = items.filter((item) => item.source === "discourse");
    return {
      mergedPrs: count(items, (item) => item.type === "pull_request" && item.status === "merged"),
      activePrs: count(items, (item) => item.type === "pull_request" && item.status === "open"),
      completedIssues: count(items, (item) => item.type === "issue" && (item.status === "completed" || item.status === "closed")),
      openIssues: count(items, (item) => item.type === "issue" && item.status === "open"),
      forumTopics: discourseItems.length,
      githubTotal: githubItems.length,
      discourseTotal: discourseItems.length,
    };
  }, [items]);

  const barMax = Math.max(
    metrics.mergedPrs,
    metrics.activePrs,
    metrics.completedIssues,
    metrics.openIssues,
    metrics.forumTopics,
    1,
  );
  const bars = [
    { label: "Merged PRs", value: metrics.mergedPrs, color: "#1e6f50" },
    { label: "Active PRs", value: metrics.activePrs, color: "#6d8a57" },
    { label: "Completed issues", value: metrics.completedIssues, color: "#c6732f" },
    { label: "Open issues", value: metrics.openIssues, color: "#d3a945" },
    { label: "Forum topics", value: metrics.forumTopics, color: "#496d8f" },
  ];

  return (
    <section className="panel chart-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Chart</p>
          <h2>Weekly activity snapshot</h2>
        </div>
        <button className="secondary-button" onClick={() => svgRef.current && void downloadSvgAsPng(svgRef.current, "weekly-activity.png")}>
          Download PNG
        </button>
      </div>
      <svg ref={svgRef} viewBox="0 0 920 500" role="img" aria-label="Weekly activity chart">
        <rect x="0" y="0" width="920" height="500" rx="28" fill="#f6f4ec" />
        <text x="48" y="66" fill="#1f2b23" fontSize="28" fontFamily="Fraunces, serif">
          Weekly activity across GitHub and Discourse
        </text>
        {[
          { label: "GitHub items", value: metrics.githubTotal, x: 48 },
          { label: "Forum items", value: metrics.discourseTotal, x: 258 },
          { label: "Completed issues", value: metrics.completedIssues, x: 468 },
          { label: "Merged PRs", value: metrics.mergedPrs, x: 678 },
        ].map((card) => (
          <g key={card.label}>
            <rect x={card.x} y="98" width="180" height="96" rx="22" fill="#efe8db" />
            <text x={card.x + 20} y="132" fill="#607365" fontSize="15" fontFamily="IBM Plex Sans, sans-serif">
              {card.label}
            </text>
            <text x={card.x + 20} y="175" fill="#1f2b23" fontSize="36" fontFamily="IBM Plex Sans, sans-serif">
              {card.value}
            </text>
          </g>
        ))}
        {bars.map((bar, index) => {
          const height = (bar.value / barMax) * 180;
          const x = 80 + index * 160;
          const y = 430 - height;
          return (
            <g key={bar.label}>
              <text x={x} y="460" fill="#516157" fontSize="15" fontFamily="IBM Plex Sans, sans-serif">
                {bar.label}
              </text>
              <rect x={x} y={y} width="84" height={height} rx="18" fill={bar.color} />
              <text x={x + 28} y={y - 10} fill="#1f2b23" fontSize="18" fontFamily="IBM Plex Sans, sans-serif">
                {bar.value}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}

