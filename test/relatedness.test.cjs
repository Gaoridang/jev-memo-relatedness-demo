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
  toEvalJson,
  toEvalJsonl,
  excludeSelf,
} = require("../shared");

const fixturePath = path.join(__dirname, "..", "fixtures", "korean-memo-relatedness-30.json");
const corpus = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

const checked = assertCorpus(corpus);
assert.equal(checked.ok, true, checked.error);
assert.equal(corpus.ground_truth, null);
assert.equal(corpus.count, 36);
assert.equal(corpus.memos.length, 36);
assert.deepEqual(
  corpus.memos.map((m) => m.id),
  EXPECTED_IDS
);
assert.equal(EXPECTED_COUNT, 36);
assert.deepEqual(LONG_MEMO_IDS, ["m31", "m32", "m33", "m34", "m35", "m36"]);
assert.ok(!("clusters" in corpus));
assert.ok(!("expected_pairs" in corpus));

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
assert.ok(food.all.length >= 35);
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
assert.equal(poolOnly.length, 35);
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

console.log("relatedness.test.cjs passed");
