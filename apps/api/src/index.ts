import { buildApp } from "./app";

const port = Number(process.env.PORT ?? 4000);

const app = await buildApp();
await app.listen({ port, host: "0.0.0.0" });

