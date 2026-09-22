const LS_JEV = "jev_api_key";
const LS_OPENAI = "openai_api_key";
const LS_EVAL = "memoRelatednessEvalLog";
const THEME_DEBOUNCE_MS = 350;

const els = {
  jevKey: document.getElementById("jevKey"),
  openaiKey: document.getElementById("openaiKey"),
  keyStatus: document.getElementById("keyStatus"),
  pathStatus: document.getElementById("pathStatus"),
  saveKeysBtn: document.getElementById("saveKeysBtn"),
  clearKeysBtn: document.getElementById("clearKeysBtn"),
  padTabs: document.getElementById("padTabs"),
  query: document.getElementById("query"),
  editorHighlight: document.getElementById("editorHighlight"),
  chunkRows: document.getElementById("chunkRows"),
  themeMeta: document.getElementById("themeMeta"),
  findBtn: document.getElementById("findBtn"),
  clearQueryBtn: document.getElementById("clearQueryBtn"),
  addPadBtn: document.getElementById("addPadBtn"),
  methodBadge: document.getElementById("methodBadge"),
  resultMeta: document.getElementById("resultMeta"),
  results: document.getElementById("results"),
  showAllBtn: document.getElementById("showAllBtn"),
  note: document.getElementById("note"),
  poolSearch: document.getElementById("poolSearch"),
  poolCount: document.getElementById("poolCount"),
  pool: document.getElementById("pool"),
  logList: document.getElementById("logList"),
  exportJsonBtn: document.getElementById("exportJsonBtn"),
  exportJsonlBtn: document.getElementById("exportJsonlBtn"),
  clearLogBtn: document.getElementById("clearLogBtn"),
  errorBox: document.getElementById("errorBox"),
  pasteFallback: document.getElementById("pasteFallback"),
  pasteThemes: document.getElementById("pasteThemes"),
  confirmPasteBtn: document.getElementById("confirmPasteBtn"),
  dismissPasteBtn: document.getElementById("dismissPasteBtn"),
};

let memos = [];
let serverStatus = { jevEnv: false, openaiEnv: false };
let currentRun = null;
let showAll = false;
let evalLog = loadEvalLog();
let session = createPadSession({ pad: { id: "p01", text: "" } });
let sessionThemePriors = [];
let themeTimer = null;
let themeSeq = 0;
let currentTheme = null;
let pendingPasteCount = 0;
let pasteState = null;

function loadEvalLog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_EVAL) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function persistEvalLog() {
  localStorage.setItem(LS_EVAL, JSON.stringify(evalLog));
}

function localJevKey() {
  return (localStorage.getItem(LS_JEV) || "").trim();
}

function localOpenAiKey() {
  return (localStorage.getItem(LS_OPENAI) || "").trim();
}

function livePath() {
  if (serverStatus.jevEnv) return { mode: "proxy" };
  if (localJevKey()) return { mode: "browser", key: localJevKey() };
  return { mode: "none" };
}

function llmPath() {
  if (serverStatus.openaiEnv) return { mode: "proxy" };
  if (localOpenAiKey()) return { mode: "browser", key: localOpenAiKey() };
  return { mode: "none" };
}

function activePad() {
  return session.pads.find((pad) => pad.id === session.activePadId) || session.pads[0];
}

function rememberSessionTheme(label, sample) {
  const clean = normalizeText(label);
  if (!clean || clean === "기타" || clean === "없음" || clean === "새 메모로 열기") return;
  if (sessionThemePriors.some((theme) => theme.label === clean)) return;
  sessionThemePriors.push({
    id: `session_${sessionThemePriors.length + 1}`,
    label: clean,
    sample: sample || "",
  });
}

function renderKeyStatus() {
  const parts = [];
  parts.push(localJevKey() ? "browser jev_api_key stored" : "no browser jev_api_key");
  parts.push(serverStatus.jevEnv ? "Vercel JEV_API_KEY present" : "Vercel JEV_API_KEY absent");
  parts.push(localOpenAiKey() ? "browser openai_api_key stored" : "no browser openai_api_key");
  parts.push(serverStatus.openaiEnv ? "Vercel OPENAI_API_KEY present" : "Vercel OPENAI_API_KEY absent");
  els.keyStatus.textContent = parts.join(" · ");
  const path = livePath();
  const llm = llmPath();
  const invent =
    llm.mode === "proxy"
      ? "New theme titles call /api/llm → OpenAI Chat Completions (gpt-5.6-sol)."
      : llm.mode === "browser"
        ? "New theme titles call OpenAI from the browser with openai_api_key (gpt-5.6-sol)."
        : "No OpenAI key. Unmatched themes stay 기타/없음 (no chunk-prefix invent).";
  if (path.mode === "proxy") {
    els.pathStatus.textContent =
      `Theme match via /api/jev → TypeSafe. ${invent}`;
  } else if (path.mode === "browser") {
    els.pathStatus.textContent =
      `Theme match via TypeSafe with jev_api_key. ${invent}`;
  } else {
    els.pathStatus.textContent =
      `No Jev key. Theme match uses labeled keyword/vocab baseline. ${invent}`;
  }
}

function showError(message) {
  els.errorBox.hidden = !message;
  els.errorBox.textContent = message || "";
}

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderPool() {
  const q = (els.poolSearch.value || "").trim().toLowerCase();
  const visible = memos.filter((memo) => {
    if (!q) return true;
    return memo.id.toLowerCase().includes(q) || memo.text.toLowerCase().includes(q);
  });
  els.poolCount.textContent = `${visible.length} / ${memos.length}`;
  els.pool.innerHTML = "";
  for (const memo of visible) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "memo-card";
    card.dataset.id = memo.id;
    const long = isLongMemo(memo.id) ? '<span class="pill long">long / multi-topic</span>' : "";
    card.innerHTML = `<div class="memo-head"><strong>${memo.id}</strong>${long}</div><p>${escapeHtml(memo.text)}</p>`;
    card.onclick = () => {
      const pad = activePad();
      pad.text = memo.text;
      pad.caret = memo.text.length;
      pad.assignedThemeLabel = null;
      pad.chunkMap = {};
      pad.chunkSeq = 0;
      loadPadIntoEditor();
      scheduleTheme();
    };
    els.pool.appendChild(card);
  }
}

function setBadge(method, extraClass) {
  if (method === "live_jev") {
    els.methodBadge.textContent = "live_jev";
    els.methodBadge.className = "badge ok";
  } else if (method === "heuristic") {
    els.methodBadge.textContent = "heuristic";
    els.methodBadge.className = "badge warn";
  } else if (method === "error") {
    els.methodBadge.textContent = "error";
    els.methodBadge.className = "badge bad";
  } else {
    els.methodBadge.textContent = extraClass || "idle";
    els.methodBadge.className = "badge";
  }
}

function renderResults() {
  els.results.innerHTML = "";
  if (!currentRun || !currentRun.ranked || !currentRun.ranked.length) {
    els.results.innerHTML = '<p class="empty">Paste a query or click a pool memo, then Find related.</p>';
    els.showAllBtn.hidden = true;
    return;
  }
  const rows = showAll ? currentRun.ranked : currentRun.ranked.slice(0, DEFAULT_RESULT_LIMIT);
  els.showAllBtn.hidden = currentRun.ranked.length <= DEFAULT_RESULT_LIMIT;
  els.showAllBtn.textContent = showAll
    ? `Show top ${DEFAULT_RESULT_LIMIT}`
    : `Show all ${currentRun.ranked.length}`;

  for (const row of rows) {
    const rating = currentRun.ratings ? currentRun.ratings[row.id] : null;
    const article = document.createElement("article");
    article.className = "result";
    const long = row.long ? '<span class="pill long">long / multi-topic</span>' : "";
    article.innerHTML = `
      <div class="result-top">
        <div>
          <strong>${row.id}</strong>
          <span class="rank">#${row.rank}</span>
          ${long}
        </div>
        <div class="score">${formatScore(row.score)} <span class="muted">${escapeHtml(row.why || "")}</span></div>
      </div>
      <p>${escapeHtml(row.text)}</p>
      <div class="rate">
        <span>Related?</span>
        <button type="button" data-rate="yes" class="${rating === "yes" ? "on yes" : ""}">Yes</button>
        <button type="button" data-rate="no" class="${rating === "no" ? "on no" : ""}">No</button>
      </div>
    `;
    article.querySelectorAll("[data-rate]").forEach((btn) => {
      btn.onclick = () => rateRow(row.id, btn.getAttribute("data-rate"));
    });
    els.results.appendChild(article);
  }
}

function formatScore(score) {
  if (typeof score !== "number") return "—";
  return score.toFixed(3);
}

function formatTagRatings(ratings) {
  const parts = [];
  for (const [label, rating] of Object.entries(ratings || {})) {
    if (!rating || (!rating.verdict && !rating.note)) continue;
    const note = rating.note ? ` "${rating.note}"` : "";
    parts.push(`${label} ${rating.verdict || "note"}${note}`);
  }
  return parts.length ? ` · ${parts.join(", ")}` : "";
}

function renderLog() {
  els.logList.innerHTML = "";
  if (!evalLog.length) {
    els.logList.innerHTML = '<p class="empty">No eval rows yet. Theme proposes, chip choices, and Find related persist in localStorage.</p>';
    return;
  }
  const latest = [...evalLog].reverse();
  for (const entry of latest) {
    const item = document.createElement("div");
    item.className = "log-item";
    const kind = entry.kind || "related_run";
    if (kind === "theme_chunk") {
      item.innerHTML = `
        <div class="log-head">
          <span class="badge">${escapeHtml(kind)}</span>
          <strong>${escapeHtml(entry.method || "")}</strong>
          <span>${escapeHtml(entry.ts)}</span>
        </div>
        <p>${escapeHtml(entry.chunk || "")}</p>
          <div class="muted">confidence ${entry.confidence == null ? "—" : entry.confidence} · chip ${escapeHtml(String(entry.chipChosen))} · split ${escapeHtml(String(entry.splitKind || entry.newMemoNudge))} · shouldNotSplit ${escapeHtml(String(entry.shouldNotSplit))} · pad ${escapeHtml(String(entry.padId))} · ${escapeHtml(String(entry.chunkKey || entry.activeChunkId))}${escapeHtml(formatTagRatings(entry.ratings))}</div>
      `;
    } else {
      const yes = Object.values(entry.ratings || {}).filter((v) => v === "yes").length;
      const no = Object.values(entry.ratings || {}).filter((v) => v === "no").length;
      item.innerHTML = `
        <div class="log-head">
          <span class="badge">${escapeHtml(kind)}</span>
          <strong>${escapeHtml(entry.method)}</strong>
          <span>${escapeHtml(entry.ts)}</span>
        </div>
        <p>${escapeHtml(entry.query)}</p>
        <div class="muted">suggestions ${(entry.ranked || []).length} · Yes ${yes} · No ${no}${entry.note ? ` · note: ${escapeHtml(entry.note)}` : ""}</div>
      `;
    }
    els.logList.appendChild(item);
  }
}

function rateRow(id, rating) {
  if (!currentRun) return;
  currentRun.ratings[id] = rating;
  const lastRelated = [...evalLog].reverse().find((row) => (row.kind || "related_run") === "related_run");
  if (lastRelated) {
    setEvalRating(lastRelated, id, rating);
    persistEvalLog();
  }
  renderResults();
  renderLog();
}

function persistNote() {
  if (!currentRun) return;
  currentRun.note = els.note.value;
  const lastRelated = [...evalLog].reverse().find((row) => (row.kind || "related_run") === "related_run");
  if (lastRelated) {
    lastRelated.note = els.note.value;
    persistEvalLog();
  }
  renderLog();
}

function syncPadFromEditor() {
  const pad = activePad();
  pad.text = els.query.value;
  pad.caret = els.query.selectionStart || 0;
}

function loadPadIntoEditor() {
  const pad = activePad();
  currentTheme = null;
  els.query.value = pad.text;
  const caret = Math.min(pad.caret || pad.text.length, pad.text.length);
  els.query.setSelectionRange(caret, caret);
  renderPads();
  renderHighlight();
  renderChunkRows();
}

function renderPads() {
  els.padTabs.innerHTML = "";
  for (const pad of session.pads) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = pad.assignedThemeLabel
      ? `${pad.id} · ${pad.assignedThemeLabel}`
      : pad.id;
    if (pad.id === session.activePadId) btn.classList.add("on");
    btn.onclick = () => {
      syncPadFromEditor();
      session.activePadId = pad.id;
      loadPadIntoEditor();
      scheduleTheme();
    };
    els.padTabs.appendChild(btn);
  }
}

function renderHighlight() {
  const text = els.query.value;
  const caret = els.query.selectionStart || 0;
  const loc = activeChunkAt(text, caret);
  const active = loc.active;
  const before = escapeHtml(text.slice(0, active.start));
  const mid = escapeHtml(text.slice(active.start, active.end));
  const after = escapeHtml(text.slice(active.end));
  els.editorHighlight.innerHTML = `${before}<mark>${mid}</mark>${after}\n`;
  els.editorHighlight.scrollTop = els.query.scrollTop;
  els.editorHighlight.scrollLeft = els.query.scrollLeft;
}

function collectPriorThemes(pad, earlier) {
  const themes = [];
  const seen = new Set();
  for (const prior of sessionThemePriors) {
    if (!prior.label || seen.has(prior.label)) continue;
    seen.add(prior.label);
    themes.push({
      id: prior.id || `session_${themes.length + 1}`,
      label: prior.label,
      sample: prior.sample || "",
    });
  }
  for (const other of session.pads) {
    if (other.id === pad.id) continue;
    if (!other.assignedThemeLabel || seen.has(other.assignedThemeLabel)) continue;
    seen.add(other.assignedThemeLabel);
    themes.push({
      id: `pad_${other.id}`,
      label: other.assignedThemeLabel,
      sample: other.text,
    });
  }
  if (pad.assignedThemeLabel && !seen.has(pad.assignedThemeLabel)) {
    themes.push({
      id: `self_${pad.id}`,
      label: pad.assignedThemeLabel,
      sample: earlier.join("\n"),
    });
  }
  return themes;
}

function priorLabels(priors) {
  return (priors || []).map((theme) => theme.label);
}

function findChunkEntry(padId, chunkKey) {
  return [...evalLog].reverse().find(
    (row) => row.kind === "theme_chunk" && row.padId === padId && row.chunkKey === chunkKey
  );
}

function upsertChunkLog(pad, record, result, extra) {
  const split = record.split || {};
  const fields = {
    chunk: record.text,
    proposals: visibleChunkTags(record),
    confidence: result ? result.confidence : null,
    method: result ? result.method : null,
    chipChosen: record.stickyLabel || null,
    newMemoNudge: extra && extra.newMemoNudge !== undefined ? extra.newMemoNudge : null,
    padId: pad.id,
    activeChunkId: extra && extra.blockId ? extra.blockId : record.key,
    chunkKey: record.key,
    model: result && result.model,
    inventedLabelBefore: result && result.inventedLabelBefore,
    inventedLabelAfter: result && result.inventedLabelAfter,
    needsTitle: result && result.needsTitle,
    labelSource: result && result.labelSource,
    ratings: record.ratings || {},
    stickyLabel: record.stickyLabel || null,
    splitKind: split.kind || "none",
    legacyWouldNudge: split.legacyWouldNudge,
    falsePositive: split.falsePositive,
    shouldNotSplit: split.shouldNotSplit === true ? true : null,
  };
  let entry = findChunkEntry(pad.id, record.key);
  if (!entry || entry.chunk !== record.text) {
    entry = makeThemeChunkEvalEntry(fields);
    evalLog.push(entry);
  } else {
    entry.proposals = fields.proposals;
    entry.confidence = fields.confidence;
    entry.method = fields.method;
    entry.model = fields.model;
    entry.chunk = fields.chunk;
    entry.activeChunkId = fields.activeChunkId;
    entry.inventedLabelBefore = fields.inventedLabelBefore || null;
    entry.inventedLabelAfter = fields.inventedLabelAfter || null;
    entry.needsTitle = Boolean(fields.needsTitle);
    entry.labelSource = fields.labelSource || null;
    entry.ratings = fields.ratings;
    entry.stickyLabel = fields.stickyLabel;
    entry.chipChosen = fields.chipChosen;
    entry.splitKind = fields.splitKind;
    entry.legacyWouldNudge = fields.legacyWouldNudge;
    entry.falsePositive = fields.falsePositive;
    if (fields.shouldNotSplit === true) entry.shouldNotSplit = true;
    if (fields.newMemoNudge === "yes" || fields.newMemoNudge === "no") {
      entry.newMemoNudge = fields.newMemoNudge;
    }
  }
  if (extra && extra.chipChosen !== undefined) {
    setThemeChunkChoice(entry, extra.chipChosen, extra.newMemoNudge);
    entry.chipChosen = extra.chipChosen;
    entry.stickyLabel = record.stickyLabel || null;
  }
  persistEvalLog();
  renderLog();
  return entry;
}

function rowTags(record) {
  const tags = visibleChunkTags(record);
  const split = record.split || {};
  if (split.kind === "nudge" && split.shouldNotSplit !== true) {
    tags.push({ id: "새메모", label: "새 메모로 열기", kind: "새메모", score: null });
  }
  return tags;
}

function renderChunkRows() {
  const pad = activePad();
  const caret = els.query.selectionStart || 0;
  const loc = activeChunkAt(pad.text, caret);
  const rows = projectChunkBoard(pad, pad.text);
  els.chunkRows.innerHTML = "";
  if (!rows.length) {
    els.chunkRows.innerHTML = '<p class="empty">문단이 생기면 각 문단 아래에 태그 칩이 붙습니다.</p>';
    return;
  }
  for (const row of rows) {
    const article = document.createElement("article");
    article.className = "chunk-row";
    if (row.block.id === loc.active.id) article.classList.add("active");
    const excerpt = document.createElement("p");
    excerpt.className = "chunk-excerpt";
    excerpt.textContent = row.block.text;
    excerpt.onclick = () => {
      els.query.focus();
      const pos = Math.min(row.block.end, els.query.value.length);
      els.query.setSelectionRange(pos, pos);
      syncPadFromEditor();
      renderHighlight();
      renderChunkRows();
    };
    article.appendChild(excerpt);
    const chips = document.createElement("div");
    chips.className = "theme-chips";
    const tags = rowTags(row.record);
    for (const chip of tags) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      if (chip.kind === "새메모") btn.classList.add("drift");
      if (chip.kind === "기타" || chip.kind === "없음") btn.classList.add("soft");
      if (row.record.stickyLabel && chip.label === row.record.stickyLabel) btn.classList.add("on");
      btn.textContent = chip.label;
      btn.onclick = () => onChunkChip(row.key, chip);
      chips.appendChild(btn);
    }
    article.appendChild(chips);
    for (const chip of tags) {
      if (chip.kind === "새메모") continue;
      const rating = (row.record.ratings && row.record.ratings[chip.label]) || {};
      const rate = document.createElement("div");
      rate.className = "rate";
      const name = document.createElement("span");
      name.textContent = chip.label;
      const yes = document.createElement("button");
      yes.type = "button";
      yes.textContent = "Yes";
      yes.className = rating.verdict === "yes" ? "on yes" : "";
      yes.onclick = () => rateChunk(row.key, chip.label, "yes");
      const no = document.createElement("button");
      no.type = "button";
      no.textContent = "No";
      no.className = rating.verdict === "no" ? "on no" : "";
      no.onclick = () => rateChunk(row.key, chip.label, "no");
      const note = document.createElement("input");
      note.className = "chunk-note";
      note.type = "text";
      note.placeholder = "optional note";
      note.value = rating.note || "";
      note.oninput = () => noteChunk(row.key, chip.label, note.value);
      rate.appendChild(name);
      rate.appendChild(yes);
      rate.appendChild(no);
      rate.appendChild(note);
      article.appendChild(rate);
    }
    const split = row.record.split || {};
    if (split.kind === "nudge" && split.shouldNotSplit !== true) {
      const bar = document.createElement("div");
      bar.className = "nudge-bar";
      const copy = document.createElement("span");
      copy.className = "meta";
      copy.textContent = "주제가 갈라진 것 같습니다. 새 메모로 나누는 편을 권합니다.";
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "primary";
      openBtn.textContent = "새 메모로 열기";
      openBtn.onclick = () => openNewMemo(row.key);
      const stayBtn = document.createElement("button");
      stayBtn.type = "button";
      stayBtn.className = "ghost";
      stayBtn.textContent = "같은 주제예요";
      stayBtn.onclick = () => markShouldNotSplit(row.key, true);
      bar.appendChild(copy);
      bar.appendChild(openBtn);
      bar.appendChild(stayBtn);
      article.appendChild(bar);
    } else if (split.kind === "candidate" || split.shouldNotSplit === true) {
      const flag = document.createElement("label");
      flag.className = "split-flag";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = split.shouldNotSplit === true;
      box.onchange = () => markShouldNotSplit(row.key, box.checked);
      flag.appendChild(box);
      flag.appendChild(document.createTextNode("같은 주제입니다. 나누지 말 것"));
      article.appendChild(flag);
    }
    els.chunkRows.appendChild(article);
  }
}

function chunkRecord(key) {
  const pad = activePad();
  projectChunkBoard(pad, pad.text);
  return pad.chunkMap[key] || null;
}

function onChunkChip(key, chip) {
  if (chip.kind === "새메모") {
    openNewMemo(key);
    return;
  }
  const pad = activePad();
  const record = chunkRecord(key);
  if (!record) return;
  const label = chip.kind === "없음" ? null : chip.label;
  record.stickyLabel = label;
  if (label) {
    pad.assignedThemeLabel = label;
    rememberSessionTheme(label, record.text);
  }
  upsertChunkLog(pad, record, currentTheme, { chipChosen: chip.label, blockId: key });
  renderPads();
  renderChunkRows();
}

function rateChunk(key, label, verdict) {
  const pad = activePad();
  const record = chunkRecord(key);
  if (!record) return;
  if (!record.ratings) record.ratings = {};
  const prev = record.ratings[label] || { verdict: null, note: "" };
  record.ratings[label] = { verdict, note: prev.note || "" };
  if (verdict === "yes") {
    record.stickyLabel = label;
    pad.assignedThemeLabel = label;
    rememberSessionTheme(label, record.text);
  }
  const entry = upsertChunkLog(pad, record, currentTheme, {
    chipChosen: verdict === "yes" ? label : record.stickyLabel,
    blockId: key,
  });
  rateChunkTag(entry, label, verdict, record.ratings[label].note);
  entry.stickyLabel = record.stickyLabel;
  persistEvalLog();
  renderPads();
  renderLog();
  renderChunkRows();
}

function noteChunk(key, label, note) {
  const pad = activePad();
  const record = chunkRecord(key);
  if (!record) return;
  if (!record.ratings) record.ratings = {};
  const prev = record.ratings[label] || { verdict: null, note: "" };
  record.ratings[label] = { verdict: prev.verdict || null, note };
  const entry = findChunkEntry(pad.id, key) || upsertChunkLog(pad, record, currentTheme, { blockId: key });
  rateChunkTag(entry, label, prev.verdict || null, note);
  persistEvalLog();
}

function markShouldNotSplit(key, value) {
  const pad = activePad();
  const record = chunkRecord(key);
  if (!record || !record.split) return;
  record.split.shouldNotSplit = value ? true : null;
  const entry = upsertChunkLog(pad, record, currentTheme, {
    newMemoNudge: value ? "no" : null,
    blockId: key,
  });
  setChunkShouldNotSplit(entry, value);
  persistEvalLog();
  renderLog();
  renderChunkRows();
}

function openNewMemo(key) {
  syncPadFromEditor();
  const pad = activePad();
  const rows = projectChunkBoard(pad, pad.text);
  const row = rows.find((item) => item.key === key);
  if (!row) return;
  pad.caret = row.block.start;
  upsertChunkLog(pad, row.record, currentTheme, {
    chipChosen: "새 메모로 열기",
    newMemoNudge: "yes",
    blockId: row.block.id,
  });
  moveActiveChunkToNewPad(session, row.block);
  loadPadIntoEditor();
  els.query.focus();
  scheduleTheme();
}

async function readJsonOrText(res) {
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (err) {
      json = null;
    }
  }
  return { text, json };
}

async function callLiveJev(query, candidates) {
  const path = livePath();
  if (path.mode === "none") return { called: false };
  const request = buildRelatednessRequest(query, candidates);
  let res;
  if (path.mode === "proxy") {
    res = await fetch("/api/jev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, candidates }),
    });
  } else {
    res = await fetch(SYSTEMONE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${path.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
  }
  const { text, json } = await readJsonOrText(res);
  if (!res.ok) {
    const detail = json ? JSON.stringify(json) : text;
    return {
      called: true,
      ok: false,
      error: `TypeSafe HTTP ${res.status}`,
      detail: detail || `HTTP ${res.status}`,
    };
  }
  if (!json) {
    return { called: true, ok: false, error: "TypeSafe response is not JSON", detail: text };
  }
  const parsed = parseRelatednessAnswers(json, candidates);
  if (!parsed.ok) {
    return { called: true, ok: false, error: parsed.error, detail: JSON.stringify(json, null, 2) };
  }
  return { called: true, ok: true, parsed, raw: json };
}

async function callLiveTheme(chunk, priorThemes) {
  const path = livePath();
  if (path.mode === "none") return { called: false };
  const request = buildThemeChunkRequest(chunk, priorThemes);
  let res;
  if (path.mode === "proxy") {
    res = await fetch("/api/jev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "theme_chunk", chunk, priorThemes }),
    });
  } else {
    res = await fetch(SYSTEMONE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${path.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
  }
  const { text, json } = await readJsonOrText(res);
  if (!res.ok) {
    const detail = json ? JSON.stringify(json) : text;
    return {
      called: true,
      ok: false,
      error: `TypeSafe HTTP ${res.status}`,
      detail: detail || `HTTP ${res.status}`,
    };
  }
  if (!json) {
    return { called: true, ok: false, error: "TypeSafe response is not JSON", detail: text };
  }
  const parsed = parseThemeChunkAnswers(json, priorThemes, chunk);
  if (!parsed.ok) {
    return { called: true, ok: false, error: parsed.error, detail: JSON.stringify(json, null, 2) };
  }
  return { called: true, ok: true, parsed, raw: json };
}

function scheduleTheme() {
  syncPadFromEditor();
  renderPads();
  renderHighlight();
  renderChunkRows();
  window.clearTimeout(themeTimer);
  themeTimer = window.setTimeout(() => {
    runThemePropose();
  }, THEME_DEBOUNCE_MS);
}

async function callInventThemeTitle(chunk, priorThemes) {
  const path = llmPath();
  if (path.mode === "none") return { called: false };
  const priorLabelsList = priorLabels(priorThemes);
  let res;
  if (path.mode === "proxy") {
    res = await fetch("/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunk, priorLabels: priorLabelsList }),
    });
  } else {
    res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${path.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildThemeTitleBody(chunk, priorLabelsList)),
    });
  }
  const { text, json } = await readJsonOrText(res);
  if (!res.ok) {
    const detail = json ? JSON.stringify(json) : text;
    return {
      called: true,
      ok: false,
      error: `OpenAI HTTP ${res.status}`,
      detail: detail || `HTTP ${res.status}`,
    };
  }
  if (!json) {
    return { called: true, ok: false, error: "OpenAI response is not JSON", detail: text };
  }
  const parsed = parseThemeTitleResponse(json, chunk);
  if (!parsed.ok) {
    return { called: true, ok: false, error: parsed.error, detail: JSON.stringify(json, null, 2) };
  }
  return { called: true, ok: true, parsed, raw: json };
}

async function maybeInventTitle(result, chunk, priors) {
  if (!result || !result.needsTitle) return result;
  const before = result.inventedLabelBefore || null;
  const path = llmPath();
  if (path.mode === "none") {
    return {
      ...result,
      inventedLabelBefore: before,
      inventedLabelAfter: null,
      labelSource: "none",
    };
  }
  els.themeMeta.textContent = "Inventing a short theme title (Sol)…";
  const live = await callInventThemeTitle(chunk.text, priors);
  if (!live.called || !live.ok) {
    if (live.called && live.error) {
      showError(`${live.error}\n${live.detail || ""}`);
    }
    return {
      ...result,
      inventedLabelBefore: before,
      inventedLabelAfter: null,
      labelSource: "openai_error",
      error: live.error || result.error,
    };
  }
  const next = applyInventedThemeTitle(result, live.parsed.title, result.newScore || 0.62);
  next.inventedLabelBefore = before;
  next.model = live.parsed.model || next.model;
  rememberSessionTheme(live.parsed.title, chunk.text);
  return next;
}

function withProductSplit(result, chunkText, earlier, priors) {
  const live = result && result.method === "live_jev"
    ? { newScore: result.newScore, bestPriorTheme: result.bestPriorTheme }
    : null;
  const split = classifyChunkSplit({
    chunkText,
    earlierTexts: earlier,
    priorThemes: priors,
    bestPriorMatch: typeof result.bestPriorMatch === "number" ? result.bestPriorMatch : 0,
    live,
  });
  return {
    ...result,
    drift: split.drift,
    splitKind: split.kind,
    legacyWouldNudge: split.legacyWouldNudge,
    falsePositive: split.falsePositive,
  };
}

async function judgeChunkText(text, priors, earlier) {
  const path = livePath();
  if (path.mode === "none") return proposeThemesHeuristic(text, priors, earlier);
  const live = await callLiveTheme(text, priors);
  if (!live.called) return proposeThemesHeuristic(text, priors, earlier);
  if (!live.ok) {
    showError(`${live.error}\n${live.detail || ""}`);
    return {
      method: "live_jev",
      label: "live TypeSafe Jev (noul)",
      confidence: 0,
      lowConfidence: true,
      drift: false,
      splitKind: "none",
      legacyWouldNudge: false,
      falsePositive: false,
      themes: [],
      needsTitle: false,
      error: live.error,
      newScore: 0,
      bestPriorTheme: 0,
    };
  }
  return live.parsed;
}

function paintThemeMeta(result) {
  if (!result) {
    els.themeMeta.textContent = "Theme judge idle.";
    return;
  }
  const conf = typeof result.confidence === "number" ? result.confidence.toFixed(3) : "—";
  const err = result.error ? ` · ${result.error}` : "";
  const invent = result.inventedLabelAfter
    ? ` · invented ${result.inventedLabelAfter}`
    : result.needsTitle
      ? " · awaiting short title"
      : "";
  const split = result.splitKind === "nudge"
    ? " · drift"
    : result.splitKind === "candidate"
      ? " · kept together"
      : "";
  els.themeMeta.textContent = `${result.label || result.method || "theme"} · confidence ${conf}${result.lowConfidence ? " · low confidence" : ""}${split}${invent}${err}`;
}

async function runThemePropose() {
  const pad = activePad();
  const rows = projectChunkBoard(pad, pad.text);
  if (!rows.length) {
    currentTheme = null;
    els.themeMeta.textContent = "Theme judge idle.";
    renderChunkRows();
    return;
  }
  const seq = (themeSeq += 1);
  try {
    for (const row of rows) {
      if (
        row.record.judgedText &&
        normalizeText(row.record.judgedText) === normalizeText(row.record.text)
      ) {
        continue;
      }
      const earlier = rows
        .filter((item) => item.block.index < row.block.index)
        .map((item) => item.block.text);
      const priors = collectPriorThemes(pad, earlier);
      els.themeMeta.textContent = "Scoring chunks…";
      let result = await judgeChunkText(row.block.text, priors, earlier);
      if (seq !== themeSeq) return;
      result = await maybeInventTitle(result, { text: row.block.text }, priors);
      if (seq !== themeSeq) return;
      if (!result.error) {
        result = withProductSplit(result, row.block.text, earlier, priors);
      }
      result.judgedText = row.block.text;
      for (const theme of result.themes || []) {
        if (theme.label) rememberSessionTheme(theme.label, row.block.text);
      }
      applyChunkJudgment(row.record, result);
      showError(result.error || "");
      currentTheme = result;
      upsertChunkLog(pad, row.record, result, { blockId: row.block.id });
      paintThemeMeta(result);
      renderChunkRows();
    }
  } catch (err) {
    if (seq !== themeSeq) return;
    const message = err && err.message ? err.message : String(err);
    showError(message);
    els.themeMeta.textContent = message;
  }
}

async function findRelated() {
  showError("");
  syncPadFromEditor();
  const query = activePad().text;
  if (!normalizeText(query)) {
    showError("Query memo is empty.");
    return;
  }
  const candidates = excludeSelf(query, memos);
  showAll = false;
  els.findBtn.disabled = true;
  els.methodBadge.textContent = "working";
  els.methodBadge.className = "badge";
  els.resultMeta.textContent = "Scoring the 41-memo pool…";
  try {
    const path = livePath();
    if (path.mode === "none") {
      const heuristic = rankHeuristic(query, memos);
      if (!heuristic.ok) {
        showError(heuristic.error);
        return;
      }
      commitRun(query, heuristic);
      return;
    }
    const live = await callLiveJev(query, candidates);
    if (!live.called) {
      const heuristic = rankHeuristic(query, memos);
      commitRun(query, heuristic);
      return;
    }
    if (!live.ok) {
      setBadge("error");
      els.resultMeta.textContent = live.error;
      showError(`${live.error}\n${live.detail || ""}`);
      currentRun = null;
      renderResults();
      return;
    }
    commitRun(query, live.parsed);
  } catch (err) {
    setBadge("error");
    const message = err && err.message ? err.message : String(err);
    showError(message);
    els.resultMeta.textContent = message;
    currentRun = null;
    renderResults();
  } finally {
    els.findBtn.disabled = false;
  }
}

function commitRun(query, result) {
  const entry = makeEvalEntry({
    query,
    method: result.method,
    ranked: result.ranked,
    model: result.model,
    note: els.note.value,
  });
  evalLog.push(entry);
  persistEvalLog();
  currentRun = {
    method: result.method,
    label: result.label,
    model: result.model || null,
    ranked: result.ranked,
    ratings: entry.ratings,
    note: entry.note,
  };
  setBadge(result.method);
  const modelBit = result.model ? ` · model ${result.model}` : "";
  els.resultMeta.textContent = `${result.label} · compared ${result.ranked.length} of ${memos.length} memos${modelBit}`;
  renderResults();
  renderLog();
}

function renderPasteThemes() {
  els.pasteThemes.innerHTML = "";
  if (!pasteState || !pasteState.themes.length) {
    els.pasteThemes.innerHTML = '<p class="empty">No blocks to split.</p>';
    return;
  }
  for (const theme of pasteState.themes) {
    const box = document.createElement("div");
    box.className = "paste-theme";
    const cards = document.createElement("div");
    cards.className = "cards";
    box.innerHTML = `<strong>${escapeHtml(theme.label)}</strong>`;
    for (const card of theme.cards) {
      const article = document.createElement("article");
      article.className = "theme-card";
      const others = pasteState.themes.filter((item) => item.id !== theme.id);
      const mergeTarget = theme.cards.find((item) => item.id !== card.id) ||
        (others[0] && others[0].cards[0]);
      const moveOpts = others
        .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`)
        .join("");
      article.innerHTML = `
        <p>${escapeHtml(card.text)}</p>
        <div class="row">
          <button type="button" data-act="merge" ${mergeTarget ? "" : "disabled"}>합치기</button>
          <button type="button" data-act="detach" ${theme.cards.length > 1 ? "" : "disabled"}>분리</button>
          ${
            others.length
              ? `<label class="muted">이동 <select data-act="move">${moveOpts}</select></label>`
              : ""
          }
        </div>
      `;
      const mergeBtn = article.querySelector("[data-act=merge]");
      if (mergeBtn && mergeTarget) {
        mergeBtn.onclick = () => {
          mergePasteCards(pasteState, card.id, mergeTarget.id);
          renderPasteThemes();
        };
      }
      const detachBtn = article.querySelector("[data-act=detach]");
      if (detachBtn) {
        detachBtn.onclick = () => {
          detachPasteCard(pasteState, card.id);
          renderPasteThemes();
        };
      }
      const moveSel = article.querySelector("[data-act=move]");
      if (moveSel) {
        moveSel.onchange = () => {
          movePasteCard(pasteState, card.id, moveSel.value);
          renderPasteThemes();
        };
      }
      cards.appendChild(article);
    }
    box.appendChild(cards);
    els.pasteThemes.appendChild(box);
  }
}

function showPasteFallback(text) {
  pasteState = proposePasteStructure(text);
  els.pasteFallback.hidden = false;
  els.pasteFallback.open = false;
  renderPasteThemes();
}

function confirmPaste() {
  if (!pasteState) return;
  const built = padsFromPasteStructure(pasteState, 1);
  if (!built.length) return;
  const current = activePad();
  current.text = built[0].text;
  current.caret = built[0].text.length;
  current.assignedThemeLabel = built[0].assignedThemeLabel;
  for (const extra of built.slice(1)) {
    session.pads.push(
      createPad({
        id: nextPadId(session.pads),
        text: extra.text,
        assignedThemeLabel: extra.assignedThemeLabel,
      })
    );
  }
  pasteState = null;
  els.pasteFallback.hidden = true;
  loadPadIntoEditor();
  scheduleTheme();
}

function dismissPaste() {
  pasteState = null;
  els.pasteFallback.hidden = true;
}

async function loadServerStatus() {
  try {
    const res = await fetch("/api/status", { method: "GET" });
    const data = await res.json();
    serverStatus = {
      jevEnv: Boolean(data && data.jevEnv),
      openaiEnv: Boolean(data && data.openaiEnv),
    };
  } catch (err) {
    serverStatus = { jevEnv: false, openaiEnv: false };
  }
  renderKeyStatus();
}

async function loadCorpus() {
  const res = await fetch(CORPUS_PATH, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load ${CORPUS_PATH}`);
  const data = await res.json();
  const checked = assertCorpus(data);
  if (!checked.ok) throw new Error(checked.error);
  memos = checked.memos;
  els.poolCount.textContent = `${memos.length} / ${memos.length}`;
  renderPool();
}

els.saveKeysBtn.onclick = () => {
  const jev = els.jevKey.value.trim();
  const openai = els.openaiKey.value.trim();
  if (jev) localStorage.setItem(LS_JEV, jev);
  else localStorage.removeItem(LS_JEV);
  if (openai) localStorage.setItem(LS_OPENAI, openai);
  else localStorage.removeItem(LS_OPENAI);
  els.jevKey.value = "";
  els.openaiKey.value = "";
  renderKeyStatus();
};

els.clearKeysBtn.onclick = () => {
  localStorage.removeItem(LS_JEV);
  localStorage.removeItem(LS_OPENAI);
  els.jevKey.value = "";
  els.openaiKey.value = "";
  renderKeyStatus();
};

els.findBtn.onclick = findRelated;
els.clearQueryBtn.onclick = () => {
  const pad = activePad();
  pad.text = "";
  pad.caret = 0;
  pad.assignedThemeLabel = null;
  pad.chunkMap = {};
  pad.chunkSeq = 0;
  currentRun = null;
  currentTheme = null;
  showError("");
  setBadge("idle");
  els.resultMeta.textContent = "No search yet.";
  els.themeMeta.textContent = "Theme judge idle.";
  loadPadIntoEditor();
  renderResults();
};
els.addPadBtn.onclick = () => {
  syncPadFromEditor();
  const pad = createPad({ id: nextPadId(session.pads), text: "" });
  session.pads.push(pad);
  session.activePadId = pad.id;
  loadPadIntoEditor();
  els.query.focus();
  scheduleTheme();
};
els.confirmPasteBtn.onclick = confirmPaste;
els.dismissPasteBtn.onclick = dismissPaste;
els.showAllBtn.onclick = () => {
  showAll = !showAll;
  renderResults();
};
els.poolSearch.addEventListener("input", renderPool);
els.note.addEventListener("input", persistNote);
els.query.addEventListener("paste", (event) => {
  const inserted = event.clipboardData ? event.clipboardData.getData("text") : "";
  pendingPasteCount = countNonEmptyBlocks(inserted);
});
els.query.addEventListener("input", () => {
  syncPadFromEditor();
  renderHighlight();
  if (pendingPasteCount >= 3) {
    showPasteFallback(els.query.value);
  }
  pendingPasteCount = 0;
  scheduleTheme();
});
els.query.addEventListener("scroll", () => {
  els.editorHighlight.scrollTop = els.query.scrollTop;
  els.editorHighlight.scrollLeft = els.query.scrollLeft;
});
els.query.addEventListener("click", scheduleTheme);
els.query.addEventListener("keyup", scheduleTheme);
els.query.addEventListener("select", scheduleTheme);
els.exportJsonBtn.onclick = () => {
  download(`memo-relatedness-eval.json`, toEvalJson(evalLog), "application/json");
};
els.exportJsonlBtn.onclick = () => {
  download(`memo-relatedness-eval.jsonl`, toEvalJsonl(evalLog), "application/jsonl");
};
els.clearLogBtn.onclick = () => {
  if (!evalLog.length) return;
  if (!window.confirm("Clear the eval log from this browser?")) return;
  evalLog = [];
  persistEvalLog();
  currentRun = null;
  els.note.value = "";
  renderLog();
  renderResults();
};

renderPads();
renderLog();
renderResults();
renderKeyStatus();
renderHighlight();
renderChunkRows();

loadCorpus()
  .then(loadServerStatus)
  .catch((err) => {
    showError(err && err.message ? err.message : String(err));
  });
