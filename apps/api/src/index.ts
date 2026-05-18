import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { researchRouter } from "./routes/research.js";

const app = new Hono();

// Middleware
app.use("*", cors());

// Health check
app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// Routes
app.route("/api/research", researchRouter);

// 404 fallback
app.notFound((c) => c.json({ error: "Not found" }, 404));

// Global error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

// Start server
const port = parseInt(process.env.PORT ?? "4000", 10);

console.log(`Contritas API server starting on port ${port}...`);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server running at http://localhost:${info.port}`);
});

export default app;
