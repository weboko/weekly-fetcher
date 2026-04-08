import cors from "@fastify/cors";
import Fastify from "fastify";

import { createDatabase } from "./db";
import { registerRoutes } from "./routes";

export async function buildApp() {
  const app = Fastify({ logger: false });
  const db = createDatabase();

  await app.register(cors, {
    origin: true,
  });

  await registerRoutes(app, db);
  return app;
}

