const assert = require("node:assert/strict");
const {
  decideOffer,
  proposeTheme,
  commitPick,
  openParentMenu,
  themeView,
  projectThemeLog,
  initialTheme,
  choiceLabel,
  classifyChunkTags,
  fallbackOffer,
  TAG_TOP,
  TAG_MARGIN,
  TAG_AUTO,
} = require("../theme-offer");

function input(chunkText, extra) {
  return {
    chunkText,
    judged: {},
    priors: [],
    earlierTexts: [],
    ...(extra || {}),
  };
}

const digits = decideOffer(input("249150"));
assert.equal(digits.kind, "quiet");
const digitView = themeView(openThemeFrom(digits));
assert.deepEqual(
  digitView.chips.map((chip) => chip.label),
  []
);
assert.equal(digitView.kind, "quiet");
assert.equal(digitView.prompt, null);

const onlyNumber = decideOffer(input("137"));
assert.equal(onlyNumber.kind, "quiet");
assert.deepEqual(
  themeView(openThemeFrom(onlyNumber)).chips.map((chip) => chip.label),
  []
);

function liveThemes(themes) {
  return { method: "live_jev", ok: true, themes };
}

const starbucks = decideOffer(
  input("스타벅스에서 아메리카노", {
    judged: liveThemes([
      { label: "카페", score: 0.6 },
      { label: "업무", score: 0.1 },
      { label: "행사·협의", score: 0.05 },
    ]),
  })
);
assert.equal(starbucks.kind, "children");
assert.equal(starbucks.parentId, "life");
assert.equal(starbucks.childLabels.includes("카페"), true);
assert.equal(starbucks.childLabels.includes("식사"), false);

const drinks = "오후 업무 끝나고 커피";
const drinkOffer = decideOffer(
  input(drinks, {
    judged: liveThemes([
      { label: "업무", score: 0.6 },
      { label: "개인·생활", score: 0.55 },
      { label: "행사·협의", score: 0.1 },
    ]),
  })
);
assert.equal(drinkOffer.kind, "ask");
assert.equal(drinkOffer.prompt, "어느 쪽으로 둘까요?");
assert.equal(drinkOffer.options.length, 2);
assert.deepEqual(drinkOffer.options[0].choice, { kind: "parent", id: "work" });
assert.deepEqual(drinkOffer.options[1].choice, { kind: "parent", id: "life" });
assert.equal("title" in drinkOffer, false);
const drinkTheme = openThemeFrom(drinkOffer);
const drinkLog = projectThemeLog({ theme: drinkTheme, ratings: {}, split: { kind: "none" } });
assert.equal(drinkLog.inventedLabelAfter, null);
assert.equal(drinkLog.stickyLabel, null);
assert.equal(drinkLog.needsTitle, false);
assert.equal(drinkLog.askPrompt, "어느 쪽으로 둘까요?");

let picked = commitPick(drinkTheme, { kind: "parent", id: "work" }, drinks);
assert.equal(choiceLabel(picked), "업무");
assert.equal(picked.phase, "committed");
assert.notEqual(picked.offer.kind, "ask");
const pickedLog = projectThemeLog({ theme: picked, ratings: {}, split: { kind: "none" } });
assert.equal(pickedLog.stickyLabel, "업무");
assert.equal(pickedLog.inventedLabelAfter, "업무");
const kept = proposeTheme(
  picked,
  input(drinks, { judged: liveThemes([{ label: "카페", score: 0.99 }]) })
);
assert.equal(choiceLabel(kept), "업무");
assert.equal(kept.phase, "committed");
assert.equal(kept.choice.id, "work");

const codes = decideOffer(
  input("G437 품의서와 137 견적", {
    judged: liveThemes([{ label: "공사품의", score: 0.7 }, { label: "개인·생활", score: 0.1 }]),
  })
);
assert.equal(codes.kind, "children");
assert.equal(codes.parentId, "work");
assert.equal(codes.childLabels.includes("공사품의"), true);
assert.equal(codes.childLabels.includes("G437"), false);
assert.equal(codes.childLabels.includes("137"), false);

const cableOpen = decideOffer(
  input("금오산 케이블카 할인", {
    priors: [{ label: "업무" }],
    judged: liveThemes([{ label: "여행", score: 0.8 }, { label: "개인·생활", score: 0.1 }]),
  })
);
assert.equal(cableOpen.kind, "children");
assert.equal(cableOpen.parentId, "work");
assert.equal(cableOpen.childLabels.includes("여행"), true);

const cable = "금오산 케이블카 할인";
let cableTheme = commitPick(
  openParentMenu(initialTheme()),
  { kind: "parent", id: "work" },
  cable
);
assert.equal(choiceLabel(cableTheme), "업무");
cableTheme = proposeTheme(
  cableTheme,
  input(cable, { judged: liveThemes([{ label: "여행", score: 0.99 }]) })
);
assert.equal(choiceLabel(cableTheme), "업무");
const cableLog = projectThemeLog({ theme: cableTheme, ratings: {}, split: { kind: "none" } });
assert.equal(cableLog.stickyLabel, "업무");
assert.equal(cableLog.inventedLabelAfter, "업무");

const other = openThemeFrom(decideOffer(input("스타벅스에서 아메리카노", { judged: liveThemes([{ label: "카페", score: 0.6 }]) })));
const otherLog = projectThemeLog({ theme: other, ratings: {}, split: { kind: "none" } });
assert.equal(otherLog.stickyLabel, null);
assert.equal(otherLog.inventedLabelAfter, null);
assert.equal(cableLog.inventedLabelAfter, "업무");

const noneTheme = commitPick(openThemeFrom(fallbackOffer()), { kind: "fallback", label: "없음" }, "249150");
assert.equal(choiceLabel(noneTheme), "없음");
const noneLog = projectThemeLog({ theme: noneTheme, ratings: {}, split: { kind: "none" } });
assert.equal(noneLog.stickyLabel, "없음");
assert.equal(noneLog.inventedLabelAfter, "없음");

const laundry = classifyChunkTags(
  input("오늘 세탁기 돌리고 건조기까지.", {
    judged: liveThemes([{ label: "집안일", score: 0.8 }, { label: "업무", score: 0.1 }]),
  })
);
assert.equal(laundry.disposition, "auto");
assert.equal(laundry.top, 0.8);
assert.equal(laundry.margin >= TAG_MARGIN, true);
assert.equal(laundry.offer.kind, "children");
assert.equal(laundry.offer.childLabels.includes("집안일"), true);

const siblings = classifyChunkTags(
  input("빨래하고 점심으로 김밥 먹었다", {
    judged: liveThemes([
      { label: "집안일", score: 0.7 },
      { label: "식사", score: 0.62 },
      { label: "업무", score: 0.05 },
    ]),
  })
);
assert.equal(siblings.disposition, "auto");
assert.equal(siblings.offer.kind, "children");
assert.equal(siblings.offer.childLabels.includes("집안일"), true);
assert.equal(siblings.offer.childLabels.includes("식사"), true);

const oneHit = classifyChunkTags(
  input("스타벅스에서 아메리카노", {
    judged: liveThemes([{ label: "카페", score: 0.6 }, { label: "업무", score: 0.1 }]),
  })
);
assert.equal(oneHit.disposition, "ready");
assert.equal(oneHit.top, 0.6);
assert.equal(oneHit.top >= TAG_TOP, true);
assert.equal(oneHit.top < TAG_AUTO, true);
assert.equal(oneHit.offer.kind, "children");

const mixed = classifyChunkTags(
  input("팀 미팅 끝나고 빨래를 돌렸다", {
    judged: liveThemes([
      { label: "미팅", score: 0.6 },
      { label: "집안일", score: 0.55 },
      { label: "행사·협의", score: 0.05 },
    ]),
  })
);
assert.equal(mixed.disposition, "ask");
assert.equal(mixed.top, 0.6);
assert.equal(mixed.second, 0.55);
assert.equal(mixed.margin < TAG_MARGIN, true);
assert.equal(mixed.offer.kind, "ask");
assert.equal(mixed.offer.prompt, "어느 쪽으로 둘까요?");

const avengersBare = classifyChunkTags(input("어벤저스 보기"));
assert.equal(avengersBare.disposition, "quiet");
assert.equal(avengersBare.top, 0);
assert.equal(avengersBare.margin, 0);
assert.equal(avengersBare.offer.kind, "quiet");

const starbucksBare = classifyChunkTags(input("스타벅스에서 아메리카노"));
assert.equal(starbucksBare.disposition, "quiet");
assert.equal(starbucksBare.top, 0);
assert.equal(starbucksBare.offer.kind, "quiet");

const avengersLive = classifyChunkTags(
  input("어벤저스 보기", {
    judged: liveThemes([
      { label: "카페", score: 0.6 },
      { label: "개인·생활", score: 0.2 },
      { label: "업무", score: 0.1 },
      { label: "행사·협의", score: 0.05 },
    ]),
  })
);
assert.equal(avengersLive.top, 0.6);
assert.equal(avengersLive.margin, 0.5);
assert.equal(avengersLive.disposition, "ready");
assert.equal(avengersLive.offer.kind, "children");
assert.equal(avengersLive.offer.parentId, "life");
assert.equal(avengersLive.offer.childLabels.includes("카페"), true);
assert.equal(avengersLive.choice.kind, "child");
assert.equal(avengersLive.choice.label, "카페");

const avengersUnmapped = classifyChunkTags(
  input("어벤저스 보기", {
    judged: liveThemes([{ label: "영화", score: 0.88 }]),
  })
);
assert.equal(avengersUnmapped.disposition, "quiet");
assert.equal(avengersUnmapped.top, 0);
assert.equal(avengersUnmapped.offer.kind, "quiet");

const jevDown = classifyChunkTags(
  input("스타벅스에서 아메리카노", {
    judged: { method: "live_jev", error: "HTTP 500", themes: [] },
  })
);
assert.equal(jevDown.disposition, "quiet");
assert.equal(jevDown.top, 0);

const halted = classifyChunkTags(
  input("아무 말", { judged: liveThemes([{ label: "카페", score: 0.13 }]) })
);
assert.equal(halted.disposition, "quiet");
assert.equal(halted.offer.kind, "quiet");
assert.deepEqual(themeView(openThemeFrom(halted.offer)).chips, []);
assert.equal(halted.top < TAG_TOP, true);

const quietLog = projectThemeLog({
  theme: openThemeFrom(halted.offer),
  ratings: {},
  split: { kind: "none" },
});
assert.deepEqual(quietLog.proposals, []);

function openThemeFrom(offer) {
  return require("../theme-offer").openTheme(offer);
}

console.log("theme-offer.test.cjs passed");
