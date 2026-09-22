const LS_JEV = "jev_api_key";
const LS_EVAL = "memoRelatednessEvalLog";

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
let currentRun = null;
let showAll = false;
let evalLog = loadEvalLog();

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

function renderKeyStatus() {
  const parts = [];
  parts.push(localJevKey() ? "browser jev_api_key stored" : "no browser jev_api_key");
  parts.push(serverStatus.jevEnv ? "Vercel JEV_API_KEY present" : "Vercel JEV_API_KEY absent");
  els.keyStatus.textContent = parts.join(" · ");
  const path = livePath();
  if (path.mode === "proxy") {
    els.pathStatus.textContent = "Find related will call /api/jev → TypeSafe POST /v1/systemone (live Noul).";
  } else if (path.mode === "browser") {
    els.pathStatus.textContent = "Find related will call TypeSafe from the browser with jev_api_key (live Noul).";
  } else {
    els.pathStatus.textContent = "No key. Find related uses the labeled keyword/overlap baseline.";
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
      els.query.focus();
    };
    els.pool.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
    els.logList.innerHTML = '<p class="empty">No eval rows yet. Ratings persist in localStorage.</p>';
    return;
  }
  const latest = [...evalLog].reverse();
  for (const entry of latest) {
    const yes = Object.values(entry.ratings || {}).filter((v) => v === "yes").length;
    const no = Object.values(entry.ratings || {}).filter((v) => v === "no").length;
    const item = document.createElement("div");
    item.className = "log-item";
    item.innerHTML = `
      <div class="log-head">
        <strong>${escapeHtml(entry.method)}</strong>
        <span>${escapeHtml(entry.ts)}</span>
      </div>
      <p>${escapeHtml(entry.query)}</p>
      <div class="muted">suggestions ${entry.ranked.length} · Yes ${yes} · No ${no}${entry.note ? ` · note: ${escapeHtml(entry.note)}` : ""}</div>
    `;
    els.logList.appendChild(item);
  }
}

function rateRow(id, rating) {
  if (!currentRun) return;
  currentRun.ratings[id] = rating;
  if (evalLog[evalLog.length - 1]) {
    setEvalRating(evalLog[evalLog.length - 1], id, rating);
    persistEvalLog();
  }
  renderResults();
  renderLog();
}

function persistNote() {
  if (!currentRun) return;
  currentRun.note = els.note.value;
  if (evalLog[evalLog.length - 1]) {
    evalLog[evalLog.length - 1].note = els.note.value;
    persistEvalLog();
  }
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
  currentRun = null;
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

renderLog();
renderResults();
renderKeyStatus();

loadCorpus()
  .then(loadServerStatus)
  .catch((err) => {
    showError(err && err.message ? err.message : String(err));
  });
