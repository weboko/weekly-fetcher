export const DEFAULT_SCORING_WEIGHTS = {
    deliveryWeight: 0.55,
    engagementWeight: 0.35,
    aiWeight: 0.1,
    deliveryParams: {
        mergedPrBase: 88,
        completedIssueBase: 84,
        activePrBase: 58,
        activeIssueBase: 50,
        forumBase: 46,
        lowValueClosureBase: 15,
        linkedBonus: 8,
        diffUnit: 120,
    },
    engagementParams: {
        commentWeight: 6,
        reactionWeight: 3,
        activityBonus: 12,
    },
};
function scoreDelivery(item, weights) {
    const params = weights.deliveryParams;
    const linkedBonus = Math.min(20, item.linkedItems.length * params.linkedBonus);
    const diffBonus = item.metrics.diffSize && item.metrics.diffSize > 0
        ? Math.min(12, Math.log1p(item.metrics.diffSize / params.diffUnit) * 6)
        : 0;
    if (item.type === "pull_request") {
        if (item.status === "merged") {
            return params.mergedPrBase + linkedBonus + diffBonus;
        }
        if (item.status === "open") {
            return params.activePrBase + linkedBonus + diffBonus;
        }
        return params.lowValueClosureBase + diffBonus;
    }
    if (item.type === "issue") {
        if (item.status === "completed" || item.status === "closed") {
            return params.completedIssueBase + linkedBonus;
        }
        if (item.status === "open") {
            return params.activeIssueBase + linkedBonus;
        }
        return params.lowValueClosureBase;
    }
    const activityBoost = item.metrics.commentsCount > 0 ? 10 : 0;
    return params.forumBase + activityBoost + Math.min(10, item.metrics.reactionsCount * 2);
}
function scoreEngagement(item, weights) {
    const params = weights.engagementParams;
    const base = item.metrics.commentsCount * params.commentWeight +
        item.metrics.reactionsCount * params.reactionWeight;
    const activityBonus = item.events.length > 1 ? params.activityBonus : 0;
    return Math.min(100, base + activityBonus);
}
export function computeScores(item, weights, aiRelevance = null) {
    const delivery = scoreDelivery(item, weights);
    const engagement = scoreEngagement(item, weights);
    const aiScore = aiRelevance ?? 0;
    const total = delivery * weights.deliveryWeight +
        engagement * weights.engagementWeight +
        aiScore * weights.aiWeight;
    return {
        delivery: Math.round(delivery * 100) / 100,
        engagement: Math.round(engagement * 100) / 100,
        aiRelevance,
        total: Math.round(total * 100) / 100,
    };
}
