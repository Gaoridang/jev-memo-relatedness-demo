const SYSTEMONE_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";
const CORPUS_PATH = "/fixtures/korean-memo-relatedness-30.json";
const EXPECTED_COUNT = 36;
const EXPECTED_IDS = Object.freeze(
  Array.from({ length: EXPECTED_COUNT }, (_, i) => `m${String(i + 1).padStart(2, "0")}`)
);
const LONG_MEMO_IDS = Object.freeze(["m31", "m32", "m33", "m34", "m35", "m36"]);
const DEFAULT_RESULT_LIMIT = 12;

const RELATED_NOUL_INSTRUCTIONS =
  "Is this candidate memo related to the query memo? Related means they share a topic, event, object, person, place, or the candidate is a multi-topic dump that includes the query's topic. Not related means different subjects even if a common word appears.";

const RELATED_NOUL_CRITERIA = Object.freeze({
  true: "A reader would want these two notes together because they are about the same or closely connected subject, or one memo lists the other's topic among several items.",
  false: "The memos are about different subjects and would not help each other.",
});

function isLongMemo(id) {
  return LONG_MEMO_IDS.includes(id);
}

function normalizeText(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function assertCorpus(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "corpus is not a JSON object" };
  }
  if (data.ground_truth !== null) {
    return { ok: false, error: "corpus must have ground_truth: null (no answer key)" };
  }
  if (data.count !== EXPECTED_COUNT) {
    return { ok: false, error: `corpus count must be ${EXPECTED_COUNT}` };
  }
  if (!Array.isArray(data.memos) || data.memos.length !== EXPECTED_COUNT) {
    return { ok: false, error: `corpus must list ${EXPECTED_COUNT} memos` };
  }
  const ids = data.memos.map((m) => m && m.id);
  for (let i = 0; i < EXPECTED_IDS.length; i += 1) {
    const memo = data.memos[i];
    if (!memo || memo.id !== EXPECTED_IDS[i]) {
      return { ok: false, error: `expected id ${EXPECTED_IDS[i]} at index ${i}, got ${ids[i]}` };
    }
    if (typeof memo.text !== "string" || !memo.text.trim()) {
      return { ok: false, error: `memo ${memo.id} has empty text` };
    }
  }
  return { ok: true, memos: data.memos, count: data.memos.length };
}

function tokenize(text) {
  const t = String(text || "").toLowerCase();
  const tokens = [];
  const seen = new Set();
  const words = t.match(/[가-힣]{2,}|[a-z0-9]{2,}/g) || [];
  for (const word of words) {
    if (!seen.has(word)) {
      seen.add(word);
      tokens.push(word);
    }
    if (/^[가-힣]+$/.test(word) && word.length > 2) {
      for (let i = 0; i < word.length - 1; i += 1) {
        const gram = word.slice(i, i + 2);
        if (!seen.has(gram)) {
          seen.add(gram);
          tokens.push(gram);
        }
      }
    }
  }
  return { tokens, set: seen };
}

function overlapScore(query, memoText) {
  const q = tokenize(query);
  const m = tokenize(memoText);
  if (q.set.size === 0 || m.set.size === 0) {
    return { score: 0, hits: [] };
  }
  const hits = q.tokens.filter((tok) => m.set.has(tok));
  const uniqueHits = [];
  const hitSeen = new Set();
  for (const hit of hits) {
    if (!hitSeen.has(hit)) {
      hitSeen.add(hit);
      uniqueHits.push(hit);
    }
  }
  let union = 0;
  for (const tok of q.set) union += 1;
  for (const tok of m.set) {
    if (!q.set.has(tok)) union += 1;
  }
  const jaccard = uniqueHits.length / Math.max(union, 1);
  const coverage = uniqueHits.length / q.set.size;
  const score = coverage * 0.72 + jaccard * 0.28 + Math.min(0.24, uniqueHits.length * 0.015);
  return { score, hits: uniqueHits.slice(0, 8) };
}

function excludeSelf(query, memos) {
  const q = normalizeText(query);
  return (memos || []).filter((memo) => normalizeText(memo.text) !== q);
}

function rankHeuristic(query, memos, limit) {
  const q = normalizeText(query);
  if (!q) {
    return {
      ok: false,
      error: "query is required",
      method: "heuristic",
      ranked: [],
    };
  }
  const pool = excludeSelf(q, memos);
  const ranked = pool
    .map((memo) => {
      const overlap = overlapScore(q, memo.text);
      const why =
        overlap.hits.length > 0
          ? `keyword overlap: ${overlap.hits.join(", ")}`
          : "no keyword overlap — still returned as a baseline candidate";
      return {
        id: memo.id,
        text: memo.text,
        score: Number(overlap.score.toFixed(4)),
        why,
        long: isLongMemo(memo.id),
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.id.localeCompare(b.id);
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));

  const cap = typeof limit === "number" ? limit : ranked.length;
  return {
    ok: true,
    method: "heuristic",
    label: "keyword / overlap baseline",
    ranked: ranked.slice(0, cap),
    all: ranked,
    poolSize: memos.length,
    compared: pool.length,
  };
}

function buildRelatednessRequest(query, candidates) {
  const q = normalizeText(query);
  const pool = (candidates || [])
    .filter((c) => c && typeof c.id === "string" && typeof c.text === "string")
    .map((c) => ({ id: c.id, text: c.text }));
  const questions = {};
  for (const candidate of pool) {
    questions[candidate.id] = {
      type: "noul",
      instructions: [
        RELATED_NOUL_INSTRUCTIONS,
        {
          query_memo: q,
          candidate_id: candidate.id,
          candidate_memo: candidate.text,
        },
      ],
      criteria: { ...RELATED_NOUL_CRITERIA },
    };
  }
  return {
    model: JEV_MODEL,
    state: {
      task: "memo relatedness",
      query_memo: q,
      pool,
    },
    questions,
  };
}

function parseRelatednessAnswers(payload, candidates) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "TypeSafe body is not a JSON object" };
  }
  const answers = payload.answers;
  if (!answers || typeof answers !== "object") {
    return { ok: false, error: "TypeSafe body has no answers object" };
  }
  const byId = new Map((candidates || []).map((c) => [c.id, c]));
  const ranked = [];
  const missing = [];
  for (const candidate of candidates || []) {
    const answer = answers[candidate.id];
    if (!answer || typeof answer !== "object") {
      missing.push(candidate.id);
      continue;
    }
    if (answer.type !== "noul") {
      return {
        ok: false,
        error: `expected Noul answer for ${candidate.id}, got type ${String(answer.type)}`,
      };
    }
    if (typeof answer.noul !== "number" || Number.isNaN(answer.noul)) {
      return { ok: false, error: `Noul answer for ${candidate.id} has no noul number` };
    }
    const source = byId.get(candidate.id) || candidate;
    ranked.push({
      id: candidate.id,
      text: source.text,
      score: Number(answer.noul.toFixed(4)),
      why: `live Jev noul ${answer.noul.toFixed(3)} (P(related))`,
      long: isLongMemo(candidate.id),
    });
  }
  if (missing.length) {
    return { ok: false, error: `TypeSafe answers missing: ${missing.join(", ")}` };
  }
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id.localeCompare(b.id);
  });
  ranked.forEach((row, index) => {
    row.rank = index + 1;
  });
  return {
    ok: true,
    method: "live_jev",
    label: "live TypeSafe Jev (noul)",
    model: typeof payload.model === "string" ? payload.model : null,
    ranked,
  };
}

function makeEvalEntry({ query, method, ranked, model, note }) {
  const rows = (ranked || []).map((row, index) => ({
    id: row.id,
    rank: typeof row.rank === "number" ? row.rank : index + 1,
    score: typeof row.score === "number" ? row.score : null,
    why: row.why || null,
  }));
  const ratings = {};
  for (const row of rows) ratings[row.id] = null;
  return {
    ts: new Date().toISOString(),
    query: normalizeText(query),
    method,
    model: model || null,
    ranked: rows,
    ratings,
    note: typeof note === "string" ? note : "",
  };
}

function setEvalRating(entry, id, rating) {
  if (!entry || !entry.ratings) return entry;
  if (rating !== "yes" && rating !== "no" && rating !== null) return entry;
  entry.ratings[id] = rating;
  return entry;
}

function toEvalJson(entries) {
  return JSON.stringify(entries || [], null, 2);
}

function toEvalJsonl(entries) {
  const rows = entries || [];
  if (!rows.length) return "";
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

const exported = {
  SYSTEMONE_URL,
  JEV_MODEL,
  CORPUS_PATH,
  EXPECTED_COUNT,
  EXPECTED_IDS,
  LONG_MEMO_IDS,
  DEFAULT_RESULT_LIMIT,
  RELATED_NOUL_INSTRUCTIONS,
  RELATED_NOUL_CRITERIA,
  isLongMemo,
  normalizeText,
  assertCorpus,
  tokenize,
  overlapScore,
  excludeSelf,
  rankHeuristic,
  buildRelatednessRequest,
  parseRelatednessAnswers,
  makeEvalEntry,
  setEvalRating,
  toEvalJson,
  toEvalJsonl,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = exported;
}
if (typeof globalThis !== "undefined") {
  Object.assign(globalThis, exported);
}
