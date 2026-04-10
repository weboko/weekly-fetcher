import cors from "@fastify/cors";
import Fastify, { type FastifyServerOptions } from "fastify";

import { createDatabase, type SqliteDatabase } from "./db";
import { registerRoutes } from "./routes";

interface BuildAppOptions {
  db?: SqliteDatabase;
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });
  const db = options.db ?? createDatabase();

  await app.register(cors, {
    origin: true,
  });

  await registerRoutes(app, db);
  return app;
}
