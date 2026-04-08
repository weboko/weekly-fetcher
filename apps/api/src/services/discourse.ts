import { clampText, isWithinWindow, type ActivityEvent, type ActivityExcerpt, type ActivityItem, type DatasetWarning, type FetchWindow } from "@weekly/shared";
import { XMLParser } from "fast-xml-parser";
import { randomUUID } from "node:crypto";

import { fetchJson, fetchText } from "./http";

interface DiscourseLatestResponse {
  topic_list: {
    topics: Array<{
      id: number;
      title: string;
      slug?: string;
      created_at: string;
      last_posted_at: string;
      reply_count: number;
      like_count: number;
      posts_count: number;
      excerpt?: string;
      bumped_at?: string;
      visible: boolean;
    }>;
    more_topics_url?: string;
  };
}

interface DiscourseTopicResponse {
  title: string;
  slug?: string;
  id: number;
  created_at: string;
  last_posted_at: string;
  reply_count: number;
  like_count: number;
  posts_count: number;
  post_stream: {
    posts: Array<{
      id: number;
      username: string;
      created_at: string;
      cooked: string;
      actions_summary?: Array<{ id: number; count: number }>;
    }>;
  };
}

export interface DiscourseAdapterResult {
  items: Array<Omit<ActivityItem, "score" | "summary" | "alreadyShared" | "reactivated" | "activityWindow">>;
  warnings: DatasetWarning[];
}

function stripHtml(html: string): string {
  return clampText(html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " "), 1200);
}

function normalizeForumName(url: string): string {
  return new URL(url).host;
}

function normalizeReply(post: DiscourseTopicResponse["post_stream"]["posts"][number], kind: ActivityExcerpt["kind"]): ActivityExcerpt {
  return {
    id: String(post.id),
    kind,
    author: post.username,
    body: stripHtml(post.cooked),
    createdAt: post.created_at,
    reactionCount: post.actions_summary?.reduce((sum, action) => sum + action.count, 0) ?? 0,
  };
}

async function discoverTopics(forumUrl: string, window: FetchWindow): Promise<Array<{ id: number; title: string; slug?: string; url: string; createdAt: string; lastPostedAt: string; likeCount: number; replyCount: number; postsCount: number }>> {
  const baseUrl = forumUrl.replace(/\/+$/, "");
  const parser = new XMLParser({ ignoreAttributes: false });
  const [latest, rss] = await Promise.all([
    fetchJson<DiscourseLatestResponse>(`${baseUrl}/latest.json`),
    fetchText(`${baseUrl}/latest.rss`),
  ]);

  const topics = new Map<number, { id: number; title: string; slug?: string; url: string; createdAt: string; lastPostedAt: string; likeCount: number; replyCount: number; postsCount: number }>();
  for (const topic of latest.topic_list.topics) {
    if (!topic.visible) {
      continue;
    }
    if (!(isWithinWindow(topic.created_at, window) || isWithinWindow(topic.last_posted_at, window) || isWithinWindow(topic.bumped_at ?? null, window))) {
      continue;
    }
    topics.set(topic.id, {
      id: topic.id,
      title: topic.title,
      slug: topic.slug,
      url: `${baseUrl}/t/${topic.slug ?? topic.id}/${topic.id}`,
      createdAt: topic.created_at,
      lastPostedAt: topic.last_posted_at,
      likeCount: topic.like_count,
      replyCount: topic.reply_count,
      postsCount: topic.posts_count,
    });
  }

  const rssJson = parser.parse(rss) as {
    rss?: {
      channel?: {
        item?: Array<{
          title: string;
          link: string;
          pubDate: string;
        }> | {
          title: string;
          link: string;
          pubDate: string;
        };
      };
    };
  };
  const items = rssJson.rss?.channel?.item;
  const rssItems = Array.isArray(items) ? items : items ? [items] : [];
  for (const item of rssItems) {
    const idMatch = item.link.match(/\/(\d+)(?:$|\/)/);
    const id = idMatch ? Number(idMatch[1]) : null;
    if (!id || topics.has(id) || !isWithinWindow(new Date(item.pubDate).toISOString(), window)) {
      continue;
    }
    topics.set(id, {
      id,
      title: item.title,
      url: item.link,
      createdAt: new Date(item.pubDate).toISOString(),
      lastPostedAt: new Date(item.pubDate).toISOString(),
      likeCount: 0,
      replyCount: 0,
      postsCount: 1,
    });
  }

  return Array.from(topics.values());
}

export async function fetchDiscourseForumActivity(forumUrl: string, window: FetchWindow): Promise<DiscourseAdapterResult> {
  const warnings: DatasetWarning[] = [];
  const items: DiscourseAdapterResult["items"] = [];
  const baseUrl = forumUrl.replace(/\/+$/, "");
  const forumName = normalizeForumName(forumUrl);
  const topics = await discoverTopics(baseUrl, window);

  for (const topic of topics) {
    try {
      const detail = await fetchJson<DiscourseTopicResponse>(`${baseUrl}/t/${topic.id}.json`);
      const [firstPost, ...replies] = detail.post_stream.posts;
      const normalizedReplies = replies.map((reply) => normalizeReply(reply, "reply"));
      const events: ActivityEvent[] = [
        { id: `${topic.id}-created`, type: "created", createdAt: detail.created_at },
        ...normalizedReplies.map((reply) => ({
          id: `${reply.id}-reply`,
          type: "forum_activity" as const,
          createdAt: reply.createdAt,
        })),
      ];

      items.push({
        id: randomUUID(),
        itemKey: `discourse:${baseUrl}:topic:${topic.id}`,
        source: "discourse",
        type: "forum_topic",
        sourceMeta: {
          source: "discourse",
          forumUrl: baseUrl,
          forumName,
          topicId: topic.id,
          slug: detail.slug,
        },
        title: detail.title,
        body: stripHtml(firstPost?.cooked ?? ""),
        url: `${baseUrl}/t/${detail.slug ?? topic.id}/${topic.id}`,
        status: normalizedReplies.length > 0 ? "active" : "new",
        createdAt: detail.created_at,
        completedAt: null,
        latestActivityAt: detail.last_posted_at,
        linkedItems: [],
        excerpts: normalizedReplies.sort((left, right) => right.reactionCount - left.reactionCount || right.createdAt.localeCompare(left.createdAt)).slice(0, 3),
        metrics: {
          commentsCount: detail.reply_count,
          reactionsCount: detail.like_count + normalizedReplies.reduce((sum, reply) => sum + reply.reactionCount, 0),
          diffSize: null,
          additions: null,
          deletions: null,
          changedFiles: null,
        },
        events,
        warnings: [],
        state: {
          reviewed: false,
          selected: false,
          includedInGeneratedPrompt: false,
          posted: false,
          selectionOrder: null,
        },
      });
    } catch (error) {
      items.push({
        id: randomUUID(),
        itemKey: `discourse:${baseUrl}:topic:${topic.id}`,
        source: "discourse",
        type: "forum_topic",
        sourceMeta: {
          source: "discourse",
          forumUrl: baseUrl,
          forumName,
          topicId: topic.id,
          slug: topic.slug,
        },
        title: topic.title,
        body: "",
        url: topic.url,
        status: topic.replyCount > 0 ? "active" : "new",
        createdAt: topic.createdAt,
        completedAt: null,
        latestActivityAt: topic.lastPostedAt,
        linkedItems: [],
        excerpts: [],
        metrics: {
          commentsCount: topic.replyCount,
          reactionsCount: topic.likeCount,
          diffSize: null,
          additions: null,
          deletions: null,
          changedFiles: null,
        },
        events: [{ id: `${topic.id}-created`, type: "created", createdAt: topic.createdAt }],
        warnings: ["Topic metadata degraded; body and replies were unavailable."],
        state: {
          reviewed: false,
          selected: false,
          includedInGeneratedPrompt: false,
          posted: false,
          selectionOrder: null,
        },
      });
      warnings.push({
        id: randomUUID(),
        sourceKey: forumUrl,
        severity: "warning",
        message: `Topic ${topic.id} on ${forumName} was partially parsed: ${(error as Error).message}`,
      });
    }
  }

  return { items, warnings };
}

