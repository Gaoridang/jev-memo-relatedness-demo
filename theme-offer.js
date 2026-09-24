(function () {
const PARENTS = Object.freeze([
  Object.freeze({
    id: "work",
    label: "업무",
    keywords: Object.freeze(["업무", "프로젝트", "마감", "배포", "pr", "버그", "코드", "데모"]),
  }),
  Object.freeze({
    id: "life",
    label: "개인·생활",
    keywords: Object.freeze(["개인", "생활"]),
  }),
  Object.freeze({
    id: "event",
    label: "행사·협의",
    keywords: Object.freeze(["행사", "협의", "참석"]),
  }),
]);

const CHILDREN_BY_PARENT = Object.freeze({
  work: Object.freeze([
    Object.freeze({
      label: "미팅",
      keywords: Object.freeze(["미팅", "회의", "standup", "sync", "콜", "화상", "1:1", "인터뷰"]),
    }),
    Object.freeze({
      label: "공사품의",
      keywords: Object.freeze(["품의", "공사", "견적"]),
    }),
    Object.freeze({
      label: "연락처",
      keywords: Object.freeze(["연락처", "전화번호", "명함"]),
    }),
  ]),
  life: Object.freeze([
    Object.freeze({
      label: "집안일",
      keywords: Object.freeze(["빨래", "세탁", "건조기", "세탁기", "청소", "설거지", "분리수거", "쓰레기", "걸레", "수건"]),
    }),
    Object.freeze({
      label: "식사",
      keywords: Object.freeze(["밥", "점심", "저녁", "아침", "김밥", "삼각김밥", "우유", "맛집", "배달"]),
    }),
    Object.freeze({
      label: "카페",
      keywords: Object.freeze(["카페", "스타벅스"]),
    }),
    Object.freeze({
      label: "차량",
      keywords: Object.freeze(["엔진오일", "자동차", "주차", "타이어", "정비", "공임", "주유", "세차"]),
    }),
    Object.freeze({
      label: "운동",
      keywords: Object.freeze(["운동", "헬스", "러닝", "조깅", "헬스장", "스트레칭", "땀"]),
    }),
    Object.freeze({
      label: "쇼핑",
      keywords: Object.freeze(["쇼핑", "구매", "주문", "쿠팡", "배송", "장보기", "할인"]),
    }),
    Object.freeze({
      label: "건강",
      keywords: Object.freeze(["병원", "약", "아프", "통증", "수면", "피곤", "검진"]),
    }),
    Object.freeze({
      label: "금융",
      keywords: Object.freeze(["카드", "결제", "이체", "급여", "예산", "통장", "세금"]),
    }),
  ]),
  event: Object.freeze([
    Object.freeze({
      label: "숙박·식비",
      keywords: Object.freeze(["숙박", "식비", "호텔", "식사비"]),
    }),
    Object.freeze({
      label: "여행",
      keywords: Object.freeze(["여행", "숙박", "호텔", "케이블카", "항공", "기차", "관광", "금오산"]),
      parents: Object.freeze(["event", "work"]),
    }),
  ]),
});

const PARENT_IDS = Object.freeze(PARENTS.map((parent) => parent.id));

const CHILD_KEYWORD_INDEX = new Map();
for (const parentId of PARENT_IDS) {
  for (const child of CHILDREN_BY_PARENT[parentId]) {
    for (const keyword of child.keywords) {
      const key = String(keyword).toLowerCase();
      const rows = CHILD_KEYWORD_INDEX.get(key) || [];
      if (!rows.some((row) => row.parentId === parentId && row.label === child.label)) {
        rows.push({ parentId, label: child.label });
      }
      CHILD_KEYWORD_INDEX.set(key, rows);
    }
  }
}

const PARENT_ASK_PROMPT = "어느 쪽으로 둘까요?";
const TAG_TOP = 0.54;
const TAG_MARGIN = 0.12;
const TAG_AUTO = 0.66;
const INPUT_BELOW = 0.4;
const CHALLENGER_OVERRIDE = 0.85;
const CHALLENGER_WINS = 2;
const DROP_BELOW = 0.3;
const FORCED_CHANGE_RATIO = 0.3;

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parentById(id) {
  return PARENTS.find((parent) => parent.id === id) || null;
}

function assertParentId(id) {
  if (!parentById(id)) throw new Error("unknown parent");
  return id;
}

function isParentLabel(label) {
  return PARENTS.some((parent) => parent.label === label);
}

function isJoinedDocCode(label) {
  const parts = String(label).split(/[^A-Za-z0-9]+/).filter(Boolean);
  let code = false;
  let num = false;
  for (const part of parts) {
    if (/^[A-Za-z]{1,6}\d{1,6}$/.test(part)) code = true;
    else if (/^[1-9]\d{2,4}$/.test(part)) num = true;
  }
  return code && num;
}

function vocabEntries() {
  const entries = [];
  for (const parentId of PARENT_IDS) {
    for (const child of CHILDREN_BY_PARENT[parentId]) {
      entries.push({ label: child.label, keywords: child.keywords.slice() });
    }
  }
  for (const parent of PARENTS) {
    entries.push({ label: parent.label, keywords: parent.keywords.slice() });
  }
  return entries;
}

function choiceKey(choice) {
  const parsed = parseChoice(choice);
  if (parsed.kind === "parent") return `parent:${parsed.id}`;
  if (parsed.kind === "child") return `child:${parsed.parentId}:${parsed.label}`;
  if (parsed.kind === "custom") return `custom:${parsed.label}`;
  return `fallback:${parsed.label}`;
}

function labelOfChoice(choice) {
  if (choice.kind === "parent") return parentById(choice.id).label;
  return choice.label;
}

function parseChoice(value) {
  if (!value || typeof value !== "object") throw new Error("choice required");
  if (value.kind === "parent") {
    return { kind: "parent", id: assertParentId(value.id) };
  }
  if (value.kind === "child") {
    const parentId = assertParentId(value.parentId);
    const label = normalizeText(value.label);
    if (!label) throw new Error("child label required");
    if (isParentLabel(label) || label === "기타" || label === "없음") {
      throw new Error("child label is reserved");
    }
    return { kind: "child", parentId, label };
  }
  if (value.kind === "fallback") {
    if (value.label !== "기타" && value.label !== "없음") throw new Error("fallback label required");
    return { kind: "fallback", label: value.label };
  }
  if (value.kind === "custom") {
    const label = normalizeText(value.label);
    if (!label || label.length > 24) throw new Error("custom label required");
    if (isParentLabel(label) || label === "기타" || label === "없음") {
      throw new Error("custom label is reserved");
    }
    return { kind: "custom", label };
  }
  throw new Error("unknown choice");
}

function parentMenuOffer(ranked) {
  if (!Array.isArray(ranked) || ranked.length !== 3) throw new Error("parent menu needs three ids");
  const seen = new Set(ranked);
  if (seen.size !== 3 || PARENT_IDS.some((id) => !seen.has(id))) {
    throw new Error("parent menu must list each parent once");
  }
  return { kind: "parent-menu", order: [ranked[0], ranked[1], ranked[2]] };
}

function childrenOffer(parentId, childLabels) {
  const id = assertParentId(parentId);
  if (!Array.isArray(childLabels) || childLabels.length < 1) throw new Error("children required");
  const labels = [];
  const seen = new Set();
  for (const raw of childLabels) {
    const label = normalizeText(raw);
    if (!label || label.length > 24) throw new Error("unsafe child label");
    if (isParentLabel(label) || label === "기타" || label === "없음") {
      throw new Error("unsafe child label");
    }
    if (isJoinedDocCode(label)) throw new Error("joined doc code");
    if (seen.has(label)) throw new Error("duplicate child label");
    seen.add(label);
    labels.push(label);
  }
  return { kind: "children", parentId: id, childLabels: labels };
}

function askOffer(prompt, options) {
  const text = typeof prompt === "string" ? prompt.trim() : "";
  if (!text) throw new Error("ask prompt required");
  if (!Array.isArray(options) || options.length < 2) throw new Error("ask needs two options");
  const built = [];
  const seen = new Set();
  for (const option of options) {
    if (!option || typeof option !== "object") throw new Error("ask option required");
    const choice = parseChoice(option.choice);
    const key = choiceKey(choice);
    if (seen.has(key)) throw new Error("duplicate ask choice");
    seen.add(key);
    built.push({ id: String(option.id), choice });
  }
  return { kind: "ask", prompt: text, options: built };
}

function fallbackOffer() {
  return { kind: "fallback" };
}

function quietOffer() {
  return { kind: "quiet" };
}

function parentOneOffer(id) {
  return { kind: "parent-one", id: assertParentId(id) };
}

function customOffer(label) {
  const choice = parseChoice({ kind: "custom", label });
  return { kind: "custom", label: choice.label };
}

function parseOffer(value) {
  if (!value || typeof value !== "object") throw new Error("offer required");
  if (value.kind === "parent-menu") return parentMenuOffer(value.order);
  if (value.kind === "parent-one") return parentOneOffer(value.id);
  if (value.kind === "children") return childrenOffer(value.parentId, value.childLabels);
  if (value.kind === "ask") return askOffer(value.prompt, value.options);
  if (value.kind === "fallback") return fallbackOffer();
  if (value.kind === "quiet") return quietOffer();
  if (value.kind === "custom") return customOffer(value.label);
  throw new Error("unknown offer");
}

function openTheme(offer) {
  return { phase: "open", offer: parseOffer(offer) };
}

function initialTheme() {
  return openTheme(quietOffer());
}

function parseTheme(value) {
  if (!value || typeof value !== "object") throw new Error("theme required");
  if ("stickyLabel" in value || "inventedLabelAfter" in value || "inventedLabel" in value) {
    throw new Error("theme carries a label field");
  }
  if (value.phase === "open") {
    if ("choice" in value) throw new Error("open theme has no choice");
    return openTheme(value.offer);
  }
  if (value.phase === "committed") {
    const choice = parseChoice(value.choice);
    const offer = parseOffer(value.offer);
    if (offer.kind === "ask") throw new Error("committed theme cannot ask");
    const theme = { phase: "committed", choice, offer };
    if (value.forced === true) {
      theme.forced = true;
      theme.forcedText = typeof value.forcedText === "string" ? value.forcedText : "";
    }
    if (
      value.challenger &&
      typeof value.challenger.key === "string" &&
      Number.isInteger(value.challenger.wins) &&
      value.challenger.wins > 0
    ) {
      theme.challenger = { key: value.challenger.key, wins: value.challenger.wins };
    }
    return theme;
  }
  throw new Error("unknown phase");
}

function isLiveJudgment(judged) {
  return Boolean(
    judged &&
      judged.method === "live_jev" &&
      !judged.error &&
      judged.ok !== false &&
      Array.isArray(judged.themes)
  );
}

function emptyScoreTable() {
  const parentScores = {};
  const childScores = {};
  for (const parentId of PARENT_IDS) {
    parentScores[parentId] = 0;
    childScores[parentId] = new Map();
  }
  return { parentScores, childScores };
}

function catalogScoreTable(judged) {
  const table = emptyScoreTable();
  if (!isLiveJudgment(judged)) return table;
  for (const theme of judged.themes) {
    if (!theme || typeof theme.score !== "number" || !Number.isFinite(theme.score)) continue;
    const parent = PARENTS.find((item) => item.label === theme.label);
    if (parent) {
      table.parentScores[parent.id] = Math.max(table.parentScores[parent.id], theme.score);
    }
    for (const parentId of PARENT_IDS) {
      const child = CHILDREN_BY_PARENT[parentId].find((item) => item.label === theme.label);
      if (!child) continue;
      const prev = table.childScores[parentId].get(child.label) || 0;
      table.childScores[parentId].set(child.label, Math.max(prev, theme.score));
      table.parentScores[parentId] = Math.max(table.parentScores[parentId], theme.score);
    }
  }
  return table;
}

function childLabelsFromScores(parentId, table) {
  const labels = [];
  for (const child of CHILDREN_BY_PARENT[parentId]) {
    if (table.childScores[parentId].get(child.label)) labels.push(child.label);
  }
  return labels;
}

function rankParents(scores) {
  return PARENT_IDS.slice().sort((a, b) => {
    if (scores[b] !== scores[a]) return scores[b] - scores[a];
    return PARENT_IDS.indexOf(a) - PARENT_IDS.indexOf(b);
  });
}

function priorParentIds(priors) {
  const ids = [];
  for (const prior of priors || []) {
    const label = normalizeText(prior && prior.label);
    if (!label) continue;
    const parent = PARENTS.find((item) => item.label === label);
    if (parent) {
      ids.push(parent.id);
      continue;
    }
    for (const parentId of PARENT_IDS) {
      if (CHILDREN_BY_PARENT[parentId].some((child) => child.label === label)) {
        ids.push(parentId);
        break;
      }
    }
  }
  return ids;
}

function bestChildScore(table) {
  let best = null;
  for (const parentId of PARENT_IDS) {
    for (const child of CHILDREN_BY_PARENT[parentId]) {
      const score = table.childScores[parentId].get(child.label) || 0;
      if (!score) continue;
      const parents = child.parents ? child.parents.slice() : [parentId];
      if (!best || score > best.score) best = { parentId, label: child.label, score, parents };
    }
  }
  return best;
}

function parentAsk(topId, secondId) {
  return askOffer(PARENT_ASK_PROMPT, [
    { id: topId, choice: { kind: "parent", id: topId } },
    { id: secondId, choice: { kind: "parent", id: secondId } },
  ]);
}

function menuFirst(parentId) {
  return parentMenuOffer([parentId].concat(PARENT_IDS.filter((id) => id !== parentId)));
}

function childrenForChunk(parentId, judged) {
  return childLabelsFromScores(parentId, catalogScoreTable(judged));
}

function settleOffer(choice, chunkText, judged) {
  const parsed = parseChoice(choice);
  if (parsed.kind === "fallback") return fallbackOffer();
  if (parsed.kind === "custom") return customOffer(parsed.label);
  if (parsed.kind === "parent") {
    const labels = childrenForChunk(parsed.id, judged);
    if (labels.length) return childrenOffer(parsed.id, labels);
    return menuFirst(parsed.id);
  }
  const labels = childrenForChunk(parsed.parentId, judged);
  if (isCatalogChild(parsed.parentId, parsed.label) && !labels.includes(parsed.label)) {
    labels.push(parsed.label);
  }
  if (!labels.length) return menuFirst(parsed.parentId);
  return childrenOffer(parsed.parentId, labels);
}

function isCatalogChild(parentId, label) {
  const children = CHILDREN_BY_PARENT[parentId] || [];
  return children.some((child) => child.label === label);
}

function committedTheme(choice, chunkText, judged) {
  const parsed = parseChoice(choice);
  const offer = settleOffer(parsed, chunkText, judged);
  if (offer.kind === "ask") throw new Error("committed theme cannot ask");
  return { phase: "committed", choice: parsed, offer };
}

function gateScores(scores) {
  const ranked = (scores || [])
    .filter((score) => typeof score === "number" && Number.isFinite(score))
    .slice()
    .sort((a, b) => b - a);
  const top = ranked.length ? ranked[0] : 0;
  const second = ranked.length > 1 ? ranked[1] : 0;
  return gatePair(top, second);
}

function gatePair(top, second) {
  const hi = typeof top === "number" && Number.isFinite(top) ? top : 0;
  const lo = typeof second === "number" && Number.isFinite(second) ? second : 0;
  const margin = Number((hi - lo).toFixed(4));
  let disposition = "quiet";
  if (hi >= TAG_TOP && margin >= TAG_MARGIN) disposition = hi >= TAG_AUTO ? "auto" : "ready";
  else if (hi >= TAG_TOP && margin < TAG_MARGIN) disposition = "ask";
  return {
    disposition,
    top: Number(hi.toFixed(4)),
    second: Number(lo.toFixed(4)),
    margin,
    topMin: TAG_TOP,
    marginMin: TAG_MARGIN,
    autoMin: TAG_AUTO,
  };
}

function offerForWinner(table, topId, priors) {
  const best = bestChildScore(table);
  const priorHome = priorParentIds(priors).find(
    (id) => best && best.parents.includes(id) && id !== best.parentId
  );
  const parentId = best && priorHome ? priorHome : topId;
  const labels = childLabelsFromScores(parentId, table);
  if (best && priorHome && !labels.includes(best.label)) labels.push(best.label);
  if (labels.length) return childrenOffer(parentId, labels);
  return parentOneOffer(parentId);
}

function leadingChoice(offer, table) {
  if (!offer) return null;
  if (offer.kind === "parent-one") return { kind: "parent", id: offer.id };
  if (offer.kind !== "children") return null;
  let bestLabel = offer.childLabels[0];
  let bestScore = -1;
  for (const label of offer.childLabels) {
    const score = table.childScores[offer.parentId].get(label) || 0;
    if (score > bestScore) {
      bestScore = score;
      bestLabel = label;
    }
  }
  return { kind: "child", parentId: offer.parentId, label: bestLabel };
}

function classifyChunkTags(input) {
  const src = input || {};
  const text = normalizeText(src.chunkText);
  if (!text || /^\d+$/.test(text) || !isLiveJudgment(src.judged)) {
    return { ...gatePair(0, 0), offer: quietOffer(), choice: null, topId: null, secondId: null };
  }
  const table = catalogScoreTable(src.judged);
  const scores = table.parentScores;
  const ranked = rankParents(scores);
  const topId = ranked[0];
  const secondId = ranked[1];
  const gate = gatePair(scores[topId], scores[secondId]);
  if (gate.disposition === "quiet") {
    return { ...gate, offer: quietOffer(), choice: null, topId, secondId };
  }
  if (gate.disposition === "ask") {
    return { ...gate, offer: parentAsk(topId, secondId), choice: null, topId, secondId };
  }
  const offer = offerForWinner(table, topId, src.priors);
  return { ...gate, offer, choice: leadingChoice(offer, table), topId, secondId };
}

function decideOffer(input) {
  return classifyChunkTags(input).offer;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function changedSubstantially(from, to) {
  const len = Math.max(from.length, to.length, 1);
  return levenshtein(from, to) > FORCED_CHANGE_RATIO * len;
}

function choiceScore(choice, judged) {
  if (!choice || !isLiveJudgment(judged)) return 0;
  const label = labelOfChoice(choice);
  let score = 0;
  for (const theme of judged.themes) {
    if (!theme || theme.label !== label || typeof theme.score !== "number") continue;
    if (theme.score > score) score = theme.score;
  }
  return score;
}

function challengerKey(raw) {
  if (raw.choice) return choiceKey(raw.choice);
  if (raw.disposition === "ask") return `ask:${raw.topId}:${raw.secondId}`;
  return `disp:${raw.disposition}`;
}

function markPromoted(choice, text, judged) {
  const theme = committedTheme(choice, text, judged);
  theme.forced = false;
  theme.forcedText = null;
  theme.challenger = null;
  return theme;
}

function markForced(theme, text) {
  theme.forced = true;
  theme.forcedText = normalizeText(text);
  theme.challenger = null;
  return theme;
}

function packDecision(raw, memory, chrome, extra) {
  const flags = extra || {};
  return {
    disposition: raw.disposition,
    top: raw.top,
    second: raw.second,
    margin: raw.margin,
    topMin: raw.topMin,
    marginMin: raw.marginMin,
    autoMin: raw.autoMin,
    choice: flags.choice === undefined ? raw.choice : flags.choice,
    forced: flags.forced === true,
    applied: flags.applied === true,
    commitEligible: flags.commitEligible === true,
    memory,
    chrome,
  };
}

function adoptRaw(raw, text, src) {
  if (raw.disposition === "auto" && raw.choice && !(src && src.held)) {
    const memory = markPromoted(raw.choice, text, src && src.judged);
    return packDecision(raw, memory, memory, {
      forced: false,
      applied: true,
      choice: raw.choice,
      commitEligible: false,
    });
  }
  const chrome = openTheme(raw.offer);
  const eligible = (raw.disposition === "ready" || raw.disposition === "auto") && !!raw.choice;
  return packDecision(raw, chrome, chrome, {
    forced: false,
    applied: false,
    choice: raw.choice,
    commitEligible: eligible,
  });
}

function decideCommitted(current, raw, text, src) {
  const currentP = choiceScore(current.choice, src && src.judged);
  const topConf = raw.top;
  const same = raw.choice && choiceKey(raw.choice) === choiceKey(current.choice);
  if (same && (raw.disposition === "auto" || raw.disposition === "ready")) {
    const memory = { phase: current.phase, choice: current.choice, offer: current.offer, forced: false, forcedText: null, challenger: null };
    return packDecision(raw, memory, memory, {
      forced: false,
      applied: true,
      choice: current.choice,
      commitEligible: false,
    });
  }
  if (topConf >= CHALLENGER_OVERRIDE) return adoptRaw(raw, text, src);
  if (raw.disposition === "quiet") {
    if (currentP < DROP_BELOW) {
      const memory = openTheme(raw.offer);
      return packDecision(raw, memory, memory, {
        forced: false,
        applied: false,
        choice: null,
        commitEligible: false,
      });
    }
    const memory = {
      phase: current.phase,
      choice: current.choice,
      offer: current.offer,
      forced: false,
      forcedText: null,
      challenger: null,
    };
    const chrome = openTheme(raw.offer);
    return packDecision(raw, memory, chrome, {
      forced: false,
      applied: false,
      choice: null,
      commitEligible: false,
    });
  }
  const key = challengerKey(raw);
  const wins = current.challenger && current.challenger.key === key ? current.challenger.wins + 1 : 1;
  if (wins >= CHALLENGER_WINS && topConf >= INPUT_BELOW) return adoptRaw(raw, text, src);
  const memory = {
    phase: current.phase,
    choice: current.choice,
    offer: current.offer,
    forced: false,
    forcedText: null,
    challenger: { key, wins },
  };
  if (raw.disposition === "ask") {
    const chrome = openTheme(raw.offer);
    return packDecision(raw, memory, chrome, {
      forced: false,
      applied: false,
      choice: null,
      commitEligible: false,
    });
  }
  return packDecision(raw, memory, memory, {
    forced: false,
    applied: true,
    choice: current.choice,
    commitEligible: false,
  });
}

function decide(theme, input) {
  const src = input || {};
  const text = normalizeText(src.chunkText);
  const raw = classifyChunkTags(src);
  if (!text) {
    const memory = initialTheme();
    return packDecision(raw, memory, memory, {
      forced: false,
      applied: false,
      choice: null,
      commitEligible: false,
    });
  }
  let current = parseTheme(theme);
  if (current.phase === "committed" && current.forced) {
    const from = typeof current.forcedText === "string" ? current.forcedText : text;
    if (!changedSubstantially(from, text)) {
      return packDecision(raw, current, current, {
        forced: true,
        applied: true,
        choice: current.choice,
        commitEligible: false,
      });
    }
    current = {
      phase: current.phase,
      choice: current.choice,
      offer: current.offer,
      forced: false,
      forcedText: null,
      challenger: null,
    };
  }
  if (current.phase === "committed") return decideCommitted(current, raw, text, src);
  return adoptRaw(raw, text, src);
}

function captionState(decision) {
  if (!decision) return "보류";
  if (decision.forced || decision.applied) return "적용됨";
  if (decision.disposition === "ask") return "질문";
  if (decision.disposition === "ready" || decision.disposition === "auto") return "적용 준비";
  return "보류";
}

function gateCaption(decision) {
  const gate = decision || {};
  const topMin = typeof gate.topMin === "number" ? gate.topMin : TAG_TOP;
  const marginMin = typeof gate.marginMin === "number" ? gate.marginMin : TAG_MARGIN;
  const autoMin = typeof gate.autoMin === "number" ? gate.autoMin : TAG_AUTO;
  const top = typeof gate.top === "number" ? gate.top : 0;
  const margin = typeof gate.margin === "number" ? gate.margin : 0;
  return `태그 기준 top ≥ ${topMin.toFixed(2)}, margin ≥ ${marginMin.toFixed(2)}, auto ≥ ${autoMin.toFixed(2)} · 이번 top ${top.toFixed(2)}, margin ${margin.toFixed(2)} · ${captionState(gate)}`;
}

function proposeTheme(theme, input) {
  return decide(theme, input).memory;
}

function offerContains(theme, choice) {
  const key = choiceKey(choice);
  const offer = theme.offer;
  if (offer.kind === "parent-menu") {
    return offer.order.some((id) => choiceKey({ kind: "parent", id }) === key);
  }
  if (offer.kind === "children") {
    return offer.childLabels.some(
      (label) => choiceKey({ kind: "child", parentId: offer.parentId, label }) === key
    );
  }
  if (offer.kind === "ask") {
    return offer.options.some((option) => choiceKey(option.choice) === key);
  }
  if (offer.kind === "fallback") {
    return choice.kind === "fallback";
  }
  if (offer.kind === "parent-one") {
    return choiceKey({ kind: "parent", id: offer.id }) === key;
  }
  if (offer.kind === "custom") {
    return choice.kind === "custom" && choice.label === offer.label;
  }
  if (offer.kind === "quiet") return false;
  return false;
}

function commitCustom(label, chunkText) {
  const choice = parseChoice({ kind: "custom", label });
  return markForced(committedTheme(choice, chunkText), chunkText);
}

function commitPick(theme, pick, chunkText) {
  const current = parseTheme(theme);
  const choice = parseChoice(pick);
  if (!offerContains(current, choice)) throw new Error("pick is outside the offer");
  return markForced(committedTheme(choice, chunkText), chunkText);
}

function openParentMenu(theme) {
  parseTheme(theme);
  return openTheme(parentMenuOffer(PARENT_IDS.slice()));
}

function choiceLabel(theme) {
  const parsed = parseTheme(theme);
  if (parsed.phase === "open") return null;
  return labelOfChoice(parsed.choice);
}

function chipForChoice(choice, role) {
  const parsed = parseChoice(choice);
  return {
    key: choiceKey(parsed),
    label: labelOfChoice(parsed),
    choice: parsed,
    role,
    score: null,
  };
}

function themeView(theme) {
  const parsed = parseTheme(theme);
  const highlightedKey = parsed.phase === "committed" ? choiceKey(parsed.choice) : null;
  const offer = parsed.offer;
  if (offer.kind === "parent-menu") {
    return {
      kind: "parent-menu",
      prompt: null,
      heading: null,
      headingKey: null,
      chips: offer.order.map((id) => chipForChoice({ kind: "parent", id }, "parent")),
      highlightedKey,
      canOpenParentMenu: false,
    };
  }
  if (offer.kind === "children") {
    return {
      kind: "children",
      prompt: null,
      heading: parentById(offer.parentId).label,
      headingKey: choiceKey({ kind: "parent", id: offer.parentId }),
      chips: offer.childLabels.map((label) =>
        chipForChoice({ kind: "child", parentId: offer.parentId, label }, "child")
      ),
      highlightedKey,
      canOpenParentMenu: true,
    };
  }
  if (offer.kind === "ask") {
    return {
      kind: "ask",
      prompt: offer.prompt,
      heading: null,
      headingKey: null,
      chips: offer.options.map((option) => chipForChoice(option.choice, option.choice.kind)),
      highlightedKey,
      canOpenParentMenu: false,
    };
  }
  if (offer.kind === "fallback") {
    return {
      kind: "fallback",
      prompt: null,
      heading: null,
      headingKey: null,
      chips: ["기타", "없음"].map((label) => chipForChoice({ kind: "fallback", label }, "fallback")),
      highlightedKey,
      canOpenParentMenu: false,
    };
  }
  if (offer.kind === "parent-one") {
    return {
      kind: "parent-one",
      prompt: null,
      heading: null,
      headingKey: null,
      chips: [chipForChoice({ kind: "parent", id: offer.id }, "parent")],
      highlightedKey,
      canOpenParentMenu: false,
    };
  }
  if (offer.kind === "custom") {
    return {
      kind: "custom",
      prompt: null,
      heading: null,
      headingKey: null,
      chips: [chipForChoice({ kind: "custom", label: offer.label }, "custom")],
      highlightedKey,
      canOpenParentMenu: false,
    };
  }
  if (offer.kind === "quiet") {
    return {
      kind: "quiet",
      prompt: null,
      heading: null,
      headingKey: null,
      chips: [],
      highlightedKey,
      canOpenParentMenu: false,
    };
  }
  throw new Error("unknown offer");
}

function projectThemeLog(record) {
  const theme = parseTheme(record && record.theme);
  const view = themeView(theme);
  const label = choiceLabel(theme);
  const proposals = view.chips.map((chip) => ({
    id: chip.key,
    label: chip.label,
    kind: chip.role,
    score: chip.score,
  }));
  const split = (record && record.split) || {};
  if (split.kind === "nudge" && split.shouldNotSplit !== true) {
    proposals.push({ id: "새메모", label: "새 메모로 열기", kind: "새메모", score: null });
  }
  return {
    proposals,
    chipChosen: label,
    stickyLabel: label,
    inventedLabelAfter: label,
    inventedLabelBefore: null,
    needsTitle: false,
    askPrompt: view.prompt,
  };
}

function themeFromLegacy(legacy) {
  const label = legacy && typeof legacy.stickyLabel === "string" ? normalizeText(legacy.stickyLabel) : "";
  const text = legacy && typeof legacy.text === "string" ? legacy.text : "";
  if (!label) return initialTheme();
  if (label === "없음" || label === "기타") {
    return committedTheme({ kind: "fallback", label }, text);
  }
  const parent = PARENTS.find((item) => item.label === label);
  if (parent) return committedTheme({ kind: "parent", id: parent.id }, text);
  for (const parentId of PARENT_IDS) {
    const child = CHILDREN_BY_PARENT[parentId].find((item) => item.label === label);
    if (child) return committedTheme({ kind: "child", parentId, label: child.label }, text);
  }
  return initialTheme();
}

const exported = {
  PARENTS,
  CHILDREN_BY_PARENT,
  CHILD_KEYWORD_INDEX,
  vocabEntries,
  initialTheme,
  openTheme,
  committedTheme,
  parseTheme,
  parseChoice,
  parentMenuOffer,
  childrenOffer,
  askOffer,
  fallbackOffer,
  TAG_TOP,
  TAG_MARGIN,
  TAG_AUTO,
  gateScores,
  classifyChunkTags,
  decide,
  gateCaption,
  captionState,
  decideOffer,
  quietOffer,
  commitCustom,
  proposeTheme,
  commitPick,
  openParentMenu,
  settleOffer,
  choiceLabel,
  choiceKey,
  themeView,
  projectThemeLog,
  themeFromLegacy,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = exported;
}
if (typeof globalThis !== "undefined") {
  Object.assign(globalThis, exported);
}
})();
