const {
  SYSTEMONE_URL,
  buildRelatednessRequest,
} = require("../relatedness");

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

async function proxySystemOne(res, key, payload) {
  let upstream;
  try {
    upstream = await fetch(SYSTEMONE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    res.status(502).json({
      error: "TypeSafe network error",
      detail: err && err.message ? err.message : String(err),
    });
    return;
  }
  const text = await upstream.text();
  res.status(upstream.status);
  res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
  res.send(text);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const key = typeof process.env.JEV_API_KEY === "string" ? process.env.JEV_API_KEY.trim() : "";
  if (!key) {
    res.status(503).json({
      error: "no key / not called",
      detail: "Vercel env JEV_API_KEY is not set",
    });
    return;
  }

  const parsed = readBody(req);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const body = parsed.body || {};
  const query = typeof body.query === "string" ? body.query : "";
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  if (!query.trim()) {
    res.status(400).json({ error: "query is required" });
    return;
  }
  if (!candidates.length) {
    res.status(400).json({ error: "candidates are required" });
    return;
  }
  if (candidates.length > 80) {
    res.status(400).json({ error: "too many candidates" });
    return;
  }
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.id !== "string" || typeof candidate.text !== "string") {
      res.status(400).json({ error: "each candidate needs id and text" });
      return;
    }
  }

  await proxySystemOne(res, key, buildRelatednessRequest(query, candidates));
};
