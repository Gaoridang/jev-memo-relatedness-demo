const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  EXPECTED_COUNT,
  JEV_MODEL,
  THEME_HEURISTIC_LOW,
  THEME_HEURISTIC_DRIFT,
  THEME_LIVE_LOW,
  assertCorpus,
  splitBlocks,
  countNonEmptyBlocks,
  activeChunkAt,
  proposeThemesHeuristic,
  matchFixedThemeVocab,
  buildThemeTitleBody,
  parseThemeTitleResponse,
  isChunkPrefixLabel,
  buildThemeChunkRequest,
  parseThemeChunkAnswers,
  buildThemeChips,
  proposePasteStructure,
  makeEvalEntry,
  makeThemeChunkEvalEntry,
  setThemeChunkChoice,
  themeDriftFingerprint,
  createPadSession,
  moveActiveChunkToNewPad,
  mergePasteCards,
  movePasteCard,
  detachPasteCard,
  padsFromPasteStructure,
  toEvalJson,
  toEvalJsonl,
} = require("../shared");

const fixturePath = path.join(__dirname, "..", "fixtures", "korean-memo-relatedness-30.json");
const corpus = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const checked = assertCorpus(corpus);
assert.equal(checked.ok, true, checked.error);
assert.equal(EXPECTED_COUNT, 41);
assert.equal(corpus.count, 41);
assert.ok(corpus.memos.find((m) => m.id === "m37"));

const twoBlocks = "첫 블록입니다.\n\n둘째 블록입니다.";
const blocks = splitBlocks(twoBlocks);
assert.equal(blocks.length, 2);
assert.equal(blocks[0].id, "b01");
assert.equal(blocks[0].text, "첫 블록입니다.");
assert.equal(blocks[0].start, 0);
assert.equal(blocks[0].end, 8);
assert.equal(blocks[1].id, "b02");
assert.equal(blocks[1].text, "둘째 블록입니다.");
assert.equal(blocks[1].start, 10);
assert.equal(blocks[1].end, 19);
assert.equal(countNonEmptyBlocks(twoBlocks), 2);

const inSecond = activeChunkAt(twoBlocks, 12);
assert.equal(inSecond.active.id, "b02");
assert.equal(inSecond.active.text, "둘째 블록입니다.");
assert.deepEqual(inSecond.earlier, ["첫 블록입니다."]);

const trailing = `${twoBlocks}\n\n`;
const atEnd = activeChunkAt(trailing, trailing.length);
assert.equal(atEnd.active.id, "b02");
assert.equal(atEnd.active.text, "둘째 블록입니다.");

const reproPhrase = "일단 집에가서 빨래를 해야함";
const fragment = "일단 집에가서 빨래를";

const fresh = proposeThemesHeuristic(reproPhrase, [], []);
assert.equal(fresh.ok, true);
assert.equal(fresh.method, "heuristic");
assert.equal(fresh.drift, false);
const freshLabels = buildThemeChips(fresh).map((c) => c.label);
assert.ok(!freshLabels.includes(fragment), `chip must not be fragment ${fragment}, got ${freshLabels.join("|")}`);
assert.ok(
  freshLabels.includes("집안일"),
  `repro phrase should map to vocab 집안일, got ${freshLabels.join("|")}`
);
assert.ok(
  !fresh.themes.some((t) => typeof t.label === "string" && t.label.includes("일단")),
  "heuristic themes must not use chunk-prefix invent labels"
);

const snack = proposeThemesHeuristic("삼각김밥이랑 바나나우유로 저녁 때움.", [], []);
assert.equal(snack.ok, true);
const snackLabels = buildThemeChips(snack).map((c) => c.label);
assert.ok(!snackLabels.some((label) => label.includes("삼각김밥")), `got ${snackLabels.join("|")}`);
assert.ok(
  snackLabels.includes("기타") && snackLabels.includes("없음"),
  `unmatched snack should only offer 기타/없음 until OpenAI invents, got ${snackLabels.join("|")}`
);
assert.equal(snack.needsTitle, true);
assert.equal(snack.lowConfidence, true);

const sameTheme = proposeThemesHeuristic(
  "오늘 세탁기 돌리고 건조기까지.",
  [{ id: "t1", label: "세탁" }],
  ["운동 많이 해서 땀냄새가 난다. 세탁 60도로 돌리니 냄새가 안 남는다."]
);
assert.equal(sameTheme.drift, false);
assert.equal(sameTheme.lowConfidence, false);
assert.equal(sameTheme.themes[0].label, "세탁");
assert.equal(sameTheme.needsTitle, false);
assert.ok(sameTheme.confidence >= THEME_HEURISTIC_LOW);

const drifted = proposeThemesHeuristic(
  "엔진오일 갈았다. 공임나라에서 맡김.",
  [{ id: "t1", label: "세탁" }],
  ["오늘 세탁기 돌리고 건조기까지."]
);
assert.equal(drifted.drift, true);
assert.equal(drifted.lowConfidence, true);
assert.equal(drifted.needsTitle, true);
assert.ok(!drifted.themes.some((t) => String(t.label || "").includes("엔진오일")));
assert.ok(drifted.confidence < THEME_HEURISTIC_DRIFT);

const lowChips = buildThemeChips(snack);
assert.deepEqual(
  lowChips.map((c) => c.kind),
  ["기타", "없음"]
);
assert.equal(lowChips[0].label, "기타");
assert.equal(lowChips[1].label, "없음");

const driftChips = buildThemeChips(drifted);
assert.equal(driftChips.some((c) => c.kind === "새메모"), true);
assert.equal(driftChips.some((c) => c.label === "새 메모로 열기"), true);
assert.equal(driftChips.some((c) => c.kind === "기타"), true);
assert.ok(!driftChips.some((c) => String(c.label).includes("엔진오일")));

const request = buildThemeChunkRequest("엔진오일 갈았다.", [{ id: "t1", label: "세탁" }]);
assert.equal(request.model, JEV_MODEL);
assert.equal(request.model, "jev-latest");
assert.equal(request.state.active_chunk, "엔진오일 갈았다.");
assert.deepEqual(request.state.prior_themes, [{ id: "t1", label: "세탁" }]);
assert.equal(request.questions.match_t1.type, "noul");
assert.equal(request.questions.new_topic.type, "noul");
assert.equal(request.questions.none_topic.type, "noul");

const notJev = parseThemeChunkAnswers({ suggestions: [{ id: "t1", score: 0.9 }] }, [
  { id: "t1", label: "세탁" },
]);
assert.equal(notJev.ok, false);

const canned = parseThemeChunkAnswers(
  { answers: { match_t1: { type: "choice", choice: "yes" }, new_topic: { type: "noul", noul: 0.2 } } },
  [{ id: "t1", label: "세탁" }]
);
assert.equal(canned.ok, false);

const liveDrift = parseThemeChunkAnswers(
  {
    model: "jev-1.13.0",
    answers: {
      match_t1: { type: "noul", noul: 0.12 },
      new_topic: { type: "noul", noul: 0.81 },
      none_topic: { type: "noul", noul: 0.04 },
    },
  },
  [{ id: "t1", label: "세탁" }],
  "엔진오일 갈았다"
);
assert.equal(liveDrift.ok, true);
assert.equal(liveDrift.method, "live_jev");
assert.equal(liveDrift.model, "jev-1.13.0");
assert.equal(liveDrift.needsTitle, true);
assert.equal(liveDrift.newScore, 0.81);
assert.ok(!liveDrift.themes.some((t) => String(t.label || "").includes("엔진오일")));
assert.equal(liveDrift.drift, true);
assert.ok(liveDrift.confidence >= THEME_LIVE_LOW);

const liveLow = parseThemeChunkAnswers(
  {
    answers: {
      match_t1: { type: "noul", noul: 0.2 },
      new_topic: { type: "noul", noul: 0.3 },
      none_topic: { type: "noul", noul: 0.11 },
    },
  },
  [{ id: "t1", label: "세탁" }],
  "249150"
);
assert.equal(liveLow.ok, true);
assert.equal(liveLow.confidence, 0.2);
assert.equal(liveLow.lowConfidence, true);
assert.equal(liveLow.themes[0].id, "t1");
assert.deepEqual(
  buildThemeChips(liveLow).map((c) => c.kind),
  ["theme", "기타", "없음"]
);

const missingNew = parseThemeChunkAnswers(
  { answers: { match_t1: { type: "noul", noul: 0.5 }, none_topic: { type: "noul", noul: 0.1 } } },
  [{ id: "t1", label: "세탁" }]
);
assert.equal(missingNew.ok, false);

const session = createPadSession({ pad: { id: "p01", text: "AAA 첫 메모\n\nBBB 새 주제", caret: 16 } });
const splitAt = activeChunkAt(session.pads[0].text, 16);
assert.equal(splitAt.active.text, "BBB 새 주제");
moveActiveChunkToNewPad(session, splitAt.active, "p02");
assert.equal(session.activePadId, "p02");
assert.equal(session.pads[0].text, "AAA 첫 메모");
assert.equal(session.pads[1].id, "p02");
assert.equal(session.pads[1].text, "BBB 새 주제");

const fpA = themeDriftFingerprint("엔진오일 갈았다.", ["세탁"]);
const fpB = themeDriftFingerprint("엔진오일 갈았다.", ["세탁"]);
const fpC = themeDriftFingerprint("엔진오일 갈았다 다시.", ["세탁"]);
assert.equal(fpA, fpB);
assert.notEqual(fpA, fpC);

const pasteText = "금오산 케이블카 할인 여부\n\n숙박 7만\n\n엔진오일 갈았다";
assert.equal(countNonEmptyBlocks(pasteText), 3);
const workbench = proposePasteStructure(pasteText);
assert.equal(workbench.blockCount, 3);
assert.equal(workbench.themes.length >= 2, true);
assert.ok(!String(workbench.themes[0].label).includes("금오산 케이블카 할인"));
assert.ok(
  workbench.themes[0].label === "기타" ||
    workbench.themes[0].label === "여행" ||
    workbench.themes[0].label.length <= 8
);
assert.equal(workbench.themes[0].cards[0].text, "금오산 케이블카 할인 여부");

const merged = proposePasteStructure(pasteText);
mergePasteCards(merged, merged.themes[1].cards[0].id, merged.themes[0].cards[0].id);
assert.equal(
  merged.themes[0].cards[0].text,
  "금오산 케이블카 할인 여부\n\n숙박 7만"
);

const moved = proposePasteStructure(pasteText);
const srcCard = moved.themes[0].cards[0];
const destTheme = moved.themes[moved.themes.length - 1];
movePasteCard(moved, srcCard.id, destTheme.id);
assert.equal(
  destTheme.cards.some((card) => card.id === srcCard.id),
  true
);

const detached = {
  themes: [
    {
      id: "theme_1",
      label: "세탁",
      cards: [
        { id: "b01", text: "세탁기 돌림" },
        { id: "b02", text: "수건 추가" },
      ],
    },
  ],
  blockCount: 2,
};
detachPasteCard(detached, "b02");
assert.equal(detached.themes.length, 2);
assert.equal(detached.themes[0].cards.length, 1);
assert.equal(detached.themes[0].cards[0].id, "b01");
assert.equal(detached.themes[1].id, "theme_2");
assert.ok(!String(detached.themes[1].label).includes("수건 추가"));
assert.equal(detached.themes[1].cards[0].id, "b02");

const confirmed = padsFromPasteStructure(workbench, 3);
assert.equal(confirmed[0].id, "p03");
assert.ok(confirmed[0].assignedThemeLabel);
assert.ok(!String(confirmed[0].assignedThemeLabel).includes("금오산 케이블카 할인"));
assert.equal(confirmed[0].text.includes("금오산"), true);

const themeEntry = makeThemeChunkEvalEntry({
  chunk: "엔진오일 갈았다.",
  proposals: driftChips,
  confidence: 0,
  method: "heuristic",
  chipChosen: null,
  newMemoNudge: null,
  padId: "p01",
  activeChunkId: "b02",
});
assert.equal(themeEntry.kind, "theme_chunk");
assert.equal(themeEntry.chunk, "엔진오일 갈았다.");
assert.equal(themeEntry.chipChosen, null);
assert.equal(themeEntry.newMemoNudge, null);
assert.equal(themeEntry.padId, "p01");
assert.equal(themeEntry.activeChunkId, "b02");
assert.equal(themeEntry.method, "heuristic");
assert.equal(themeEntry.confidence, 0);
setThemeChunkChoice(themeEntry, "새 메모로 열기", "yes");
assert.equal(themeEntry.chipChosen, "새 메모로 열기");
assert.equal(themeEntry.newMemoNudge, "yes");

const related = makeEvalEntry({
  query: "테스트 쿼리",
  method: "heuristic",
  ranked: [{ id: "m01", rank: 1, score: 0.1, why: "x" }],
});
assert.equal(related.kind, "related_run");
const mixed = JSON.parse(toEvalJson([related, themeEntry]));
assert.equal(mixed[0].kind, "related_run");
assert.equal(mixed[1].kind, "theme_chunk");
assert.equal(mixed[1].newMemoNudge, "yes");
const jsonl = toEvalJsonl([related, themeEntry]);
assert.equal(jsonl.trim().split("\n").length, 2);

const vocabHit = matchFixedThemeVocab("일단 집에가서 빨래를 해야함");
assert.equal(vocabHit.label, "집안일");
assert.ok(vocabHit.score > 0);

assert.equal(isChunkPrefixLabel("일단 집에가서 빨래를", "일단 집에가서 빨래를 해야함"), true);
assert.equal(isChunkPrefixLabel("집안일", "일단 집에가서 빨래를 해야함"), false);

const titleBody = buildThemeTitleBody("엔진오일 갈았다. 공임나라에서 맡김.", ["세탁", "집안일"]);
assert.equal(titleBody.model, "gpt-5.6-sol");
assert.equal(titleBody.reasoning_effort, "none");
assert.equal(titleBody.response_format.type, "json_object");
assert.ok(titleBody.messages[0].content.includes("short theme title"));

const parsedTitle = parseThemeTitleResponse({
  choices: [{ message: { content: '{"title":"차량정비","reason":"oil change"}' } }],
});
assert.equal(parsedTitle.ok, true);
assert.equal(parsedTitle.title, "차량정비");

const badTitle = parseThemeTitleResponse({
  choices: [{ message: { content: '{"title":"일단 집에가서 빨래를","reason":"x"}' } }],
  _chunk: "일단 집에가서 빨래를 해야함",
});
assert.equal(badTitle.ok, false);

console.log("theme-chunk.test.cjs passed");
