import { type FastifyInstance } from "fastify";
import { type AppSettings, type FetchRequest, type PostItemRequest, type UpdateItemStateRequest } from "@weekly/shared";

import type { SqliteDatabase } from "./db";
import * as fetcherService from "./services/fetcher";
import { getDataset, getSettings, markItemPosted, saveSettings, updateItemState } from "./services/store";

export async function registerRoutes(app: FastifyInstance, db: SqliteDatabase) {
  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/settings", async () => getSettings(db));

  app.put<{ Body: AppSettings }>("/api/settings", async (request, reply) => {
    return reply.send(saveSettings(db, request.body));
  });

  app.post<{ Body: FetchRequest }>("/api/fetch", async (request, reply) => {
    const startedAt = Date.now();
    const logger = request.log.child({
      requestId: request.id,
      route: "/api/fetch",
    });

    logger.info(
      {
        githubTargetCount: request.body.sourceConfig.githubTargets.length,
        forumCount: request.body.sourceConfig.forums.length,
        fetchWindow: request.body.fetchWindow,
      },
      "Fetch request started",
    );

    try {
      const dataset = await fetcherService.fetchDataset(db, request.body, { logger });
      logger.info(
        {
          datasetId: dataset.id,
          itemCount: dataset.items.length,
          warningCount: dataset.warnings.length,
          durationMs: Date.now() - startedAt,
        },
        "Fetch request completed",
      );
      return reply.send({ dataset });
    } catch (error) {
      logger.error(
        {
          durationMs: Date.now() - startedAt,
          errorMessage: error instanceof Error ? error.message : "Dataset fetch failed",
        },
        "Fetch request failed",
      );
      return reply.code(500).send({
        message: error instanceof Error ? error.message : "Dataset fetch failed",
      });
    }
  });

  app.get<{ Params: { datasetId: string } }>("/api/datasets/:datasetId", async (request, reply) => {
    const dataset = getDataset(db, request.params.datasetId);
    if (!dataset) {
      return reply.code(404).send({ message: "Dataset not found" });
    }
    return reply.send({ dataset });
  });

  app.patch<{ Params: { datasetId: string; itemId: string }; Body: UpdateItemStateRequest }>(
    "/api/datasets/:datasetId/items/:itemId",
    async (request, reply) => {
      const dataset = updateItemState(db, request.params.datasetId, request.params.itemId, request.body);
      if (!dataset) {
        return reply.code(404).send({ message: "Item state not found" });
      }
      return reply.send({ dataset });
    },
  );

  app.post<{ Params: { itemKey: string }; Body: PostItemRequest }>("/api/items/:itemKey/posted", async (request, reply) => {
    const dataset = markItemPosted(db, decodeURIComponent(request.params.itemKey), request.body);
    if (!dataset) {
      return reply.code(404).send({ message: "Item not found for dataset" });
    }
    return reply.send({ dataset });
  });
}
