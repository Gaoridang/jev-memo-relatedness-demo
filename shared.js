const SYSTEMONE_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";
const CORPUS_PATH = "/fixtures/korean-memo-relatedness-30.json";
const EXPECTED_COUNT = 41;
const EXPECTED_IDS = Object.freeze(
  Array.from({ length: EXPECTED_COUNT }, (_, i) => `m${String(i + 1).padStart(2, "0")}`)
);
const LONG_MEMO_IDS = Object.freeze([
  "m31",
  "m32",
  "m33",
  "m34",
  "m35",
  "m36",
  "m37",
  "m38",
  "m39",
  "m40",
  "m41",
]);
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

const THEME_HEURISTIC_LOW = 0.35;
const THEME_HEURISTIC_DRIFT = 0.28;
const THEME_LIVE_LOW = 0.45;

const THEME_MATCH_INSTRUCTIONS =
  "Does this active memo chunk belong to the given theme label? True if the chunk is about that theme. False if it is a different subject.";
const THEME_MATCH_CRITERIA = Object.freeze({
  true: "The chunk clearly continues or belongs under that theme.",
  false: "The chunk is about something else or has no clear link to that theme.",
});
const THEME_NEW_INSTRUCTIONS =
  "Is this active memo chunk a new topic that should not stay under the earlier themes in this memo?";
const THEME_NEW_CRITERIA = Object.freeze({
  true: "The chunk introduces a distinct subject from the earlier themes.",
  false: "The chunk still fits one of the earlier themes or is not a real topic shift.",
});
const THEME_NONE_INSTRUCTIONS =
  "Is this active memo chunk empty of a real topic (noise, a bare number, or no subject)?";
const THEME_NONE_CRITERIA = Object.freeze({
  true: "There is no identifiable topic worth labeling.",
  false: "The chunk has a real subject a reader could name.",
});

function splitBlocks(text) {
  const raw = String(text || "");
  const blocks = [];
  const re = /\n\n+/g;
  let last = 0;
  let i = 0;
  let match;
  while ((match = re.exec(raw)) !== null) {
    blocks.push({
      id: `b${String(i + 1).padStart(2, "0")}`,
      text: raw.slice(last, match.index),
      start: last,
      end: match.index,
      index: i,
    });
    i += 1;
    last = match.index + match[0].length;
  }
  blocks.push({
    id: `b${String(i + 1).padStart(2, "0")}`,
    text: raw.slice(last),
    start: last,
    end: raw.length,
    index: i,
  });
  return blocks;
}

function countNonEmptyBlocks(text) {
  return splitBlocks(text).filter((block) => normalizeText(block.text)).length;
}

function activeChunkAt(text, caret) {
  const blocks = splitBlocks(text);
  const pos = typeof caret === "number" ? caret : String(text || "").length;
  let active = blocks[0];
  for (const block of blocks) {
    if (pos >= block.start && pos <= block.end) {
      active = block;
      break;
    }
    if (pos > block.end) active = block;
  }
  if (!normalizeText(active.text)) {
    for (let i = active.index; i >= 0; i -= 1) {
      if (normalizeText(blocks[i].text)) {
        active = blocks[i];
        break;
      }
    }
  }
  const earlier = blocks
    .filter((b) => b.index < active.index && normalizeText(b.text))
    .map((b) => b.text);
  return { blocks, active, earlier };
}

function inventThemeLabel(chunk) {
  const words = String(chunk || "").match(/[가-힣]{2,}|[a-zA-Z0-9]{2,}/g) || [];
  if (!words.length) return "주제";
  return words.slice(0, 3).join(" ");
}

function pairOverlap(a, b) {
  return Math.max(overlapScore(a, b).score, overlapScore(b, a).score);
}

function proposeThemesHeuristic(chunk, priorThemes, earlierTexts) {
  const c = String(chunk || "");
  const priors = (priorThemes || []).filter((t) => t && t.label);
  const earlier = (earlierTexts || []).filter((t) => normalizeText(t));
  const themes = [];
  let bestPrior = 0;
  for (let i = 0; i < priors.length; i += 1) {
    const prior = priors[i];
    const labelScore = pairOverlap(c, prior.label);
    const sampleScore = prior.sample ? pairOverlap(c, prior.sample) : 0;
    const score = Math.max(labelScore, sampleScore);
    bestPrior = Math.max(bestPrior, score);
    themes.push({
      id: prior.id || `prior_${i}`,
      label: prior.label,
      score: Number(score.toFixed(4)),
    });
  }
  let maxEarlier = 0;
  for (let i = 0; i < earlier.length; i += 1) {
    const prev = earlier[i];
    const score = pairOverlap(c, prev);
    maxEarlier = Math.max(maxEarlier, score);
    const label = inventThemeLabel(prev);
    const existing = themes.find((theme) => theme.label === label);
    if (existing) {
      existing.score = Number(Math.max(existing.score, score).toFixed(4));
    } else {
      themes.push({
        id: `earlier_${i}`,
        label,
        score: Number(score.toFixed(4)),
      });
    }
  }
  const bestPriorMatch = Math.max(bestPrior, maxEarlier);
  const earlierExists = earlier.length > 0 || priors.length > 0;
  if (normalizeText(c) && (themes.length === 0 || bestPriorMatch < THEME_HEURISTIC_LOW)) {
    themes.push({
      id: "invented",
      label: inventThemeLabel(c),
      score: Number(bestPriorMatch.toFixed(4)),
    });
  }
  themes.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.id).localeCompare(String(b.id));
  });
  const confidence = themes.length ? themes[0].score : 0;
  const lowConfidence = confidence < THEME_HEURISTIC_LOW || !normalizeText(c);
  const drift = earlierExists && bestPriorMatch < THEME_HEURISTIC_DRIFT;
  return {
    ok: true,
    method: "heuristic",
    label: "keyword / overlap baseline",
    confidence: Number(confidence.toFixed(4)),
    lowConfidence,
    drift,
    themes,
  };
}

function normalizePriorThemes(priorThemes) {
  return (priorThemes || [])
    .filter((t) => t && typeof t.label === "string" && t.label.trim())
    .slice(0, 8)
    .map((t, i) => ({ id: t.id || `prior_${i}`, label: t.label.trim() }));
}

function buildThemeChunkRequest(chunk, priorThemes) {
  const c = normalizeText(chunk);
  const priors = normalizePriorThemes(priorThemes);
  const questions = {};
  for (const prior of priors) {
    questions[`match_${prior.id}`] = {
      type: "noul",
      instructions: [
        THEME_MATCH_INSTRUCTIONS,
        { active_chunk: c, theme_id: prior.id, theme_label: prior.label },
      ],
      criteria: { ...THEME_MATCH_CRITERIA },
    };
  }
  questions.new_topic = {
    type: "noul",
    instructions: [
      THEME_NEW_INSTRUCTIONS,
      { active_chunk: c, prior_themes: priors.map((p) => p.label) },
    ],
    criteria: { ...THEME_NEW_CRITERIA },
  };
  questions.none_topic = {
    type: "noul",
    instructions: [THEME_NONE_INSTRUCTIONS, { active_chunk: c }],
    criteria: { ...THEME_NONE_CRITERIA },
  };
  return {
    model: JEV_MODEL,
    state: {
      task: "active memo chunk theme",
      active_chunk: c,
      prior_themes: priors,
    },
    questions,
  };
}

function parseThemeChunkAnswers(payload, priorThemes, chunk) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "TypeSafe body is not a JSON object" };
  }
  const answers = payload.answers;
  if (!answers || typeof answers !== "object") {
    return { ok: false, error: "TypeSafe body has no answers object" };
  }
  const priors = normalizePriorThemes(priorThemes);
  const themes = [];
  for (const prior of priors) {
    const key = `match_${prior.id}`;
    const answer = answers[key];
    if (!answer || answer.type !== "noul" || typeof answer.noul !== "number") {
      return { ok: false, error: `Noul answer missing for ${key}` };
    }
    themes.push({
      id: prior.id,
      label: prior.label,
      score: Number(answer.noul.toFixed(4)),
    });
  }
  const newAns = answers.new_topic;
  const noneAns = answers.none_topic;
  if (!newAns || newAns.type !== "noul" || typeof newAns.noul !== "number") {
    return { ok: false, error: "Noul answer missing for new_topic" };
  }
  if (!noneAns || noneAns.type !== "noul" || typeof noneAns.noul !== "number") {
    return { ok: false, error: "Noul answer missing for none_topic" };
  }
  const bestPriorTheme = themes.length ? Math.max(...themes.map((t) => t.score)) : 0;
  const chunkText =
    chunk ||
    (payload.state && typeof payload.state.active_chunk === "string" ? payload.state.active_chunk : "");
  if (newAns.noul >= 0.35) {
    themes.push({
      id: "invented",
      label: inventThemeLabel(chunkText),
      score: Number(newAns.noul.toFixed(4)),
    });
  }
  themes.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.id).localeCompare(String(b.id));
  });
  const topTheme = themes.length ? themes[0].score : noneAns.noul;
  const confidence = Math.max(topTheme, noneAns.noul * 0.5);
  const lowConfidence = topTheme < THEME_LIVE_LOW || noneAns.noul >= 0.5;
  const drift = priors.length > 0 && newAns.noul >= 0.5 && bestPriorTheme < 0.55;
  return {
    ok: true,
    method: "live_jev",
    label: "live TypeSafe Jev (noul)",
    model: typeof payload.model === "string" ? payload.model : null,
    confidence: Number(Math.max(topTheme, confidence).toFixed(4)),
    lowConfidence,
    drift,
    themes,
    noneScore: Number(noneAns.noul.toFixed(4)),
    newScore: Number(newAns.noul.toFixed(4)),
  };
}

function buildThemeChips(result) {
  const chips = [];
  const seen = new Set();
  for (const theme of (result && result.themes) || []) {
    if (!theme.label || seen.has(theme.label)) continue;
    seen.add(theme.label);
    chips.push({ id: theme.id, label: theme.label, kind: "theme", score: theme.score });
  }
  if (result && result.lowConfidence) {
    chips.push({ id: "기타", label: "기타", kind: "기타", score: null });
    chips.push({ id: "없음", label: "없음", kind: "없음", score: null });
  }
  if (result && result.drift) {
    chips.push({ id: "새메모", label: "새 메모로 열기", kind: "새메모", score: null });
  }
  return chips;
}

function proposePasteStructure(text) {
  const blocks = splitBlocks(text).filter((b) => normalizeText(b.text));
  const themes = [];
  for (const block of blocks) {
    let placed = false;
    for (const theme of themes) {
      const score = overlapScore(block.text, theme.cards.map((c) => c.text).join("\n")).score;
      if (score >= 0.22) {
        theme.cards.push({ id: block.id, text: block.text });
        placed = true;
        break;
      }
    }
    if (!placed) {
      themes.push({
        id: `theme_${themes.length + 1}`,
        label: inventThemeLabel(block.text),
        cards: [{ id: block.id, text: block.text }],
      });
    }
  }
  return { themes, blockCount: blocks.length };
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
    kind: "related_run",
    ts: new Date().toISOString(),
    query: normalizeText(query),
    method,
    model: model || null,
    ranked: rows,
    ratings,
    note: typeof note === "string" ? note : "",
  };
}

function makeThemeChunkEvalEntry({
  chunk,
  proposals,
  confidence,
  method,
  chipChosen,
  newMemoNudge,
  padId,
  activeChunkId,
  model,
}) {
  return {
    kind: "theme_chunk",
    ts: new Date().toISOString(),
    chunk: String(chunk || ""),
    proposals: (proposals || []).map((p) => ({
      id: p.id,
      label: p.label,
      kind: p.kind || "theme",
      score: typeof p.score === "number" ? p.score : null,
    })),
    confidence: typeof confidence === "number" ? confidence : null,
    method: method || null,
    model: model || null,
    chipChosen: chipChosen == null ? null : String(chipChosen),
    newMemoNudge: newMemoNudge === "yes" || newMemoNudge === "no" ? newMemoNudge : null,
    padId: padId || null,
    activeChunkId: activeChunkId || null,
  };
}

function setThemeChunkChoice(entry, chipChosen, newMemoNudge) {
  if (!entry || entry.kind !== "theme_chunk") return entry;
  if (chipChosen !== undefined) entry.chipChosen = chipChosen;
  if (newMemoNudge === "yes" || newMemoNudge === "no" || newMemoNudge === null) {
    entry.newMemoNudge = newMemoNudge;
  }
  return entry;
}

function themeDriftFingerprint(chunkText, priorLabels) {
  const labels = (priorLabels || []).map((label) => String(label)).sort();
  return `${normalizeText(chunkText)}\0${labels.join("\0")}`;
}

function nextPadId(pads) {
  let max = 0;
  for (const pad of pads || []) {
    const n = Number(String(pad.id || "").replace(/\D/g, ""));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `p${String(max + 1).padStart(2, "0")}`;
}

function createPad(overrides) {
  const src = overrides || {};
  const text = typeof src.text === "string" ? src.text : "";
  return {
    id: src.id || "p01",
    text,
    caret: typeof src.caret === "number" ? src.caret : text.length,
    assignedThemeLabel: src.assignedThemeLabel || null,
  };
}

function createPadSession(overrides) {
  const pad = createPad(overrides && overrides.pad);
  return { pads: [pad], activePadId: pad.id };
}

function sliceChunkWithTrailingEmpty(text, chunk) {
  const raw = String(text || "");
  const start = chunk && typeof chunk.start === "number" ? chunk.start : 0;
  let end = chunk && typeof chunk.end === "number" ? chunk.end : raw.length;
  const rest = raw.slice(end);
  const blank = rest.match(/^(?:[ \t]*\n)+|[ \t]+$/);
  if (blank) end += blank[0].length;
  return { start, end, moved: raw.slice(start, end) };
}

function moveActiveChunkToNewPad(session, chunk, newPadId) {
  const pads = (session && session.pads) || [];
  const activeId = session && session.activePadId;
  const pad = pads.find((item) => item.id === activeId);
  if (!pad || !chunk) return session;
  const slice = sliceChunkWithTrailingEmpty(pad.text, chunk);
  pad.text = `${pad.text.slice(0, slice.start)}${pad.text.slice(slice.end)}`.replace(/[ \t]*\n+$/g, "");
  pad.caret = Math.min(slice.start, pad.text.length);
  const moved = slice.moved.replace(/^\n+/, "");
  const newPad = createPad({
    id: newPadId || nextPadId(pads),
    text: moved,
    caret: moved.length,
  });
  pads.push(newPad);
  session.activePadId = newPad.id;
  return session;
}

function mergePasteCards(structure, fromId, intoId) {
  if (!structure || fromId === intoId) return structure;
  let fromCard = null;
  let fromTheme = null;
  let intoCard = null;
  for (const theme of structure.themes || []) {
    for (const card of theme.cards) {
      if (card.id === fromId) {
        fromCard = card;
        fromTheme = theme;
      }
      if (card.id === intoId) intoCard = card;
    }
  }
  if (!fromCard || !intoCard || !fromTheme) return structure;
  intoCard.text = `${intoCard.text}\n\n${fromCard.text}`;
  fromTheme.cards = fromTheme.cards.filter((card) => card.id !== fromId);
  structure.themes = structure.themes.filter((theme) => theme.cards.length);
  return structure;
}

function movePasteCard(structure, cardId, themeId) {
  if (!structure) return structure;
  let card = null;
  let fromTheme = null;
  for (const theme of structure.themes || []) {
    const found = theme.cards.find((item) => item.id === cardId);
    if (found) {
      card = found;
      fromTheme = theme;
    }
  }
  const dest = (structure.themes || []).find((theme) => theme.id === themeId);
  if (!card || !fromTheme || !dest || fromTheme.id === dest.id) return structure;
  fromTheme.cards = fromTheme.cards.filter((item) => item.id !== cardId);
  dest.cards.push(card);
  structure.themes = structure.themes.filter((theme) => theme.cards.length);
  return structure;
}

function detachPasteCard(structure, cardId) {
  if (!structure) return structure;
  let card = null;
  let fromTheme = null;
  for (const theme of structure.themes || []) {
    const found = theme.cards.find((item) => item.id === cardId);
    if (found) {
      card = found;
      fromTheme = theme;
    }
  }
  if (!card || !fromTheme) return structure;
  if (fromTheme.cards.length === 1) return structure;
  fromTheme.cards = fromTheme.cards.filter((item) => item.id !== cardId);
  let n = structure.themes.length + 1;
  let id = `theme_${n}`;
  while (structure.themes.some((theme) => theme.id === id)) {
    n += 1;
    id = `theme_${n}`;
  }
  structure.themes.push({
    id,
    label: inventThemeLabel(card.text),
    cards: [card],
  });
  return structure;
}

function padsFromPasteStructure(structure, startN) {
  const base = typeof startN === "number" ? startN : 1;
  return ((structure && structure.themes) || [])
    .filter((theme) => theme.cards && theme.cards.length)
    .map((theme, index) =>
      createPad({
        id: `p${String(base + index).padStart(2, "0")}`,
        text: theme.cards.map((card) => card.text).join("\n\n"),
        assignedThemeLabel: theme.label,
      })
    );
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
  THEME_HEURISTIC_LOW,
  THEME_HEURISTIC_DRIFT,
  THEME_LIVE_LOW,
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
  splitBlocks,
  countNonEmptyBlocks,
  activeChunkAt,
  inventThemeLabel,
  pairOverlap,
  proposeThemesHeuristic,
  normalizePriorThemes,
  buildThemeChunkRequest,
  parseThemeChunkAnswers,
  buildThemeChips,
  proposePasteStructure,
  makeEvalEntry,
  makeThemeChunkEvalEntry,
  setThemeChunkChoice,
  themeDriftFingerprint,
  nextPadId,
  createPad,
  createPadSession,
  sliceChunkWithTrailingEmpty,
  moveActiveChunkToNewPad,
  mergePasteCards,
  movePasteCard,
  detachPasteCard,
  padsFromPasteStructure,
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
