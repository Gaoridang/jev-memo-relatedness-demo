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
  const queryPhrases = scanPhrases(q);
  const ranked = pool
    .map((memo) => {
      const overlap = overlapScore(q, memo.text);
      const memoKeys = new Set(scanPhrases(memo.text).map((phrase) => phrase.key));
      const phraseHits = [];
      for (const phrase of queryPhrases) {
        if (memoKeys.has(phrase.key)) phraseHits.push(phrase.surface);
      }
      let why =
        overlap.hits.length > 0
          ? `keyword overlap: ${overlap.hits.join(", ")}`
          : "no keyword overlap — still returned as a baseline candidate";
      if (phraseHits.length) why += ` · names: ${phraseHits.join(", ")}`;
      return {
        id: memo.id,
        text: memo.text,
        score: Number(overlap.score.toFixed(4)),
        why,
        phraseHits,
        long: isLongMemo(memo.id),
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.phraseHits.length !== a.phraseHits.length) return b.phraseHits.length - a.phraseHits.length;
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
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-5.6-sol";

function readCatalogVocab() {
  if (typeof vocabEntries === "function") return vocabEntries();
  if (typeof module !== "undefined" && module.exports) return require("./theme-offer").vocabEntries();
  throw new Error("theme catalog missing");
}

function readExtractPhrases() {
  if (typeof extractPhrases === "function") return extractPhrases;
  if (typeof module !== "undefined" && module.exports) return require("./phrases").extractPhrases;
  throw new Error("phrase scanner missing");
}

const scanPhrases = readExtractPhrases();

const THEME_VOCAB = Object.freeze(readCatalogVocab());

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

function isChunkPrefixLabel(label, chunk) {
  const l = normalizeText(label);
  const c = normalizeText(chunk);
  if (!l || !c) return false;
  if (l === c) return true;
  if (c.startsWith(l) && l.length >= 4) return true;
  const words = c.match(/[가-힣]{2,}|[a-zA-Z0-9]{2,}/g) || [];
  if (!words.length) return false;
  const prefix = words.slice(0, 3).join(" ");
  return l === prefix;
}

function matchFixedThemeVocab(chunk) {
  const text = String(chunk || "").toLowerCase();
  if (!normalizeText(text)) return { label: null, score: 0, hits: [] };
  let best = null;
  for (let i = 0; i < THEME_VOCAB.length; i += 1) {
    const entry = THEME_VOCAB[i];
    const hits = entry.keywords.filter((kw) => text.includes(String(kw).toLowerCase()));
    if (!hits.length) continue;
    const score = Math.min(0.95, 0.42 + hits.length * 0.12);
    if (!best || score > best.score) {
      best = { label: entry.label, score: Number(score.toFixed(4)), hits, id: `vocab_${i}` };
    }
  }
  return best || { label: null, score: 0, hits: [] };
}

function safeThemeLabel(label, chunk) {
  const trimmed = normalizeText(label);
  if (!trimmed) return null;
  if (trimmed === "기타" || trimmed === "없음") return trimmed;
  if (isChunkPrefixLabel(trimmed, chunk)) return null;
  if (trimmed.length > 24) return null;
  return trimmed;
}

function pairOverlap(a, b) {
  return Math.max(overlapScore(a, b).score, overlapScore(b, a).score);
}

function vocabLabelsInText(text) {
  const raw = String(text || "").toLowerCase();
  const labels = [];
  if (!normalizeText(raw)) return labels;
  for (const entry of THEME_VOCAB) {
    const hit = entry.keywords.some((kw) => raw.includes(String(kw).toLowerCase()));
    if (hit) labels.push(entry.label);
  }
  return labels;
}

function classifyChunkSplit({ chunkText, earlierTexts, priorThemes, bestPriorMatch, live }) {
  const earlier = (earlierTexts || []).filter((text) => normalizeText(text));
  const priors = (priorThemes || []).filter((theme) => theme && theme.label);
  const lexical = typeof bestPriorMatch === "number" ? bestPriorMatch : 0;
  const legacyHeuristic =
    (earlier.length > 0 || priors.length > 0) && lexical < THEME_HEURISTIC_DRIFT;
  const legacyLive = Boolean(
    live &&
      priors.length > 0 &&
      typeof live.newScore === "number" &&
      live.newScore >= 0.5 &&
      typeof live.bestPriorTheme === "number" &&
      live.bestPriorTheme < 0.55
  );
  const legacyWouldNudge = live ? legacyLive : legacyHeuristic;
  const chunkLabels = vocabLabelsInText(chunkText);
  const earlierLabels = [];
  for (const prev of earlier) {
    for (const label of vocabLabelsInText(prev)) {
      if (!earlierLabels.includes(label)) earlierLabels.push(label);
    }
  }
  let maxEarlier = 0;
  for (const prev of earlier) maxEarlier = Math.max(maxEarlier, pairOverlap(chunkText, prev));
  const sameVocab = chunkLabels.some((label) => earlierLabels.includes(label));
  const conflictingVocab = chunkLabels.length > 0 && earlierLabels.length > 0 && !sameVocab;
  const continuation =
    earlier.length > 0 && !conflictingVocab && (sameVocab || maxEarlier >= THEME_HEURISTIC_DRIFT);
  const liveShift = Boolean(
    live &&
      earlier.length > 0 &&
      !continuation &&
      typeof live.newScore === "number" &&
      live.newScore >= 0.5 &&
      (typeof live.bestPriorTheme !== "number" || live.bestPriorTheme < 0.55)
  );
  const drift = earlier.length > 0 && !continuation && (conflictingVocab || liveShift);
  const falsePositive = Boolean(legacyWouldNudge) && !drift;
  const kind = drift ? "nudge" : falsePositive ? "candidate" : "none";
  return {
    drift,
    legacyWouldNudge: Boolean(legacyWouldNudge),
    falsePositive,
    kind,
  };
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
    const vocab = matchFixedThemeVocab(prev);
    const label = vocab.label;
    if (!label) continue;
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
  const vocab = matchFixedThemeVocab(c);
  if (vocab.label) {
    const existing = themes.find((theme) => theme.label === vocab.label);
    if (existing) {
      existing.score = Number(Math.max(existing.score, vocab.score).toFixed(4));
    } else {
      themes.push({
        id: vocab.id || "vocab",
        label: vocab.label,
        score: vocab.score,
      });
    }
  }
  themes.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.id).localeCompare(String(b.id));
  });
  const confidence = themes.length ? themes[0].score : 0;
  const bestPriorMatch = Math.max(bestPrior, maxEarlier);
  const lowConfidence = confidence < THEME_HEURISTIC_LOW || !normalizeText(c);
  const needsTitle = Boolean(normalizeText(c)) && (themes.length === 0 || confidence < THEME_HEURISTIC_LOW);
  const split = classifyChunkSplit({
    chunkText: c,
    earlierTexts: earlier,
    priorThemes: priors,
    bestPriorMatch,
    live: null,
  });
  return {
    ok: true,
    method: "heuristic",
    label: "keyword / overlap baseline",
    confidence: Number(confidence.toFixed(4)),
    lowConfidence,
    drift: split.drift,
    needsTitle,
    themes,
    bestPriorMatch: Number(bestPriorMatch.toFixed(4)),
    legacyWouldNudge: split.legacyWouldNudge,
    falsePositive: split.falsePositive,
    splitKind: split.kind,
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
  const catalog = readCatalogVocab();
  for (let i = 0; i < catalog.length; i += 1) {
    const key = `catalog_${i}`;
    questions[key] = {
      type: "noul",
      instructions: [
        THEME_MATCH_INSTRUCTIONS,
        { active_chunk: c, theme_id: key, theme_label: catalog[i].label },
      ],
      criteria: { ...THEME_MATCH_CRITERIA },
    };
  }
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
  const catalog = readCatalogVocab();
  for (let i = 0; i < catalog.length; i += 1) {
    const key = `catalog_${i}`;
    const answer = answers[key];
    if (!answer) continue;
    if (answer.type !== "noul" || typeof answer.noul !== "number") {
      return { ok: false, error: `Noul answer missing for ${key}` };
    }
    const score = Number(answer.noul.toFixed(4));
    const existing = themes.find((theme) => theme.label === catalog[i].label);
    if (existing) existing.score = Number(Math.max(existing.score, score).toFixed(4));
    else themes.push({ id: key, label: catalog[i].label, score });
  }
  themes.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.id).localeCompare(String(b.id));
  });
  const bestAfterVocab = themes.length ? themes[0].score : 0;
  const topTheme = themes.length ? themes[0].score : noneAns.noul;
  const confidence = Math.max(topTheme, noneAns.noul * 0.5, newAns.noul * 0.5);
  const lowConfidence = bestAfterVocab < THEME_LIVE_LOW || noneAns.noul >= 0.5;
  const drift = priors.length > 0 && newAns.noul >= 0.5 && bestPriorTheme < 0.55;
  const needsTitle =
    newAns.noul >= 0.35 && (themes.length === 0 || bestAfterVocab < THEME_LIVE_LOW);
  return {
    ok: true,
    method: "live_jev",
    label: "live TypeSafe Jev (noul)",
    model: typeof payload.model === "string" ? payload.model : null,
    confidence: Number(Math.max(topTheme, confidence, needsTitle ? newAns.noul : 0).toFixed(4)),
    lowConfidence: needsTitle ? true : lowConfidence,
    drift,
    needsTitle,
    themes,
    bestPriorTheme: Number(bestPriorTheme.toFixed(4)),
    noneScore: Number(noneAns.noul.toFixed(4)),
    newScore: Number(newAns.noul.toFixed(4)),
  };
}

function readGateScores() {
  if (typeof gateScores === "function") return gateScores;
  if (typeof module !== "undefined" && module.exports) return require("./theme-offer").gateScores;
  throw new Error("tag gate missing");
}

function buildThemeChips(result) {
  const chips = [];
  const seen = new Set();
  const chunk = result && typeof result.chunkText === "string" ? result.chunkText : "";
  const scored = [];
  for (const theme of (result && result.themes) || []) {
    if (!theme.label || seen.has(theme.label)) continue;
    const label = chunk ? safeThemeLabel(theme.label, chunk) : normalizeText(theme.label);
    if (!label || label === "기타" || label === "없음") continue;
    seen.add(label);
    scored.push({ id: theme.id, label, kind: "theme", score: theme.score });
  }
  const gate = readGateScores()(scored.map((chip) => (typeof chip.score === "number" ? chip.score : 0)));
  if (gate.disposition !== "quiet") {
    for (const chip of scored) {
      if (typeof chip.score === "number" && chip.score >= gate.topMin) chips.push(chip);
    }
  }
  if (result && result.drift) {
    chips.push({ id: "새메모", label: "새 메모로 열기", kind: "새메모", score: null });
  }
  return chips;
}

function pasteThemeLabel(text) {
  const vocab = matchFixedThemeVocab(text);
  if (vocab.label) return vocab.label;
  return "기타";
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
        label: pasteThemeLabel(block.text),
        cards: [{ id: block.id, text: block.text }],
      });
    }
  }
  return { themes, blockCount: blocks.length };
}

function buildThemeTitleBody(chunk, priorLabels) {
  const priors = (priorLabels || []).filter((label) => normalizeText(label));
  const vocab = THEME_VOCAB.map((entry) => entry.label).join(", ");
  return {
    model: OPENAI_MODEL,
    reasoning_effort: "none",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Invent a short theme title for a memo chunk. Reply with JSON " +
          '{"title":"<short theme title>","reason":"<short>"}. ' +
          "Title rules: noun phrase, about 2 to 8 Korean characters or a few words, not a sentence, " +
          "never copy the chunk word-for-word or its first few tokens. " +
          `Prefer reusing one of these when it fits: ${vocab}` +
          (priors.length ? `. Existing session themes: ${priors.join(", ")}.` : "."),
      },
      { role: "user", content: String(chunk || "") },
    ],
  };
}

function parseThemeTitleResponse(payload, chunk) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "OpenAI body is not a JSON object" };
  }
  const content =
    payload.choices && payload.choices[0] && payload.choices[0].message
      ? payload.choices[0].message.content
      : null;
  if (typeof content !== "string" || !content.trim()) {
    return { ok: false, error: "OpenAI body has no message content" };
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return { ok: false, error: "OpenAI content is not JSON" };
  }
  if (!parsed || typeof parsed.title !== "string") {
    return { ok: false, error: "OpenAI JSON has no title string" };
  }
  const title = safeThemeLabel(parsed.title, chunk);
  if (!title || title === "기타" || title === "없음") {
    return { ok: false, error: "OpenAI title is empty, too long, or a chunk fragment" };
  }
  return {
    ok: true,
    title,
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
    model: typeof payload.model === "string" ? payload.model : OPENAI_MODEL,
  };
}

function applyInventedThemeTitle(result, title, score) {
  if (!result || !title) return result;
  const next = { ...result, themes: [...(result.themes || [])] };
  const existing = next.themes.find((theme) => theme.label === title);
  const inventedScore = typeof score === "number" ? score : result.newScore || 0.55;
  if (existing) {
    existing.score = Number(Math.max(existing.score || 0, inventedScore).toFixed(4));
  } else {
    next.themes.push({
      id: "invented",
      label: title,
      score: Number(inventedScore.toFixed(4)),
    });
  }
  next.themes.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.id).localeCompare(String(b.id));
  });
  next.needsTitle = false;
  next.inventedLabelAfter = title;
  next.confidence = Number(Math.max(next.confidence || 0, inventedScore).toFixed(4));
  next.lowConfidence = next.confidence < (next.method === "live_jev" ? THEME_LIVE_LOW : THEME_HEURISTIC_LOW);
  next.labelSource = "openai_sol";
  return next;
}

function makeEvalEntry({ query, method, ranked, model, note }) {
  const rows = (ranked || []).map((row, index) => ({
    id: row.id,
    rank: typeof row.rank === "number" ? row.rank : index + 1,
    score: typeof row.score === "number" ? row.score : null,
    why: row.why || null,
    phraseHits: Array.isArray(row.phraseHits) ? row.phraseHits.slice() : [],
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
  chunkKey,
  model,
  inventedLabelBefore,
  inventedLabelAfter,
  needsTitle,
  labelSource,
  ratings,
  stickyLabel,
  splitKind,
  legacyWouldNudge,
  falsePositive,
  shouldNotSplit,
  tagGate,
  suggestion,
}) {
  const chunkText = String(chunk || "");
  return {
    kind: "theme_chunk",
    ts: new Date().toISOString(),
    chunk: chunkText,
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
    chunkKey: chunkKey || null,
    inventedLabelBefore:
      inventedLabelBefore == null ? null : String(inventedLabelBefore),
    inventedLabelAfter: inventedLabelAfter == null ? null : String(inventedLabelAfter),
    needsTitle: Boolean(needsTitle),
    labelSource: labelSource || null,
    ratings: ratings && typeof ratings === "object" ? ratings : {},
    stickyLabel: stickyLabel || null,
    splitKind: splitKind || "none",
    legacyWouldNudge: Boolean(legacyWouldNudge),
    falsePositive: Boolean(falsePositive),
    shouldNotSplit: shouldNotSplit === true ? true : null,
    phrases: scanPhrases(chunkText),
    tagGate: tagGate && typeof tagGate === "object" ? tagGate : null,
    suggestion: suggestion && typeof suggestion === "object" ? suggestion : null,
  };
}

function isChoiceId(key) {
  return typeof key === "string" && /^(parent|child|fallback|custom):/.test(key);
}

function canonicalRatings(ratings) {
  const next = {};
  const rows = Object.entries(ratings || {}).filter(
    ([, rating]) => rating && typeof rating === "object"
  );
  const idLabels = new Set();
  for (const [key, rating] of rows) {
    if (!isChoiceId(key)) continue;
    const label = normalizeText(rating.label);
    if (label) idLabels.add(label);
    next[key] = {
      verdict: rating.verdict === "yes" || rating.verdict === "no" ? rating.verdict : null,
      note: typeof rating.note === "string" ? rating.note : "",
      label,
    };
  }
  for (const [key, rating] of rows) {
    if (isChoiceId(key) || idLabels.has(key)) continue;
    next[key] = {
      verdict: rating.verdict === "yes" || rating.verdict === "no" ? rating.verdict : null,
      note: typeof rating.note === "string" ? rating.note : "",
      label: key,
    };
  }
  return next;
}

function rateChunkTag(entry, id, verdict, note, label) {
  if (!entry || entry.kind !== "theme_chunk") return entry;
  const cleanId = normalizeText(id);
  if (!cleanId) return entry;
  if (!entry.ratings || typeof entry.ratings !== "object") entry.ratings = {};
  const display = normalizeText(label);
  if (display && display !== cleanId) delete entry.ratings[display];
  const prev = entry.ratings[cleanId] || { verdict: null, note: "", label: display };
  const nextVerdict =
    verdict === "yes" || verdict === "no" || verdict === null ? verdict : prev.verdict;
  const nextNote = note === undefined ? prev.note || "" : String(note);
  entry.ratings[cleanId] = {
    verdict: nextVerdict,
    note: nextNote,
    label: display || prev.label || "",
  };
  if (nextVerdict === "yes") entry.chipChosen = entry.ratings[cleanId].label || cleanId;
  entry.ratedAt = new Date().toISOString();
  return entry;
}

function openThemeChunkEntry(entries, fields, touch) {
  const list = entries || [];
  const opts = touch || {};
  const padId = fields && fields.padId ? fields.padId : null;
  const chunkKey = fields && fields.chunkKey ? fields.chunkKey : null;
  let entry = null;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const row = list[i];
    if (row && row.kind === "theme_chunk" && row.padId === padId && row.chunkKey === chunkKey) {
      entry = row;
      break;
    }
  }
  if (!entry) {
    entry = makeThemeChunkEvalEntry(fields || {});
    entry.phrases = scanPhrases(entry.chunk);
    list.push(entry);
    return entry;
  }
  entry.chunk = String((fields && fields.chunk) || "");
  entry.phrases = scanPhrases(entry.chunk);
  entry.proposals = (fields && fields.proposals) || [];
  entry.activeChunkId = fields.activeChunkId || entry.activeChunkId;
  entry.ratings = fields.ratings && typeof fields.ratings === "object" ? fields.ratings : {};
  entry.stickyLabel = fields.stickyLabel || null;
  entry.chipChosen = fields.chipChosen == null ? null : fields.chipChosen;
  entry.splitKind = fields.splitKind || "none";
  entry.legacyWouldNudge = Boolean(fields.legacyWouldNudge);
  entry.falsePositive = Boolean(fields.falsePositive);
  entry.inventedLabelBefore = fields.inventedLabelBefore == null ? null : fields.inventedLabelBefore;
  entry.inventedLabelAfter = fields.inventedLabelAfter == null ? null : fields.inventedLabelAfter;
  entry.needsTitle = Boolean(fields.needsTitle);
  if (opts.touchConfidence) entry.confidence = fields.confidence;
  if (opts.touchMethod) entry.method = fields.method;
  if (opts.touchModel) entry.model = fields.model;
  if (fields.shouldNotSplit === true) entry.shouldNotSplit = true;
  if (opts.newMemoNudge === "yes" || opts.newMemoNudge === "no") entry.newMemoNudge = opts.newMemoNudge;
  if (fields.tagGate && typeof fields.tagGate === "object") entry.tagGate = fields.tagGate;
  if (fields.suggestion && typeof fields.suggestion === "object") entry.suggestion = fields.suggestion;
  return entry;
}

function setChunkShouldNotSplit(entry, value) {
  if (!entry || entry.kind !== "theme_chunk") return entry;
  entry.shouldNotSplit = value === true ? true : null;
  entry.ratedAt = new Date().toISOString();
  return entry;
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
    chunkMap: {},
    chunkSeq: 0,
  };
}

function stampPhrases(record) {
  record.phrases = scanPhrases(record.text);
  return record;
}

function emptyChunkRecord(key) {
  return {
    key,
    text: "",
    judgedText: "",
    proposals: [],
    ratings: {},
    phrases: [],
    stickyLabel: null,
    theme: typeof initialTheme === "function" ? initialTheme() : null,
    split: {
      kind: "none",
      legacyWouldNudge: false,
      falsePositive: false,
      shouldNotSplit: null,
    },
  };
}

function visibleChunkTags(record) {
  const tags = [];
  const seen = new Set();
  for (const chip of (record && record.proposals) || []) {
    if (!chip || !chip.label || chip.kind === "새메모" || seen.has(chip.label)) continue;
    seen.add(chip.label);
    tags.push(chip);
  }
  const pinned = [];
  if (record && record.stickyLabel) pinned.push(record.stickyLabel);
  for (const [key, rating] of Object.entries((record && record.ratings) || {})) {
    if (!rating || (!rating.verdict && !rating.note)) continue;
    if (isChoiceId(key) && rating.label) pinned.push(rating.label);
    else if (!isChoiceId(key)) pinned.push(normalizeText(rating.label) || key);
  }
  for (const label of pinned) {
    if (!label || seen.has(label)) continue;
    seen.add(label);
    tags.push({ id: `pin_${label}`, label, kind: "theme", score: null });
  }
  return tags;
}

function projectChunkBoard(pad, text) {
  const source = typeof text === "string" ? text : (pad && pad.text) || "";
  const blocks = splitBlocks(source).filter((block) => normalizeText(block.text));
  if (!pad.chunkMap || typeof pad.chunkMap !== "object") pad.chunkMap = {};
  if (typeof pad.chunkSeq !== "number") pad.chunkSeq = 0;
  const used = new Set();
  const rows = [];
  for (const block of blocks) {
    const norm = normalizeText(block.text);
    let key = null;
    let best = 0;
    for (const [candidate, rec] of Object.entries(pad.chunkMap)) {
      if (used.has(candidate) || !rec) continue;
      if (normalizeText(rec.text) === norm || normalizeText(rec.judgedText) === norm) {
        key = candidate;
        break;
      }
      const score = pairOverlap(rec.text || rec.judgedText || "", block.text);
      if (score >= 0.55 && score > best) {
        best = score;
        key = candidate;
      }
    }
    if (!key) {
      pad.chunkSeq += 1;
      key = `c${String(pad.chunkSeq).padStart(2, "0")}`;
      pad.chunkMap[key] = emptyChunkRecord(key);
    }
    used.add(key);
    pad.chunkMap[key].text = block.text;
    stampPhrases(pad.chunkMap[key]);
    rows.push({ key, block, record: pad.chunkMap[key] });
  }
  for (const key of Object.keys(pad.chunkMap)) {
    if (!used.has(key)) delete pad.chunkMap[key];
  }
  return rows;
}

function applyChunkJudgment(record, result) {
  if (!record) return record;
  const judgedText = result && typeof result.judgedText === "string" ? result.judgedText : record.text;
  const same = Boolean(record.judgedText) && normalizeText(record.judgedText) === normalizeText(judgedText);
  const previousFlag = record.split && record.split.shouldNotSplit === true;
  const chips = buildThemeChips({ ...(result || {}), drift: false, chunkText: judgedText });
  record.proposals = chips;
  const kind = result && result.splitKind
    ? result.splitKind
    : result && result.drift
      ? "nudge"
      : "none";
  record.split = {
    kind,
    legacyWouldNudge: Boolean(result && result.legacyWouldNudge),
    falsePositive: Boolean(result && result.falsePositive),
    shouldNotSplit: same ? (previousFlag ? true : null) : null,
  };
  if (normalizeText(record.text) === normalizeText(judgedText)) record.judgedText = record.text;
  return record;
}

function createPadSession(overrides) {
  const pad = createPad(overrides && overrides.pad);
  return { pads: [pad], activePadId: pad.id };
}

function beginNewMemoDraft(session, source) {
  if (!session || !source || !session.pads) return null;
  if (
    typeof source.chunkKey !== "string" ||
    typeof source.blockId !== "string" ||
    typeof source.text !== "string"
  ) {
    return null;
  }
  const pad = session.pads.find((item) => item.id === session.activePadId);
  if (!pad || !pad.chunkMap) return null;
  const record = pad.chunkMap[source.chunkKey];
  if (!record) return null;
  if (source.text !== record.text) return null;
  if (!normalizeText(record.text)) return null;
  return {
    kind: "new-memo-draft",
    sourcePadId: session.activePadId,
    sourceChunkKey: source.chunkKey,
    sourceBlockId: source.blockId,
    seedText: record.text,
    body: record.text,
    assignedThemeLabel: pad.assignedThemeLabel || record.stickyLabel || null,
    stickyLabel: record.stickyLabel || null,
    theme: record.theme ? JSON.parse(JSON.stringify(record.theme)) : null,
    ratings: canonicalRatings(record.ratings),
    proposals: Array.isArray(record.proposals) ? JSON.parse(JSON.stringify(record.proposals)) : [],
    split: record.split ? { ...record.split } : null,
  };
}

function exciseBlockText(text, blockId) {
  const kept = splitBlocks(text).filter((block) => block.id !== blockId && normalizeText(block.text));
  return kept.map((block) => String(block.text).replace(/^\s+|\s+$/g, "")).join("\n\n");
}

function copyChunkMap(chunkMap) {
  const next = {};
  for (const [key, record] of Object.entries(chunkMap || {})) next[key] = record;
  return next;
}

function commitNewMemoDraft(session, draft) {
  if (
    !session ||
    !session.pads ||
    !draft ||
    draft.kind !== "new-memo-draft" ||
    typeof draft.body !== "string" ||
    draft.consumed === true
  ) {
    return { ok: false, session };
  }
  const source = session.pads.find((item) => item.id === draft.sourcePadId);
  const sourceCopy = source
    ? {
        id: source.id,
        text: exciseBlockText(source.text, draft.sourceBlockId),
        caret: 0,
        assignedThemeLabel: source.assignedThemeLabel || null,
        chunkMap: copyChunkMap(source.chunkMap),
        chunkSeq: source.chunkSeq || 0,
      }
    : null;
  if (sourceCopy && draft.sourceChunkKey) delete sourceCopy.chunkMap[draft.sourceChunkKey];
  const pad = createPad({
    id: nextPadId(session.pads),
    text: draft.body,
    caret: draft.body.length,
    assignedThemeLabel: draft.assignedThemeLabel || null,
  });
  if (normalizeText(draft.body)) {
    const record = emptyChunkRecord("c01");
    record.text = draft.body;
    stampPhrases(record);
    record.stickyLabel = draft.stickyLabel || null;
    if (draft.theme) record.theme = draft.theme;
    record.ratings = canonicalRatings(draft.ratings);
    record.proposals = Array.isArray(draft.proposals) ? draft.proposals.slice() : [];
    record.split = {
      kind: "none",
      legacyWouldNudge: false,
      falsePositive: false,
      shouldNotSplit: null,
    };
    if (draft.body === draft.seedText) record.judgedText = draft.body;
    pad.chunkMap = { c01: record };
    pad.chunkSeq = 1;
  }
  const pads = session.pads.map((item) => (sourceCopy && item.id === sourceCopy.id ? sourceCopy : item));
  const next = {
    pads: pads.concat(pad),
    activePadId: pad.id,
  };
  draft.consumed = true;
  return { ok: true, session: next, padId: pad.id };
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
    label: pasteThemeLabel(card.text),
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
  OPENAI_CHAT_URL,
  OPENAI_MODEL,
  CORPUS_PATH,
  EXPECTED_COUNT,
  EXPECTED_IDS,
  LONG_MEMO_IDS,
  DEFAULT_RESULT_LIMIT,
  THEME_HEURISTIC_LOW,
  THEME_HEURISTIC_DRIFT,
  THEME_LIVE_LOW,
  THEME_VOCAB,
  RELATED_NOUL_INSTRUCTIONS,
  RELATED_NOUL_CRITERIA,
  isLongMemo,
  normalizeText,
  assertCorpus,
  tokenize,
  overlapScore,
  excludeSelf,
  extractPhrases: scanPhrases,
  rankHeuristic,
  buildRelatednessRequest,
  parseRelatednessAnswers,
  splitBlocks,
  countNonEmptyBlocks,
  activeChunkAt,
  isChunkPrefixLabel,
  matchFixedThemeVocab,
  safeThemeLabel,
  pairOverlap,
  proposeThemesHeuristic,
  classifyChunkSplit,
  normalizePriorThemes,
  buildThemeChunkRequest,
  parseThemeChunkAnswers,
  buildThemeChips,
  pasteThemeLabel,
  proposePasteStructure,
  buildThemeTitleBody,
  parseThemeTitleResponse,
  applyInventedThemeTitle,
  makeEvalEntry,
  makeThemeChunkEvalEntry,
  setThemeChunkChoice,
  rateChunkTag,
  setChunkShouldNotSplit,
  themeDriftFingerprint,
  nextPadId,
  createPad,
  createPadSession,
  emptyChunkRecord,
  stampPhrases,
  visibleChunkTags,
  projectChunkBoard,
  applyChunkJudgment,
  beginNewMemoDraft,
  commitNewMemoDraft,
  openThemeChunkEntry,
  canonicalRatings,
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
