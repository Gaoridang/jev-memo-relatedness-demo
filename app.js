const LS_JEV = "jev_api_key";
const LS_EVAL = "memoRelatednessEvalLog";

localStorage.removeItem("openai_api_key");

const els = {
  jevKey: document.getElementById("jevKey"),
  keyStatus: document.getElementById("keyStatus"),
  pathStatus: document.getElementById("pathStatus"),
  saveKeysBtn: document.getElementById("saveKeysBtn"),
  clearKeysBtn: document.getElementById("clearKeysBtn"),
  query: document.getElementById("query"),
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
};

let memos = [];
let serverStatus = { jevEnv: false };
let currentEntry = null;
let showAll = false;
let evalLog = loadEvalLog();

function loadEvalLog() {
  let stored = [];
  try {
    stored = JSON.parse(localStorage.getItem(LS_EVAL) || "[]");
  } catch (err) {
    stored = [];
  }
  const kept = keepRelatedRuns(stored);
  const storedLength = Array.isArray(stored) ? stored.length : 0;
  if (kept.length !== storedLength) {
    localStorage.setItem(LS_EVAL, JSON.stringify(kept));
  }
  return kept;
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

function renderKeyStatus() {
  const parts = [];
  parts.push(localJevKey() ? "browser jev_api_key stored" : "no browser jev_api_key");
  parts.push(serverStatus.jevEnv ? "Vercel JEV_API_KEY present" : "Vercel JEV_API_KEY absent");
  els.keyStatus.textContent = parts.join(" · ");
  const path = livePath();
  if (path.mode === "proxy") {
    els.pathStatus.textContent = "Find related calls /api/jev → TypeSafe.";
  } else if (path.mode === "browser") {
    els.pathStatus.textContent = "Find related calls TypeSafe with jev_api_key.";
  } else {
    els.pathStatus.textContent = "No Jev key. Find related uses the keyword baseline.";
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
      els.query.value = memo.text;
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

function memoText(id) {
  const memo = memos.find((item) => item.id === id);
  return memo ? memo.text : "";
}

function renderResults() {
  els.results.innerHTML = "";
  if (!currentEntry || !currentEntry.ranked || !currentEntry.ranked.length) {
    els.results.innerHTML = '<p class="empty">Paste a query or click a pool memo, then Find related.</p>';
    els.showAllBtn.hidden = true;
    return;
  }
  const rows = showAll ? currentEntry.ranked : currentEntry.ranked.slice(0, DEFAULT_RESULT_LIMIT);
  els.showAllBtn.hidden = currentEntry.ranked.length <= DEFAULT_RESULT_LIMIT;
  els.showAllBtn.textContent = showAll
    ? `Show top ${DEFAULT_RESULT_LIMIT}`
    : `Show all ${currentEntry.ranked.length}`;

  for (const row of rows) {
    const rating = currentEntry.ratings ? currentEntry.ratings[row.id] : null;
    const article = document.createElement("article");
    article.className = "result";
    const long = isLongMemo(row.id) ? '<span class="pill long">long / multi-topic</span>' : "";
    article.innerHTML = `
      <div class="result-top">
        <div>
          <strong>${row.id}</strong>
          <span class="rank">#${row.rank}</span>
          ${long}
        </div>
        <div class="score">${formatScore(row.score)} <span class="muted">${escapeHtml(row.why || "")}</span></div>
      </div>
      <p>${escapeHtml(memoText(row.id))}</p>
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
  const rows = evalLog.filter((entry) => entry && (entry.kind == null || entry.kind === "related_run"));
  if (!rows.length) {
    els.logList.innerHTML = '<p class="empty">No eval rows yet.</p>';
    return;
  }
  const latest = [...rows].reverse();
  for (const entry of latest) {
    const item = document.createElement("div");
    item.className = "log-item";
    const yes = Object.values(entry.ratings || {}).filter((v) => v === "yes").length;
    const no = Object.values(entry.ratings || {}).filter((v) => v === "no").length;
    item.innerHTML = `
      <div class="log-head">
        <span class="badge">${escapeHtml(entry.kind || "related_run")}</span>
        <strong>${escapeHtml(entry.method || "")}</strong>
        <span>${escapeHtml(entry.ts || "")}</span>
      </div>
      <p>${escapeHtml(entry.query || "")}</p>
      <div class="muted">suggestions ${(entry.ranked || []).length} · Yes ${yes} · No ${no}${entry.note ? ` · note: ${escapeHtml(entry.note)}` : ""}</div>
    `;
    els.logList.appendChild(item);
  }
}

function rateRow(id, rating) {
  if (!currentEntry) return;
  setEvalRating(currentEntry, id, rating);
  persistEvalLog();
  renderResults();
  renderLog();
}

function persistNote() {
  if (!currentEntry) return;
  currentEntry.note = els.note.value;
  persistEvalLog();
  renderLog();
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

async function findRelated() {
  showError("");
  const query = document.getElementById("query").value;
  if (!String(query || "").trim()) {
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
      if (!heuristic.ok) {
        showError(heuristic.error);
        return;
      }
      commitRun(query, heuristic);
      return;
    }
    if (!live.ok) {
      setBadge("error");
      els.resultMeta.textContent = live.error;
      showError(`${live.error}\n${live.detail || ""}`);
      currentEntry = null;
      renderResults();
      return;
    }
    commitRun(query, live.parsed);
  } catch (err) {
    setBadge("error");
    const message = err && err.message ? err.message : String(err);
    showError(message);
    els.resultMeta.textContent = message;
    currentEntry = null;
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
  currentEntry = entry;
  persistEvalLog();
  setBadge(result.method);
  const modelBit = result.model ? ` · model ${result.model}` : "";
  els.resultMeta.textContent = `${result.label} · compared ${result.ranked.length} of ${memos.length} memos${modelBit}`;
  renderResults();
  renderLog();
}

async function loadServerStatus() {
  try {
    const res = await fetch("/api/status", { method: "GET" });
    const data = await res.json();
    serverStatus = {
      jevEnv: Boolean(data && data.jevEnv),
    };
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
  const jev = els.jevKey.value.trim();
  if (jev) localStorage.setItem(LS_JEV, jev);
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
  currentEntry = null;
  showError("");
  setBadge("idle");
  els.resultMeta.textContent = "No search yet.";
  renderResults();
};
els.showAllBtn.onclick = () => {
  showAll = !showAll;
  renderResults();
};
els.poolSearch.addEventListener("input", renderPool);
els.note.addEventListener("input", persistNote);
els.exportJsonBtn.onclick = () => {
  download("memo-relatedness-eval.json", toEvalJson(evalLog), "application/json");
};
els.exportJsonlBtn.onclick = () => {
  download("memo-relatedness-eval.jsonl", toEvalJsonl(evalLog), "application/jsonl");
};
els.clearLogBtn.onclick = () => {
  if (!evalLog.length) return;
  if (!window.confirm("Clear the eval log from this browser?")) return;
  evalLog = [];
  persistEvalLog();
  currentEntry = null;
  els.note.value = "";
  renderLog();
  renderResults();
};

renderLog();
renderResults();
renderKeyStatus();

loadCorpus()
  .then(loadServerStatus)
  .catch((err) => {
    showError(err && err.message ? err.message : String(err));
  });
