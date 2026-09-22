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
  themeChips: document.getElementById("themeChips"),
  nudgeBar: document.getElementById("nudgeBar"),
  openNewMemoBtn: document.getElementById("openNewMemoBtn"),
  stayMemoBtn: document.getElementById("stayMemoBtn"),
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
let lastThemeEntry = null;
let currentTheme = null;
let currentChunk = null;
let pendingPasteCount = 0;
let pasteState = null;
const suppressedDrift = new Set();

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
        <div class="muted">confidence ${entry.confidence == null ? "—" : entry.confidence} · chip ${escapeHtml(String(entry.chipChosen))} · nudge ${escapeHtml(String(entry.newMemoNudge))} · pad ${escapeHtml(String(entry.padId))} · chunk ${escapeHtml(String(entry.activeChunkId))}</div>
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
  els.query.value = pad.text;
  const caret = Math.min(pad.caret || pad.text.length, pad.text.length);
  els.query.setSelectionRange(caret, caret);
  renderPads();
  renderHighlight();
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

function appendThemeLog(fields) {
  const entry = makeThemeChunkEvalEntry(fields);
  evalLog.push(entry);
  persistEvalLog();
  lastThemeEntry = entry;
  renderLog();
  return entry;
}

function updateThemeLog(chipChosen, newMemoNudge) {
  if (lastThemeEntry && lastThemeEntry.kind === "theme_chunk") {
    const samePad = lastThemeEntry.padId === session.activePadId;
    const sameChunk = currentChunk && lastThemeEntry.activeChunkId === currentChunk.id;
    if (samePad && sameChunk) {
      setThemeChunkChoice(lastThemeEntry, chipChosen, newMemoNudge);
      persistEvalLog();
      renderLog();
      return lastThemeEntry;
    }
  }
  return appendThemeLog({
    chunk: currentChunk ? currentChunk.text : "",
    proposals: currentTheme ? buildThemeChips(currentTheme) : [],
    confidence: currentTheme ? currentTheme.confidence : null,
    method: currentTheme ? currentTheme.method : null,
    chipChosen,
    newMemoNudge,
    padId: session.activePadId,
    activeChunkId: currentChunk ? currentChunk.id : null,
    model: currentTheme && currentTheme.model,
    inventedLabelBefore: currentTheme && currentTheme.inventedLabelBefore,
    inventedLabelAfter: currentTheme && currentTheme.inventedLabelAfter,
    needsTitle: currentTheme && currentTheme.needsTitle,
    labelSource: currentTheme && currentTheme.labelSource,
  });
}

function renderThemeUi(result, chunk, priors) {
  currentTheme = result;
  currentChunk = chunk;
  const chips = buildThemeChips({ ...result, chunkText: chunk.text });
  els.themeChips.innerHTML = "";
  const chosen = activePad().assignedThemeLabel;
  for (const chip of chips) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    if (chip.kind === "새메모") btn.classList.add("drift");
    if (chip.kind === "기타" || chip.kind === "없음") btn.classList.add("soft");
    if (chosen && chip.label === chosen) btn.classList.add("on");
    btn.textContent = chip.label;
    btn.onclick = () => onChip(chip);
    els.themeChips.appendChild(btn);
  }
  const fp = themeDriftFingerprint(chunk.text, priorLabels(priors));
  const showNudge = Boolean(result.drift) && !suppressedDrift.has(fp);
  els.nudgeBar.hidden = !showNudge;
  const conf = typeof result.confidence === "number" ? result.confidence.toFixed(3) : "—";
  const err = result.error ? ` · ${result.error}` : "";
  const invent = result.inventedLabelAfter
    ? ` · invented ${result.inventedLabelAfter}`
    : result.needsTitle
      ? " · awaiting short title"
      : "";
  els.themeMeta.textContent = `${result.label || result.method} · confidence ${conf}${result.lowConfidence ? " · low confidence" : ""}${result.drift ? " · drift" : ""}${invent}${err}`;
}

function onChip(chip) {
  if (chip.kind === "새메모") {
    openNewMemo();
    return;
  }
  const pad = activePad();
  pad.assignedThemeLabel = chip.kind === "없음" ? null : chip.label;
  if (chip.kind === "theme" && chip.label) {
    rememberSessionTheme(chip.label, currentChunk ? currentChunk.text : pad.text);
  }
  updateThemeLog(chip.label, null);
  renderPads();
  els.themeChips.querySelectorAll("button").forEach((btn) => {
    btn.classList.toggle("on", btn.textContent === chip.label);
  });
}

function openNewMemo() {
  syncPadFromEditor();
  const pad = activePad();
  const loc = activeChunkAt(pad.text, pad.caret);
  moveActiveChunkToNewPad(session, loc.active);
  updateThemeLog("새 메모로 열기", "yes");
  els.nudgeBar.hidden = true;
  loadPadIntoEditor();
  els.query.focus();
  scheduleTheme();
}

function stayOnMemo() {
  const pad = activePad();
  const loc = activeChunkAt(pad.text, pad.caret);
  const priors = collectPriorThemes(pad, loc.earlier);
  suppressedDrift.add(themeDriftFingerprint(loc.active.text, priorLabels(priors)));
  updateThemeLog("이 메모에 유지", "no");
  els.nudgeBar.hidden = true;
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

async function runThemePropose() {
  const pad = activePad();
  const loc = activeChunkAt(pad.text, pad.caret);
  const chunk = loc.active;
  if (!normalizeText(chunk.text)) {
    currentTheme = null;
    currentChunk = chunk;
    els.themeChips.innerHTML = "";
    els.nudgeBar.hidden = true;
    els.themeMeta.textContent = "Theme judge idle.";
    return;
  }
  const priors = collectPriorThemes(pad, loc.earlier);
  const seq = (themeSeq += 1);
  const path = livePath();
  try {
    let result;
    if (path.mode === "none") {
      result = proposeThemesHeuristic(chunk.text, priors, loc.earlier);
    } else {
      els.themeMeta.textContent = "Scoring the active chunk…";
      const live = await callLiveTheme(chunk.text, priors);
      if (seq !== themeSeq) return;
      if (!live.called) {
        result = proposeThemesHeuristic(chunk.text, priors, loc.earlier);
      } else if (!live.ok) {
        showError(`${live.error}\n${live.detail || ""}`);
        els.themeMeta.textContent = live.error;
        renderThemeUi(
          {
            method: "live_jev",
            label: "live TypeSafe Jev (noul)",
            confidence: 0,
            lowConfidence: true,
            drift: false,
            themes: [],
            needsTitle: false,
            error: live.error,
          },
          chunk,
          priors
        );
        appendThemeLog({
          chunk: chunk.text,
          proposals: [],
          confidence: 0,
          method: "live_jev",
          chipChosen: null,
          newMemoNudge: null,
          padId: pad.id,
          activeChunkId: chunk.id,
        });
        return;
      } else {
        result = live.parsed;
      }
    }
    if (seq !== themeSeq) return;
    result = await maybeInventTitle(result, chunk, priors);
    if (seq !== themeSeq) return;
    for (const theme of result.themes || []) {
      if (theme.label) rememberSessionTheme(theme.label, chunk.text);
    }
    commitTheme(result, chunk, priors);
  } catch (err) {
    if (seq !== themeSeq) return;
    const message = err && err.message ? err.message : String(err);
    showError(message);
    els.themeMeta.textContent = message;
  }
}

function commitTheme(result, chunk, priors) {
  showError(result && result.error ? `${result.error}` : "");
  renderThemeUi(result, chunk, priors);
  appendThemeLog({
    chunk: chunk.text,
    proposals: buildThemeChips({ ...result, chunkText: chunk.text }),
    confidence: result.confidence,
    method: result.method,
    chipChosen: null,
    newMemoNudge: null,
    padId: activePad().id,
    activeChunkId: chunk.id,
    model: result.model,
    inventedLabelBefore: result.inventedLabelBefore || null,
    inventedLabelAfter: result.inventedLabelAfter || null,
    needsTitle: result.needsTitle,
    labelSource: result.labelSource || null,
  });
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
  currentRun = null;
  currentTheme = null;
  currentChunk = null;
  showError("");
  setBadge("idle");
  els.resultMeta.textContent = "No search yet.";
  els.themeMeta.textContent = "Theme judge idle.";
  els.themeChips.innerHTML = "";
  els.nudgeBar.hidden = true;
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
els.openNewMemoBtn.onclick = openNewMemo;
els.stayMemoBtn.onclick = stayOnMemo;
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
  lastThemeEntry = null;
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

loadCorpus()
  .then(loadServerStatus)
  .catch((err) => {
    showError(err && err.message ? err.message : String(err));
  });
