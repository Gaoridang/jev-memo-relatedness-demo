const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  EXPECTED_COUNT,
  EXPECTED_IDS,
  LONG_MEMO_IDS,
  assertCorpus,
  rankHeuristic,
  buildRelatednessRequest,
  parseRelatednessAnswers,
  makeEvalEntry,
  setEvalRating,
  keepRelatedRuns,
  toEvalJson,
  toEvalJsonl,
  excludeSelf,
} = require("../relatedness");
const { extractPhrases } = require("../phrases");

const fixturePath = path.join(__dirname, "..", "fixtures", "korean-memo-relatedness-30.json");
const corpus = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

const checked = assertCorpus(corpus);
assert.equal(checked.ok, true, checked.error);
assert.equal(corpus.ground_truth, null);
assert.equal(corpus.count, 41);
assert.equal(corpus.memos.length, 41);
assert.deepEqual(
  corpus.memos.map((m) => m.id),
  EXPECTED_IDS
);
assert.equal(EXPECTED_COUNT, 41);
assert.deepEqual(LONG_MEMO_IDS, [
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
assert.ok(!("clusters" in corpus));
assert.ok(!("expected_pairs" in corpus));
assert.equal(corpus.ground_truth, null);
assert.ok(corpus.memos.find((m) => m.id === "m37"));

for (const id of LONG_MEMO_IDS) {
  const memo = corpus.memos.find((m) => m.id === id);
  assert.ok(memo, id);
  assert.ok(memo.text.length > 80, `${id} should be a longer dump`);
}

const empty = rankHeuristic("   ", corpus.memos);
assert.equal(empty.ok, false);

const food = rankHeuristic("편의점 삼각김밥이랑 바나나우유로 저녁 때움.", corpus.memos);
assert.equal(food.ok, true);
assert.equal(food.method, "heuristic");
assert.ok(food.all.length >= 40);
assert.equal(
  food.all.some((row) => row.id === "m29"),
  false,
  "exact self match is excluded"
);
assert.ok(
  food.all.some((row) => row.id === "m31"),
  "m31 stays a first-class pool item"
);
assert.ok(
  food.all.some((row) => row.id === "m32"),
  "m32 stays a first-class pool item"
);
const topFoodIds = food.ranked.slice(0, 8).map((row) => row.id);
assert.ok(
  topFoodIds.includes("m31") || topFoodIds.includes("m32") || food.all.find((r) => r.id === "m31").score > 0,
  "multi-topic dumps can overlap food queries"
);

const laundry = rankHeuristic("오늘 세탁기 돌리고 건조기까지. 흐린 날이라 빨래가 안 마른다.", corpus.memos);
assert.equal(
  laundry.all.some((row) => row.id === "m27"),
  false
);
const laundryHits = laundry.ranked.filter((row) => row.score > 0).map((row) => row.id);
assert.ok(laundryHits.includes("m08") || laundryHits.includes("m31"));

const poolOnly = excludeSelf(corpus.memos[0].text, corpus.memos);
assert.equal(poolOnly.length, 40);
assert.equal(
  poolOnly.some((m) => m.id === "m01"),
  false
);

const request = buildRelatednessRequest("알람을 세 개 맞춰도 결국 스누즈만 누른다.", [
  { id: "m33", text: corpus.memos.find((m) => m.id === "m33").text },
  { id: "m02", text: corpus.memos.find((m) => m.id === "m02").text },
]);
assert.equal(request.model, "jev-latest");
assert.equal(request.state.query_memo.includes("스누즈"), true);
assert.equal(request.questions.m33.type, "noul");
assert.equal(request.questions.m02.type, "noul");
assert.ok(request.questions.m33.criteria.true);
assert.ok(request.questions.m33.criteria.false);

const notJev = parseRelatednessAnswers({ suggestions: [{ id: "m01", score: 0.9 }] }, [
  { id: "m01", text: "x" },
]);
assert.equal(notJev.ok, false);

const canned = parseRelatednessAnswers(
  { model: "mock", answers: { m01: { type: "choice", choice: "yes" } } },
  [{ id: "m01", text: "x" }]
);
assert.equal(canned.ok, false);

const liveShape = parseRelatednessAnswers(
  {
    model: "jev-1.13.0",
    answers: {
      m33: { type: "noul", noul: 0.81 },
      m02: { type: "noul", noul: 0.04 },
    },
  },
  [
    { id: "m33", text: "long dump" },
    { id: "m02", text: "oil" },
  ]
);
assert.equal(liveShape.ok, true);
assert.equal(liveShape.method, "live_jev");
assert.equal(liveShape.ranked[0].id, "m33");
assert.equal(liveShape.ranked[0].rank, 1);
assert.equal(liveShape.ranked[0].score, 0.81);
assert.equal(liveShape.model, "jev-1.13.0");

const missingAnswer = parseRelatednessAnswers(
  { answers: { m33: { type: "noul", noul: 0.5 } } },
  [
    { id: "m33", text: "a" },
    { id: "m02", text: "b" },
  ]
);
assert.equal(missingAnswer.ok, false);

const entry = makeEvalEntry({
  query: "테스트 쿼리",
  method: "heuristic",
  ranked: food.ranked.slice(0, 3),
});
assert.equal(entry.kind, "related_run");
assert.equal(entry.method, "heuristic");
assert.equal(entry.query, "테스트 쿼리");
assert.ok(entry.ts);
assert.equal(entry.ranked[0].rank, 1);
assert.equal(entry.ratings[entry.ranked[0].id], null);
setEvalRating(entry, entry.ranked[0].id, "yes");
setEvalRating(entry, entry.ranked[1].id, "no");
assert.equal(entry.ratings[entry.ranked[0].id], "yes");
assert.equal(entry.ratings[entry.ranked[1].id], "no");

const json = JSON.parse(toEvalJson([entry]));
assert.equal(json[0].method, "heuristic");
const jsonl = toEvalJsonl([entry, entry]);
assert.equal(jsonl.trim().split("\n").length, 2);

const tied = rankHeuristic("Core ML", [
  { id: "m01", text: "core ml notes" },
  { id: "m02", text: "Core ML notes" },
]);
assert.equal(tied.ranked.length, 2);
assert.equal(tied.ranked[0].score, tied.ranked[1].score);
assert.equal(tied.ranked[0].id, "m02");
assert.equal(tied.ranked[1].id, "m01");
assert.deepEqual(tied.ranked[0].phraseHits, ["Core ML"]);
assert.deepEqual(tied.ranked[1].phraseHits, []);
assert.equal(tied.ranked[0].why.includes("names: Core ML"), true);

const tiedExport = makeEvalEntry({
  query: "Core ML",
  method: "heuristic",
  ranked: tied.ranked,
});
assert.deepEqual(tiedExport.ranked[0].phraseHits, ["Core ML"]);
assert.deepEqual(tiedExport.ranked[1].phraseHits, []);
const liveExport = makeEvalEntry({
  query: "q",
  method: "live_jev",
  ranked: liveShape.ranked,
});
assert.deepEqual(liveExport.ranked[0].phraseHits, []);
assert.deepEqual(liveExport.ranked[1].phraseHits, []);

const phraseSurfaces = {
  m02: ["공임나라"],
  m11: ["경희대"],
  m32: ["Bookclub", "AWAIT_USER", "Writing Helper", "X Digger"],
  m33: ["Core ML", "Mac", "Neural Engine", "Vercel", "URL", "README"],
  m36: ["TypeSafe Jev"],
  m37: ["금오산", "학생회관", "김자영", "한경국립대", "충남대", "전남대", "김현철", "경북대", "서울과기대", "정송철"],
  m38: ["HDMI", "박지훈", "박지현", "김수연", "이도윤"],
  m39: ["Frother", "USB"],
  m40: ["학생회관", "최유진", "한도겸"],
};
for (const memo of corpus.memos) {
  assert.deepEqual(
    extractPhrases(memo.text).map((phrase) => phrase.surface),
    phraseSurfaces[memo.id] || [],
    memo.id
  );
}

const m33 = corpus.memos.find((memo) => memo.id === "m33");
const m33Phrases = extractPhrases(m33.text);
const coreMl = m33Phrases.find((phrase) => phrase.surface === "Core ML");
assert.deepEqual(
  { surface: coreMl.surface, key: coreMl.key, kind: coreMl.kind },
  { surface: "Core ML", key: "core ml", kind: "latin" }
);
assert.equal(coreMl.end - coreMl.start, 7);
assert.equal(m33Phrases.some((phrase) => phrase.surface === "Day0"), false);
assert.equal(m33Phrases.some((phrase) => phrase.surface === "ML"), false);

const m37Surfaces = extractPhrases(corpus.memos.find((memo) => memo.id === "m37").text).map(
  (phrase) => phrase.surface
);
assert.equal(m37Surfaces.includes("G437"), false);
assert.equal(m37Surfaces.includes("신청자"), false);
assert.equal(m37Surfaces.includes("이슈가"), false);
assert.equal(m37Surfaces.includes("이름표"), false);

const keptOnce = keepRelatedRuns([
  { kind: "related_run", id: "a" },
  { id: "b" },
  { kind: "theme_chunk", id: "c" },
]);
assert.deepEqual(keptOnce, [
  { kind: "related_run", id: "a" },
  { id: "b" },
]);
assert.deepEqual(keepRelatedRuns(keptOnce), keptOnce);

assert.equal(require("../relatedness").buildThemeChunkRequest, undefined);

console.log("relatedness.test.cjs passed");
