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
  classifyChunkSplit,
  projectChunkBoard,
  applyChunkJudgment,
  visibleChunkTags,
  rateChunkTag,
  setChunkShouldNotSplit,
  createPad,
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
  beginNewMemoDraft,
  commitNewMemoDraft,
  openThemeChunkEntry,
  mergePasteCards,
  movePasteCard,
  detachPasteCard,
  padsFromPasteStructure,
  toEvalJson,
  toEvalJsonl,
  extractPhrases,
  emptyChunkRecord,
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
assert.ok(snackLabels.includes("식사"), `snack should map to vocab 식사, got ${snackLabels.join("|")}`);
assert.equal(snack.needsTitle, false);

const obscure = proposeThemesHeuristic("249150", [], []);
assert.equal(obscure.needsTitle, true);
assert.equal(obscure.lowConfidence, true);
assert.deepEqual(
  buildThemeChips(obscure).map((c) => c.kind),
  ["기타", "없음"]
);

const sameTheme = proposeThemesHeuristic(
  "오늘 세탁기 돌리고 건조기까지.",
  [{ id: "t1", label: "세탁" }],
  ["운동 많이 해서 땀냄새가 난다. 세탁 60도로 돌리니 냄새가 안 남는다."]
);
assert.equal(sameTheme.drift, false);
assert.equal(sameTheme.lowConfidence, false);
assert.ok(
  sameTheme.themes.some((t) => t.label === "세탁" && t.score >= THEME_HEURISTIC_LOW),
  "prior 세탁 should remain a strong match"
);
assert.ok(
  sameTheme.themes.some((t) => t.label === "집안일"),
  "vocab should also propose 집안일 for laundry keywords"
);
assert.equal(sameTheme.needsTitle, false);
assert.ok(sameTheme.confidence >= THEME_HEURISTIC_LOW);

const drifted = proposeThemesHeuristic(
  "엔진오일 갈았다. 공임나라에서 맡김.",
  [{ id: "t1", label: "세탁" }],
  ["오늘 세탁기 돌리고 건조기까지."]
);
assert.equal(drifted.drift, true);
assert.ok(drifted.themes.some((t) => t.label === "차량"));
assert.ok(!drifted.themes.some((t) => String(t.label || "").includes("엔진오일")));
assert.equal(drifted.needsTitle, false);
const oilChips = buildThemeChips(drifted);
assert.ok(oilChips.some((c) => c.label === "차량"));
assert.ok(oilChips.some((c) => c.kind === "새메모"));
assert.ok(!oilChips.some((c) => String(c.label).includes("엔진오일")));

const lowChips = buildThemeChips(obscure);
assert.deepEqual(
  lowChips.map((c) => c.kind),
  ["기타", "없음"]
);
assert.equal(lowChips[0].label, "기타");
assert.equal(lowChips[1].label, "없음");

const trueDrift = proposeThemesHeuristic(
  "오늘 팀 미팅에서 로드맵 논의.",
  [{ id: "t1", label: "세탁" }],
  ["오늘 세탁기 돌리고 건조기까지."]
);
assert.equal(trueDrift.drift, true);
const driftChips = buildThemeChips(trueDrift);
assert.equal(driftChips.some((c) => c.kind === "새메모"), true);
assert.equal(driftChips.some((c) => c.label === "새 메모로 열기"), true);
assert.ok(driftChips.some((c) => c.label === "미팅"));
assert.equal(driftChips.some((c) => c.kind === "기타"), false);

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
assert.equal(liveDrift.needsTitle, false);
assert.ok(liveDrift.themes.some((t) => t.label === "차량"));
assert.equal(liveDrift.newScore, 0.81);
assert.ok(!liveDrift.themes.some((t) => String(t.label || "").includes("엔진오일")));
assert.equal(liveDrift.drift, true);
assert.ok(liveDrift.confidence >= THEME_LIVE_LOW);

const liveInvent = parseThemeChunkAnswers(
  {
    model: "jev-1.13.0",
    answers: {
      match_t1: { type: "noul", noul: 0.1 },
      new_topic: { type: "noul", noul: 0.88 },
      none_topic: { type: "noul", noul: 0.05 },
    },
  },
  [{ id: "t1", label: "세탁" }],
  "양자내성 암호 키 교환 메모"
);
assert.equal(liveInvent.needsTitle, true);
assert.ok(!liveInvent.themes.some((t) => String(t.label || "").includes("양자")));
assert.equal(liveInvent.drift, true);

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
const sourcePad = session.pads[0];
const board = projectChunkBoard(sourcePad, sourcePad.text);
const bbb = board.find((row) => row.block.text === "BBB 새 주제");
assert.equal(bbb.block.text, "BBB 새 주제");
bbb.record.stickyLabel = "세탁";
const draft = beginNewMemoDraft(session, {
  chunkKey: bbb.key,
  blockId: bbb.block.id,
  text: bbb.block.text,
});
assert.equal(draft.kind, "new-memo-draft");
assert.equal(draft.sourcePadId, "p01");
assert.equal(draft.sourceChunkKey, bbb.key);
assert.equal(draft.sourceBlockId, bbb.block.id);
assert.equal(draft.seedText, "BBB 새 주제");
assert.equal(draft.body, "BBB 새 주제");
assert.equal(draft.stickyLabel, "세탁");
assert.equal(session.pads.length, 1);
assert.equal(session.activePadId, "p01");
assert.equal(sourcePad.text, "AAA 첫 메모\n\nBBB 새 주제");
assert.equal(session.pads[0], sourcePad);
assert.equal(bbb.record.stickyLabel, "세탁");
draft.body = "BBB 고친 문단";
const committed = commitNewMemoDraft(session, draft);
assert.equal(committed.ok, true);
assert.equal(committed.padId, "p02");
assert.notEqual(committed.session, session);
assert.equal(committed.session.pads[0].text, "AAA 첫 메모");
assert.equal(committed.session.pads[0].chunkMap[bbb.key], undefined);
assert.equal(committed.session.activePadId, "p02");
assert.equal(committed.session.pads[1].text, "BBB 고친 문단");
assert.equal(committed.session.pads[1].assignedThemeLabel, "세탁");
assert.equal(committed.session.pads[1].chunkMap.c01.stickyLabel, "세탁");
assert.equal(sourcePad.text, "AAA 첫 메모\n\nBBB 새 주제");
assert.equal(bbb.record.stickyLabel, "세탁");
assert.equal(session.pads.length, 1);
const second = commitNewMemoDraft(committed.session, draft);
assert.equal(second.ok, false);
assert.equal(second.session, committed.session);
assert.equal(committed.session.pads.length, 2);
const stale = beginNewMemoDraft(session, {
  chunkKey: bbb.key,
  blockId: bbb.block.id,
  text: "BBB 다른 문장",
});
assert.equal(stale, null);
assert.equal(session.pads.length, 1);
const emptyDraft = beginNewMemoDraft(session, {
  chunkKey: bbb.key,
  blockId: bbb.block.id,
  text: "BBB 새 주제",
});
emptyDraft.body = "";
const emptyPad = commitNewMemoDraft(session, emptyDraft);
assert.equal(emptyPad.ok, true);
assert.equal(emptyPad.session.pads[1].text, "");
assert.equal(emptyPad.session.pads[0].text, "AAA 첫 메모");
assert.equal(emptyPad.session.pads[0].chunkMap[bbb.key], undefined);
assert.equal(session.pads[0].text, "AAA 첫 메모\n\nBBB 새 주제");
assert.equal(session.pads.length, 1);

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

const badTitle = parseThemeTitleResponse(
  {
    choices: [{ message: { content: '{"title":"일단 집에가서 빨래를","reason":"x"}' } }],
  },
  "일단 집에가서 빨래를 해야함"
);
assert.equal(badTitle.ok, false);

const laundry = "오늘 세탁기 돌리고 건조기까지.";
const towels = "수건이랑 걸레도 같이 넣었다";
const towelContinue = proposeThemesHeuristic(towels, [{ id: "t1", label: "세탁", sample: laundry }], [laundry]);
assert.equal(towelContinue.drift, false);
assert.equal(towelContinue.legacyWouldNudge, true);
assert.equal(towelContinue.falsePositive, true);
assert.equal(towelContinue.splitKind, "candidate");
assert.equal(buildThemeChips(towelContinue).some((chip) => chip.kind === "새메모"), false);
assert.ok(towelContinue.themes.some((theme) => theme.label === "집안일"));

const firstOfNewMemo = proposeThemesHeuristic(
  "엔진오일 갈았다. 공임나라에서 맡김.",
  [{ id: "t1", label: "세탁", sample: laundry }],
  []
);
assert.equal(firstOfNewMemo.drift, false);
assert.equal(firstOfNewMemo.splitKind, "candidate");
assert.equal(buildThemeChips(firstOfNewMemo).some((chip) => chip.kind === "새메모"), false);

const liveSameTopic = classifyChunkSplit({
  chunkText: towels,
  earlierTexts: [laundry],
  priorThemes: [{ id: "t1", label: "세탁" }],
  bestPriorMatch: 0,
  live: { newScore: 0.8, bestPriorTheme: 0.1 },
});
assert.equal(liveSameTopic.drift, false);
assert.equal(liveSameTopic.kind, "candidate");
assert.equal(liveSameTopic.legacyWouldNudge, true);

const liveOil = classifyChunkSplit({
  chunkText: "엔진오일 갈았다. 공임나라에서 맡김.",
  earlierTexts: [laundry],
  priorThemes: [{ id: "t1", label: "세탁" }],
  bestPriorMatch: 0,
  live: { newScore: 0.81, bestPriorTheme: 0.12 },
});
assert.equal(liveOil.drift, true);
assert.equal(liveOil.kind, "nudge");

const oldPad = createPad({
  id: "p01",
  text: `${laundry}\n\n${towels}`,
});
const oldRows = projectChunkBoard(oldPad, oldPad.text);
assert.equal(oldRows.length, 2);
applyChunkJudgment(oldRows[1].record, towelContinue);
oldRows[1].record.stickyLabel = "집안일";
oldRows[1].record.ratings["집안일"] = { verdict: "yes", note: "같은 빨래" };
const freshPad = createPad({ id: "p02", text: "엔진오일 갈았다." });
const freshRows = projectChunkBoard(freshPad, freshPad.text);
assert.equal(freshRows[0].record.stickyLabel, null);
assert.deepEqual(freshRows[0].record.ratings, {});
assert.equal(freshRows[0].record.proposals.length, 0);
assert.equal(oldRows[1].record.stickyLabel, "집안일");
const kept = projectChunkBoard(oldPad, `${laundry}\n\n${towels}`);
assert.equal(kept[1].key, oldRows[1].key);
assert.equal(visibleChunkTags(kept[1].record).some((tag) => tag.label === "집안일"), true);

const rated = makeThemeChunkEvalEntry({
  chunk: towels,
  proposals: buildThemeChips(towelContinue),
  confidence: towelContinue.confidence,
  method: "heuristic",
  padId: "p01",
  activeChunkId: "b02",
  chunkKey: "c02",
  splitKind: "candidate",
  legacyWouldNudge: true,
  falsePositive: true,
});
assert.equal(rated.falsePositive, true);
assert.equal(rated.shouldNotSplit, null);
rateChunkTag(rated, "child:life:집안일", "yes", "계속", "집안일");
assert.equal(rated.ratings["child:life:집안일"].verdict, "yes");
assert.equal(rated.ratings["child:life:집안일"].note, "계속");
assert.equal(rated.ratings["child:life:집안일"].label, "집안일");
assert.equal(rated.ratings["집안일"], undefined);
assert.equal(Object.keys(rated.ratings).length, 1);
assert.equal(rated.chipChosen, "집안일");
rateChunkTag(rated, "parent:life", "yes", "", "개인·생활");
rated.ratings["개인·생활"] = { verdict: "yes", note: "", label: "개인·생활" };
rateChunkTag(rated, "parent:life", "yes", "", "개인·생활");
assert.equal(rated.ratings["개인·생활"], undefined);
assert.equal(rated.ratings["parent:life"].label, "개인·생활");
assert.equal(rated.ratings["child:life:집안일"].verdict, "yes");
assert.equal(typeof rated.ts, "string");
setChunkShouldNotSplit(rated, true);
assert.equal(rated.shouldNotSplit, true);
const exportedRated = JSON.parse(toEvalJson([rated]));
assert.equal(exportedRated[0].shouldNotSplit, true);
assert.equal(toEvalJsonl([rated]).trim().split("\n").length, 1);

const partialLog = [];
openThemeChunkEntry(partialLog, {
  chunk: "협의",
  padId: "p01",
  chunkKey: "c02",
  proposals: [],
  ratings: {},
});
openThemeChunkEntry(partialLog, {
  chunk: "협의회",
  padId: "p01",
  chunkKey: "c02",
  proposals: [],
  ratings: {},
});
openThemeChunkEntry(partialLog, {
  chunk: "협의회 물품구매",
  padId: "p01",
  chunkKey: "c02",
  proposals: [{ id: "parent:event", label: "행사·협의" }],
  ratings: { "parent:event": { verdict: "yes", note: "", label: "행사·협의" } },
});
assert.equal(partialLog.length, 1);
assert.equal(partialLog[0].chunk, "협의회 물품구매");
assert.deepEqual(Object.keys(partialLog[0].ratings), ["parent:event"]);
openThemeChunkEntry(partialLog, {
  chunk: "샴푸 사기",
  padId: "p01",
  chunkKey: "c01",
  proposals: [],
  ratings: { "parent:life": { verdict: "yes", note: "", label: "개인·생활" } },
});
assert.equal(partialLog.length, 2);
assert.equal(partialLog[0].chunkKey, "c02");
assert.equal(partialLog[1].chunkKey, "c01");

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

assert.deepEqual(emptyChunkRecord("c01").phrases, []);

const storedRatings = { "parent:work": { verdict: "yes", note: "", label: "업무" } };
const entry = makeThemeChunkEvalEntry({
  chunk: m33.text,
  proposals: [],
  ratings: storedRatings,
  padId: "p01",
  chunkKey: "c01",
});
const exportedPhrases = JSON.parse(toEvalJson([entry]))[0];
assert.deepEqual(
  exportedPhrases.phrases.map((phrase) => phrase.surface),
  phraseSurfaces.m33
);
assert.equal(exportedPhrases.ratings["parent:work"].verdict, "yes");
assert.equal(Object.prototype.hasOwnProperty.call(entry.ratings, "phrases"), false);
assert.equal(Object.prototype.hasOwnProperty.call(entry.proposals, "phrases"), false);
assert.equal(entry.proposals.some((row) => row && Object.prototype.hasOwnProperty.call(row, "phrases")), false);

const phraseLog = [];
openThemeChunkEntry(phraseLog, {
  chunk: m33.text,
  proposals: [],
  ratings: storedRatings,
  padId: "p01",
  chunkKey: "c01",
});
assert.deepEqual(
  phraseLog[0].phrases.map((phrase) => phrase.surface),
  phraseSurfaces.m33
);
openThemeChunkEntry(phraseLog, {
  chunk: "빨래만",
  proposals: [],
  ratings: storedRatings,
  padId: "p01",
  chunkKey: "c01",
  phrases: [{ surface: "stale", key: "stale", kind: "latin", start: 0, end: 5 }],
});
assert.equal(phraseLog.length, 1);
assert.deepEqual(phraseLog[0].phrases, []);
assert.deepEqual(Object.keys(phraseLog[0].ratings), ["parent:work"]);
assert.equal(phraseLog[0].ratings["parent:work"].verdict, "yes");

console.log("theme-chunk.test.cjs passed");
