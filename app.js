const LS_JEV = "jev_api_key";
const LS_EVAL = "memoRelatednessEvalLog";
const THEME_DEBOUNCE_MS = 350;

const els = {
  jevKey: document.getElementById("jevKey"),
  keyStatus: document.getElementById("keyStatus"),
  pathStatus: document.getElementById("pathStatus"),
  saveKeysBtn: document.getElementById("saveKeysBtn"),
  clearKeysBtn: document.getElementById("clearKeysBtn"),
  query: document.getElementById("query"),
  editorHighlight: document.getElementById("editorHighlight"),
  themeChips: document.getElementById("themeChips"),
  themeMeta: document.getElementById("themeMeta"),
  nudgeBar: document.getElementById("nudgeBar"),
  openNewMemoBtn: document.getElementById("openNewMemoBtn"),
  stayMemoBtn: document.getElementById("stayMemoBtn"),
  padTabs: document.getElementById("padTabs"),
  addPadBtn: document.getElementById("addPadBtn"),
  findBtn: document.getElementById("findBtn"),
  clearQueryBtn: document.getElementById("clearQueryBtn"),
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
let serverStatus = { jevEnv: false };
let currentRun = null;
let showAll = false;
let evalLog = loadEvalLog();
let themeTimer = null;
let themeReqId = 0;
let latestThemeResult = null;
let latestThemeEntryIndex = -1;
let stayFingerprint = null;
let pasteWorkbench = null;
let siblingThemeLabel = null;

let padSeq = 1;
const session = {
  pads: [{ id: "pad1", text: "", themeLabel: null }],
  activePadId: "pad1",
};

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

function livePath() {
  if (serverStatus.jevEnv) return { mode: "proxy" };
  if (localJevKey()) return { mode: "browser", key: localJevKey() };
  return { mode: "none" };
}

function activePad() {
  return session.pads.find((p) => p.id === session.activePadId) || session.pads[0];
}

function syncPadFromEditor() {
  const pad = activePad();
  if (!pad) return;
  pad.text = els.query.value;
}

function renderKeyStatus() {
  const parts = [];
  parts.push(localJevKey() ? "browser jev_api_key stored" : "no browser jev_api_key");
  parts.push(serverStatus.jevEnv ? "Vercel JEV_API_KEY present" : "Vercel JEV_API_KEY absent");
  els.keyStatus.textContent = parts.join(" · ");
  const path = livePath();
  if (path.mode === "proxy") {
    els.pathStatus.textContent =
      "Theme chips + Find related call /api/jev → TypeSafe POST /v1/systemone (live Noul).";
  } else if (path.mode === "browser") {
    els.pathStatus.textContent =
      "Theme chips + Find related call TypeSafe from the browser with jev_api_key (live Noul).";
  } else {
    els.pathStatus.textContent =
      "No key. Theme chips and Find related use the labeled keyword/overlap baseline.";
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

function renderPadTabs() {
  els.padTabs.innerHTML = "";
  session.pads.forEach((pad, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = pad.themeLabel ? `${index + 1}. ${pad.themeLabel}` : `Pad ${index + 1}`;
    if (pad.id === session.activePadId) btn.classList.add("on");
    btn.onclick = () => switchPad(pad.id);
    els.padTabs.appendChild(btn);
  });
}

function switchPad(padId) {
  syncPadFromEditor();
  session.activePadId = padId;
  const pad = activePad();
  els.query.value = pad ? pad.text : "";
  siblingThemeLabel = pad && pad.themeLabel ? pad.themeLabel : null;
  stayFingerprint = null;
  latestThemeResult = null;
  latestThemeEntryIndex = -1;
  renderPadTabs();
  renderHighlight();
  scheduleThemePropose();
}

function addPad(text, themeLabel) {
  padSeq += 1;
  const pad = {
    id: `pad${padSeq}`,
    text: text || "",
    themeLabel: themeLabel || null,
  };
  session.pads.push(pad);
  switchPad(pad.id);
  return pad;
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
      els.query.value = memo.text;
      syncPadFromEditor();
      els.query.focus();
      renderHighlight();
      scheduleThemePropose();
    };
    els.pool.appendChild(card);
  }
}

function setBadge(method) {
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
    els.methodBadge.textContent = method || "idle";
    els.methodBadge.className = "badge";
  }
}

function renderHighlight() {
  const text = els.query.value;
  const caret = els.query.selectionStart || 0;
  const { active } = activeChunkAt(text, caret);
  const before = escapeHtml(text.slice(0, active.start));
  const mid = escapeHtml(text.slice(active.start, active.end));
  const after = escapeHtml(text.slice(active.end));
  els.editorHighlight.innerHTML = `${before}<mark>${mid || " "}</mark>${after}`;
  els.editorHighlight.scrollTop = els.query.scrollTop;
  els.editorHighlight.scrollLeft = els.query.scrollLeft;
}

function priorThemesForPad() {
  const pad = activePad();
  const themes = [];
  if (pad && pad.themeLabel) {
    themes.push({ id: "pad_theme", label: pad.themeLabel, sample: pad.text });
  }
  for (const other of session.pads) {
    if (other.id === session.activePadId) continue;
    if (other.themeLabel) {
      themes.push({ id: other.id, label: other.themeLabel, sample: other.text });
    }
  }
  const { earlier } = activeChunkAt(els.query.value, els.query.selectionStart || 0);
  if (earlier.length && (!pad || !pad.themeLabel)) {
    themes.push({
      id: "earlier",
      label: inventThemeLabel(earlier[0]),
      sample: earlier.join("\n"),
    });
  }
  return themes;
}

function fingerprint(chunk, drift) {
  return `${normalizeText(chunk)}::${drift ? "1" : "0"}`;
}

function renderThemeChips(result, chunkInfo) {
  els.themeChips.innerHTML = "";
  if (!result) {
    els.nudgeBar.hidden = true;
    return;
  }
  const chips = buildThemeChips(result);
  const fp = fingerprint(chunkInfo.active.text, result.drift);
  const suppressNudge = stayFingerprint === fp;
  for (const chip of chips) {
    if (chip.kind === "새메모" && suppressNudge) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    if (chip.kind === "새메모") btn.classList.add("drift");
    if (chip.kind === "기타" || chip.kind === "없음") btn.classList.add("soft");
    btn.textContent = chip.label;
    btn.onclick = () => onChipChosen(chip, chunkInfo, result);
    els.themeChips.appendChild(btn);
  }
  const showNudge = result.drift && !suppressNudge;
  els.nudgeBar.hidden = !showNudge;
  const conf = typeof result.confidence === "number" ? result.confidence.toFixed(2) : "—";
  els.themeMeta.textContent = `${result.label || result.method} · confidence ${conf}${
    result.lowConfidence ? " · low → 기타/없음 offered" : ""
  }${result.drift ? " · drift" : ""}`;
  setBadge(result.method);
}

function appendThemeLog(partial) {
  const entry = makeThemeChunkEvalEntry(partial);
  evalLog.push(entry);
  persistEvalLog();
  latestThemeEntryIndex = evalLog.length - 1;
  renderLog();
  return entry;
}

function updateLatestThemeChoice(chipChosen, newMemoNudge) {
  if (latestThemeEntryIndex < 0) return;
  const entry = evalLog[latestThemeEntryIndex];
  setThemeChunkChoice(entry, chipChosen, newMemoNudge);
  persistEvalLog();
  renderLog();
}

function onChipChosen(chip, chunkInfo, result) {
  const pad = activePad();
  if (chip.kind === "theme" || chip.kind === "기타") {
    if (pad) pad.themeLabel = chip.label;
    siblingThemeLabel = chip.label;
    renderPadTabs();
    updateLatestThemeChoice(chip.label, null);
    appendThemeLog({
      chunk: chunkInfo.active.text,
      proposals: buildThemeChips(result),
      confidence: result.confidence,
      method: result.method,
      chipChosen: chip.label,
      newMemoNudge: null,
      padId: pad && pad.id,
      activeChunkId: chunkInfo.active.id,
      model: result.model,
    });
    return;
  }
  if (chip.kind === "없음") {
    updateLatestThemeChoice("없음", null);
    appendThemeLog({
      chunk: chunkInfo.active.text,
      proposals: buildThemeChips(result),
      confidence: result.confidence,
      method: result.method,
      chipChosen: "없음",
      newMemoNudge: null,
      padId: pad && pad.id,
      activeChunkId: chunkInfo.active.id,
      model: result.model,
    });
    return;
  }
  if (chip.kind === "새메모") {
    openNewMemoFromActive(chunkInfo, result);
  }
}

function openNewMemoFromActive(chunkInfo, result) {
  syncPadFromEditor();
  const pad = activePad();
  const text = els.query.value;
  const active = chunkInfo.active;
  const kept = text.slice(0, active.start).replace(/\n+$/, "");
  const moved = text.slice(active.start);
  if (pad) pad.text = kept;
  els.query.value = kept;
  renderHighlight();
  const label = inventThemeLabel(moved);
  addPad(moved.replace(/^\n+/, ""), label);
  siblingThemeLabel = label;
  updateLatestThemeChoice("새 메모로 열기", "yes");
  appendThemeLog({
    chunk: active.text,
    proposals: buildThemeChips(result || latestThemeResult || {}),
    confidence: result && result.confidence,
    method: (result && result.method) || "heuristic",
    chipChosen: "새 메모로 열기",
    newMemoNudge: "yes",
    padId: pad && pad.id,
    activeChunkId: active.id,
    model: result && result.model,
  });
  stayFingerprint = null;
  scheduleThemePropose();
}

function stayOnMemo(chunkInfo, result) {
  stayFingerprint = fingerprint(chunkInfo.active.text, true);
  els.nudgeBar.hidden = true;
  updateLatestThemeChoice(null, "no");
  appendThemeLog({
    chunk: chunkInfo.active.text,
    proposals: buildThemeChips(result || latestThemeResult || {}),
    confidence: result && result.confidence,
    method: (result && result.method) || "heuristic",
    chipChosen: "이 메모에 유지",
    newMemoNudge: "no",
    padId: activePad() && activePad().id,
    activeChunkId: chunkInfo.active.id,
    model: result && result.model,
  });
  renderThemeChips(result || latestThemeResult, chunkInfo);
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
  return { called: true, ok: true, parsed };
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

async function runThemePropose() {
  const text = els.query.value;
  const caret = els.query.selectionStart || text.length;
  const chunkInfo = activeChunkAt(text, caret);
  if (!normalizeText(chunkInfo.active.text)) {
    latestThemeResult = null;
    els.themeChips.innerHTML = "";
    els.nudgeBar.hidden = true;
    els.themeMeta.textContent = "Empty chunk · waiting for text.";
    return;
  }
  const reqId = ++themeReqId;
  const priors = priorThemesForPad();
  els.themeMeta.textContent = "Judging active chunk…";
  try {
    const path = livePath();
    let result;
    if (path.mode === "none") {
      result = proposeThemesHeuristic(chunkInfo.active.text, priors, chunkInfo.earlier);
    } else {
      const live = await callLiveTheme(chunkInfo.active.text, priors);
      if (reqId !== themeReqId) return;
      if (!live.called) {
        result = proposeThemesHeuristic(chunkInfo.active.text, priors, chunkInfo.earlier);
      } else if (!live.ok) {
        showError(`${live.error}\n${live.detail || ""}`);
        els.themeMeta.textContent = live.error;
        setBadge("error");
        result = proposeThemesHeuristic(chunkInfo.active.text, priors, chunkInfo.earlier);
        result.error = live.error;
      } else {
        showError("");
        result = live.parsed;
      }
    }
    if (reqId !== themeReqId) return;
    latestThemeResult = result;
    renderThemeChips(result, chunkInfo);
    appendThemeLog({
      chunk: chunkInfo.active.text,
      proposals: buildThemeChips(result),
      confidence: result.confidence,
      method: result.method,
      chipChosen: null,
      newMemoNudge: null,
      padId: activePad() && activePad().id,
      activeChunkId: chunkInfo.active.id,
      model: result.model,
    });
  } catch (err) {
    if (reqId !== themeReqId) return;
    const message = err && err.message ? err.message : String(err);
    showError(message);
    els.themeMeta.textContent = message;
    setBadge("error");
  }
}

function scheduleThemePropose() {
  renderHighlight();
  if (themeTimer) clearTimeout(themeTimer);
  themeTimer = setTimeout(() => {
    themeTimer = null;
    runThemePropose();
  }, THEME_DEBOUNCE_MS);
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
    const sib =
      siblingThemeLabel && row.sibling
        ? `<span class="sibling-chip">same theme · ${escapeHtml(siblingThemeLabel)}</span>`
        : "";
    article.innerHTML = `
      <div class="result-top">
        <div>
          <strong>${row.id}</strong>
          <span class="rank">#${row.rank}</span>
          ${long}${sib}
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
    els.logList.innerHTML = '<p class="empty">No eval rows yet. Theme chips and ratings persist in localStorage.</p>';
    return;
  }
  const latest = [...evalLog].reverse();
  for (const entry of latest) {
    const item = document.createElement("div");
    item.className = "log-item";
    if (entry.kind === "theme_chunk") {
      const props = (entry.proposals || []).map((p) => p.label).join(", ");
      item.innerHTML = `
        <div class="log-head">
          <strong>theme_chunk · ${escapeHtml(entry.method || "")}</strong>
          <span>${escapeHtml(entry.ts)}</span>
        </div>
        <p>${escapeHtml(entry.chunk)}</p>
        <div class="muted">proposals: ${escapeHtml(props) || "—"} · conf ${
          entry.confidence == null ? "—" : entry.confidence
        } · chip ${escapeHtml(String(entry.chipChosen))} · nudge ${escapeHtml(
          String(entry.newMemoNudge)
        )}</div>
      `;
    } else {
      const yes = Object.values(entry.ratings || {}).filter((v) => v === "yes").length;
      const no = Object.values(entry.ratings || {}).filter((v) => v === "no").length;
      item.innerHTML = `
        <div class="log-head">
          <strong>related_run · ${escapeHtml(entry.method)}</strong>
          <span>${escapeHtml(entry.ts)}</span>
        </div>
        <p>${escapeHtml(entry.query)}</p>
        <div class="muted">suggestions ${(entry.ranked || []).length} · Yes ${yes} · No ${no}${
          entry.note ? ` · note: ${escapeHtml(entry.note)}` : ""
        }</div>
      `;
    }
    els.logList.appendChild(item);
  }
}

function rateRow(id, rating) {
  if (!currentRun) return;
  currentRun.ratings[id] = rating;
  const lastRelated = [...evalLog].reverse().find((e) => e.kind === "related_run" || !e.kind);
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
  const lastRelated = [...evalLog].reverse().find((e) => e.kind === "related_run" || !e.kind);
  if (lastRelated) {
    lastRelated.note = els.note.value;
    persistEvalLog();
  }
  renderLog();
}

function markSiblingRows(ranked) {
  if (!siblingThemeLabel) {
    return ranked.map((row) => ({ ...row, sibling: false }));
  }
  return ranked.map((row) => {
    const score = overlapScore(siblingThemeLabel, row.text).score;
    return { ...row, sibling: score >= 0.12 };
  });
}

async function findRelated() {
  showError("");
  syncPadFromEditor();
  const query = els.query.value;
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
      commitRun(query, {
        ...heuristic,
        ranked: markSiblingRows(heuristic.ranked),
      });
      return;
    }
    const live = await callLiveJev(query, candidates);
    if (!live.called) {
      const heuristic = rankHeuristic(query, memos);
      commitRun(query, {
        ...heuristic,
        ranked: markSiblingRows(heuristic.ranked),
      });
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
    commitRun(query, {
      ...live.parsed,
      ranked: markSiblingRows(live.parsed.ranked),
    });
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
  const sibBit = siblingThemeLabel ? ` · theme chip ${siblingThemeLabel}` : "";
  els.resultMeta.textContent = `${result.label} · compared ${result.ranked.length} of ${memos.length} memos${modelBit}${sibBit}`;
  renderResults();
  renderLog();
}

function renderPasteWorkbench() {
  els.pasteThemes.innerHTML = "";
  if (!pasteWorkbench) return;
  for (const theme of pasteWorkbench.themes) {
    const box = document.createElement("div");
    box.className = "paste-theme";
    const options = pasteWorkbench.themes
      .filter((t) => t.id !== theme.id)
      .map((t) => `<option value="${t.id}">${escapeHtml(t.label)}</option>`)
      .join("");
    box.innerHTML = `<div class="memo-head"><strong>${escapeHtml(theme.label)}</strong>
      <button type="button" data-merge="${theme.id}" class="ghost">Merge into…</button></div>
      <div class="cards"></div>`;
    const cardsEl = box.querySelector(".cards");
    for (const card of theme.cards) {
      const cardEl = document.createElement("div");
      cardEl.className = "theme-card";
      cardEl.innerHTML = `<p>${escapeHtml(card.text)}</p>
        <div class="row">
          <label class="meta">Move</label>
          <select data-card="${card.id}" data-from="${theme.id}">
            <option value="">—</option>${options}
            <option value="__detach__">Detach standalone</option>
          </select>
        </div>`;
      cardsEl.appendChild(cardEl);
    }
    els.pasteThemes.appendChild(box);
  }
  els.pasteThemes.querySelectorAll("select[data-card]").forEach((sel) => {
    sel.onchange = () => {
      const to = sel.value;
      if (!to) return;
      movePasteCard(sel.getAttribute("data-from"), sel.getAttribute("data-card"), to);
      sel.value = "";
    };
  });
  els.pasteThemes.querySelectorAll("[data-merge]").forEach((btn) => {
    btn.onclick = () => {
      const fromId = btn.getAttribute("data-merge");
      const others = pasteWorkbench.themes.filter((t) => t.id !== fromId);
      if (!others.length) return;
      const target = window.prompt(
        `Merge into theme id (${others.map((t) => t.id).join(", ")})`,
        others[0].id
      );
      if (!target) return;
      mergePasteThemes(fromId, target);
    };
  });
}

function movePasteCard(fromId, cardId, toId) {
  const from = pasteWorkbench.themes.find((t) => t.id === fromId);
  if (!from) return;
  const idx = from.cards.findIndex((c) => c.id === cardId);
  if (idx < 0) return;
  const [card] = from.cards.splice(idx, 1);
  if (toId === "__detach__") {
    pasteWorkbench.themes.push({
      id: `theme_${Date.now()}`,
      label: inventThemeLabel(card.text),
      cards: [card],
    });
  } else {
    const to = pasteWorkbench.themes.find((t) => t.id === toId);
    if (to) to.cards.push(card);
  }
  pasteWorkbench.themes = pasteWorkbench.themes.filter((t) => t.cards.length);
  evalLog.push({
    kind: "theme_edit",
    ts: new Date().toISOString(),
    action: toId === "__detach__" ? "detach" : "move",
    cardId,
    fromId,
    toId,
  });
  persistEvalLog();
  renderPasteWorkbench();
  renderLog();
}

function mergePasteThemes(fromId, toId) {
  const from = pasteWorkbench.themes.find((t) => t.id === fromId);
  const to = pasteWorkbench.themes.find((t) => t.id === toId);
  if (!from || !to || from === to) return;
  to.cards.push(...from.cards);
  pasteWorkbench.themes = pasteWorkbench.themes.filter((t) => t.id !== fromId);
  evalLog.push({
    kind: "theme_edit",
    ts: new Date().toISOString(),
    action: "merge",
    fromId,
    toId,
  });
  persistEvalLog();
  renderPasteWorkbench();
  renderLog();
}

function openPasteFallback(text) {
  pasteWorkbench = proposePasteStructure(text);
  if (pasteWorkbench.blockCount < 3) {
    pasteWorkbench = null;
    els.pasteFallback.hidden = true;
    return;
  }
  els.pasteFallback.hidden = false;
  els.pasteFallback.open = true;
  renderPasteWorkbench();
}

function confirmPasteStructure() {
  if (!pasteWorkbench) return;
  syncPadFromEditor();
  const first = pasteWorkbench.themes[0];
  if (first) {
    const pad = activePad();
    pad.text = first.cards.map((c) => c.text).join("\n\n");
    pad.themeLabel = first.label;
    els.query.value = pad.text;
    siblingThemeLabel = first.label;
  }
  for (let i = 1; i < pasteWorkbench.themes.length; i += 1) {
    const theme = pasteWorkbench.themes[i];
    addPad(theme.cards.map((c) => c.text).join("\n\n"), theme.label);
  }
  if (first) switchPad(session.pads[session.pads.length - pasteWorkbench.themes.length].id);
  evalLog.push({
    kind: "theme_edit",
    ts: new Date().toISOString(),
    action: "confirm_paste",
    themes: pasteWorkbench.themes.map((t) => ({
      label: t.label,
      cards: t.cards.map((c) => c.id),
    })),
  });
  persistEvalLog();
  pasteWorkbench = null;
  els.pasteFallback.hidden = true;
  renderPadTabs();
  renderHighlight();
  scheduleThemePropose();
  renderLog();
}

async function loadServerStatus() {
  try {
    const res = await fetch("/api/status", { method: "GET" });
    const data = await res.json();
    serverStatus = { jevEnv: Boolean(data && data.jevEnv) };
  } catch (err) {
    serverStatus = { jevEnv: false };
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
  const key = els.jevKey.value.trim();
  if (key) localStorage.setItem(LS_JEV, key);
  else localStorage.removeItem(LS_JEV);
  els.jevKey.value = "";
  renderKeyStatus();
};

els.clearKeysBtn.onclick = () => {
  localStorage.removeItem(LS_JEV);
  els.jevKey.value = "";
  renderKeyStatus();
};

els.findBtn.onclick = findRelated;
els.clearQueryBtn.onclick = () => {
  els.query.value = "";
  syncPadFromEditor();
  currentRun = null;
  showError("");
  setBadge("idle");
  els.resultMeta.textContent = "No search yet.";
  latestThemeResult = null;
  els.themeChips.innerHTML = "";
  els.nudgeBar.hidden = true;
  els.themeMeta.textContent = "Theme judge idle.";
  renderHighlight();
  renderResults();
};
els.addPadBtn.onclick = () => addPad("", null);
els.showAllBtn.onclick = () => {
  showAll = !showAll;
  renderResults();
};
els.poolSearch.addEventListener("input", renderPool);
els.note.addEventListener("input", persistNote);
els.query.addEventListener("input", () => {
  syncPadFromEditor();
  scheduleThemePropose();
});
els.query.addEventListener("click", renderHighlight);
els.query.addEventListener("keyup", renderHighlight);
els.query.addEventListener("scroll", () => {
  els.editorHighlight.scrollTop = els.query.scrollTop;
  els.editorHighlight.scrollLeft = els.query.scrollLeft;
});
els.query.addEventListener("paste", (event) => {
  const pasted = event.clipboardData ? event.clipboardData.getData("text") : "";
  const blocks = splitBlocks(pasted).filter((b) => normalizeText(b.text));
  if (blocks.length >= 3) {
    setTimeout(() => openPasteFallback(els.query.value || pasted), 0);
  }
});
els.openNewMemoBtn.onclick = () => {
  const chunkInfo = activeChunkAt(els.query.value, els.query.selectionStart || 0);
  openNewMemoFromActive(chunkInfo, latestThemeResult);
};
els.stayMemoBtn.onclick = () => {
  const chunkInfo = activeChunkAt(els.query.value, els.query.selectionStart || 0);
  stayOnMemo(chunkInfo, latestThemeResult);
};
els.confirmPasteBtn.onclick = confirmPasteStructure;
els.dismissPasteBtn.onclick = () => {
  pasteWorkbench = null;
  els.pasteFallback.hidden = true;
};
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

renderPadTabs();
renderLog();
renderResults();
renderKeyStatus();
renderHighlight();

loadCorpus()
  .then(loadServerStatus)
  .catch((err) => {
    showError(err && err.message ? err.message : String(err));
  });
