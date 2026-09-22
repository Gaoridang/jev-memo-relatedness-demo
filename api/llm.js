const { OPENAI_CHAT_URL, buildThemeTitleBody } = require("../shared");

function readBody(req) {
  if (req.body && typeof req.body === "object") return { ok: true, body: req.body };
  if (typeof req.body === "string") {
    try {
      return { ok: true, body: JSON.parse(req.body) };
    } catch (err) {
      return { ok: false, error: "request body is not JSON" };
    }
  }
  return { ok: true, body: {} };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const key =
    typeof process.env.OPENAI_API_KEY === "string" ? process.env.OPENAI_API_KEY.trim() : "";
  if (!key) {
    res.status(503).json({
      error: "disabled",
      detail: "Vercel env OPENAI_API_KEY is not set",
    });
    return;
  }

  const parsed = readBody(req);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const body = parsed.body || {};
  const chunk = typeof body.chunk === "string" ? body.chunk : "";
  if (!chunk.trim()) {
    res.status(400).json({ error: "chunk is required" });
    return;
  }
  const priorLabels = Array.isArray(body.priorLabels) ? body.priorLabels : [];

  let upstream;
  try {
    upstream = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildThemeTitleBody(chunk, priorLabels)),
    });
  } catch (err) {
    res.status(502).json({
      error: "OpenAI network error",
      detail: err && err.message ? err.message : String(err),
    });
    return;
  }
  const text = await upstream.text();
  res.status(upstream.status);
  res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
  res.send(text);
};
