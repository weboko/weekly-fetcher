import { clampText } from "./date";
export const UPDATE_PLACEHOLDER = "{{update_list}}";
export function buildSummary(item) {
    const statusPrefix = item.status === "merged"
        ? "Merged work"
        : item.status === "completed" || item.status === "closed"
            ? "Completed work"
            : item.status === "open"
                ? "Active work"
                : "Ongoing discussion";
    const linkedPart = item.linkedItems.length > 0 ? `with ${item.linkedItems.length} linked reference${item.linkedItems.length === 1 ? "" : "s"}` : "with no linked references";
    const discussionPart = item.metrics.commentsCount > 0
        ? `${item.metrics.commentsCount} discussion message${item.metrics.commentsCount === 1 ? "" : "s"}`
        : "little discussion";
    const reactivatedPart = item.reactivated ? "This is follow-up activity on something already shared." : "";
    return clampText(`${statusPrefix} ${linkedPart}; ${discussionPart}. ${clampText(item.body, 220)} ${reactivatedPart}`.trim(), 320);
}
function groupKey(item) {
    return `${item.source}:${item.type}`;
}
function sourceLabel(item) {
    if (item.sourceMeta.source === "github") {
        return `${item.sourceMeta.organization}/${item.sourceMeta.repository}`;
    }
    return item.sourceMeta.forumName;
}
function excerptBlock(excerpts) {
    if (!excerpts.length) {
        return "- Top discussion excerpts: none captured";
    }
    return excerpts
        .map((excerpt) => `- ${excerpt.kind} by ${excerpt.author} (${excerpt.createdAt}): ${clampText(excerpt.body, 280)}`)
        .join("\n");
}
export function renderPromptItems(items) {
    const groups = new Map();
    for (const item of items) {
        const key = groupKey(item);
        const list = groups.get(key) ?? [];
        list.push(item);
        groups.set(key, list);
    }
    return Array.from(groups.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, groupedItems]) => {
        const [source, type] = key.split(":");
        const heading = `## ${source} / ${type}`;
        const body = groupedItems
            .sort((left, right) => {
            if (right.score.total !== left.score.total) {
                return right.score.total - left.score.total;
            }
            return (left.state.selectionOrder ?? Number.MAX_SAFE_INTEGER) - (right.state.selectionOrder ?? Number.MAX_SAFE_INTEGER);
        })
            .map((item) => [
            `### ${item.title}`,
            `- Container: ${sourceLabel(item)}`,
            `- Source: ${item.source}`,
            `- Status: ${item.status}`,
            `- Activity window: ${item.activityWindow.activeStart} -> ${item.activityWindow.activeEnd}`,
            `- Already shared: ${item.alreadyShared ? "yes" : "no"}`,
            `- Summary: ${item.summary}`,
            `- Raw body excerpt: ${clampText(item.body, 500)}`,
            excerptBlock(item.excerpts.slice(0, 3)),
        ].join("\n"))
            .join("\n\n");
        return `${heading}\n\n${body}`;
    })
        .join("\n\n");
}
export function fillPromptTemplate(template, items) {
    const normalizedTemplate = template.includes(UPDATE_PLACEHOLDER)
        ? template
        : `${template.trim()}\n\n${UPDATE_PLACEHOLDER}`;
    return normalizedTemplate.replace(UPDATE_PLACEHOLDER, renderPromptItems(items));
}
