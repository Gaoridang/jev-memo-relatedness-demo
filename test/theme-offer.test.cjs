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
assert.equal(digits.kind, "fallback");
const digitView = themeView(openThemeFrom(digits));
assert.deepEqual(
  digitView.chips.map((chip) => chip.label),
  ["기타", "없음"]
);
assert.equal(digitView.kind, "fallback");
assert.equal(digitView.prompt, null);

const onlyNumber = decideOffer(input("137"));
assert.equal(onlyNumber.kind, "fallback");
assert.deepEqual(
  themeView(openThemeFrom(onlyNumber)).chips.map((chip) => chip.label),
  ["기타", "없음"]
);

const starbucks = decideOffer(input("스타벅스에서 아메리카노"));
assert.equal(starbucks.kind, "children");
assert.equal(starbucks.parentId, "life");
assert.equal(starbucks.childLabels.includes("카페"), true);
assert.equal(starbucks.childLabels.includes("식사"), false);

const drinks = "오후 업무 끝나고 커피";
const drinkOffer = decideOffer(input(drinks));
assert.equal(drinkOffer.kind, "ask");
assert.equal(drinkOffer.prompt, "업무긴데 모호합니다. 어디로 둘까요?");
assert.equal(drinkOffer.options.length, 2);
assert.deepEqual(drinkOffer.options[0].choice, { kind: "parent", id: "work" });
assert.deepEqual(drinkOffer.options[1].choice, { kind: "parent", id: "life" });
assert.equal("title" in drinkOffer, false);
const drinkTheme = openThemeFrom(drinkOffer);
const drinkLog = projectThemeLog({ theme: drinkTheme, ratings: {}, split: { kind: "none" } });
assert.equal(drinkLog.inventedLabelAfter, null);
assert.equal(drinkLog.stickyLabel, null);
assert.equal(drinkLog.needsTitle, false);
assert.equal(drinkLog.askPrompt, "업무긴데 모호합니다. 어디로 둘까요?");

let picked = commitPick(drinkTheme, { kind: "parent", id: "work" }, drinks);
assert.equal(choiceLabel(picked), "업무");
assert.equal(picked.phase, "committed");
assert.notEqual(picked.offer.kind, "ask");
const pickedLog = projectThemeLog({ theme: picked, ratings: {}, split: { kind: "none" } });
assert.equal(pickedLog.stickyLabel, "업무");
assert.equal(pickedLog.inventedLabelAfter, "업무");
const kept = proposeTheme(picked, input(drinks, { judged: { themes: [{ label: "카페", score: 0.99 }] } }));
assert.equal(choiceLabel(kept), "업무");
assert.equal(kept.phase, "committed");
assert.equal(kept.choice.id, "work");

const codes = decideOffer(input("G437 품의서와 137 견적"));
assert.equal(codes.kind, "children");
assert.equal(codes.parentId, "work");
assert.equal(codes.childLabels.includes("G437"), true);
assert.equal(codes.childLabels.includes("137"), true);
assert.equal(
  codes.childLabels.some((label) => label.includes("G437") && label.includes("137")),
  false
);

const cableOpen = decideOffer(input("금오산 케이블카 할인", { priors: [{ label: "업무" }] }));
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
cableTheme = proposeTheme(cableTheme, input(cable, { judged: { themes: [{ label: "여행", score: 0.99 }] } }));
assert.equal(choiceLabel(cableTheme), "업무");
const cableLog = projectThemeLog({ theme: cableTheme, ratings: {}, split: { kind: "none" } });
assert.equal(cableLog.stickyLabel, "업무");
assert.equal(cableLog.inventedLabelAfter, "업무");

const other = openThemeFrom(decideOffer(input("스타벅스에서 아메리카노")));
const otherLog = projectThemeLog({ theme: other, ratings: {}, split: { kind: "none" } });
assert.equal(otherLog.stickyLabel, null);
assert.equal(otherLog.inventedLabelAfter, null);
assert.equal(cableLog.inventedLabelAfter, "업무");

const noneTheme = commitPick(openThemeFrom(digits), { kind: "fallback", label: "없음" }, "249150");
assert.equal(choiceLabel(noneTheme), "없음");
const noneLog = projectThemeLog({ theme: noneTheme, ratings: {}, split: { kind: "none" } });
assert.equal(noneLog.stickyLabel, "없음");
assert.equal(noneLog.inventedLabelAfter, "없음");

function openThemeFrom(offer) {
  return require("../theme-offer").openTheme(offer);
}

console.log("theme-offer.test.cjs passed");
