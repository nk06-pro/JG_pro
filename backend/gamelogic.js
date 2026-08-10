// 야추(Yacht Dice) 판정 로직 — 서버 전용, 게임 상태의 최종 권한은 항상 서버가 가짐

const CATEGORIES = [
  { key: "ones", group: "upper" },
  { key: "twos", group: "upper" },
  { key: "threes", group: "upper" },
  { key: "fours", group: "upper" },
  { key: "fives", group: "upper" },
  { key: "sixes", group: "upper" },
  { key: "choice", group: "lower" },
  { key: "fourKind", group: "lower" },
  { key: "fullHouse", group: "lower" },
  { key: "smallStraight", group: "lower" },
  { key: "largeStraight", group: "lower" },
  { key: "yacht", group: "lower" },
];

const UPPER_BONUS_THRESHOLD = 63;
const UPPER_BONUS_SCORE = 35;

function counts(dice) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  dice.forEach((d) => c[d]++);
  return c;
}
function sum(dice) {
  return dice.reduce((a, b) => a + b, 0);
}
function hasStraight(uniqueSorted, target) {
  return target.every((v) => uniqueSorted.includes(v));
}

function scoreFor(key, dice) {
  const c = counts(dice);
  const total = sum(dice);
  const unique = [...new Set(dice)].sort((a, b) => a - b);
  switch (key) {
    case "ones": return c[1] * 1;
    case "twos": return c[2] * 2;
    case "threes": return c[3] * 3;
    case "fours": return c[4] * 4;
    case "fives": return c[5] * 5;
    case "sixes": return c[6] * 6;
    case "choice": return total;
    case "fourKind": return c.some((n) => n >= 4) ? total : 0;
    case "fullHouse": return c.includes(3) && c.includes(2) ? 25 : 0;
    case "smallStraight": {
      const ok =
        hasStraight(unique, [1, 2, 3, 4]) ||
        hasStraight(unique, [2, 3, 4, 5]) ||
        hasStraight(unique, [3, 4, 5, 6]);
      return ok ? 15 : 0;
    }
    case "largeStraight": {
      const ok =
        (unique.length === 5 && hasStraight(unique, [1, 2, 3, 4, 5])) ||
        (unique.length === 5 && hasStraight(unique, [2, 3, 4, 5, 6]));
      return ok ? 30 : 0;
    }
    case "yacht": return c.some((n) => n === 5) ? 50 : 0;
    default: return 0;
  }
}

function computeTotals(scorecard) {
  let upper = 0, lower = 0;
  CATEGORIES.forEach(({ key, group }) => {
    const v = scorecard[key];
    if (typeof v === "number") {
      if (group === "upper") upper += v; else lower += v;
    }
  });
  const bonus = upper >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS_SCORE : 0;
  return { upper, lower, bonus, total: upper + lower + bonus };
}

function isScorecardFull(scorecard) {
  return CATEGORIES.every(({ key }) => typeof scorecard[key] === "number");
}
function emptyScorecard() {
  const sc = {};
  CATEGORIES.forEach(({ key }) => (sc[key] = null));
  return sc;
}
function rollDice(count = 5) {
  return Array.from({ length: count }, () => 1 + Math.floor(Math.random() * 6));
}

module.exports = {
  CATEGORIES, scoreFor, computeTotals, isScorecardFull, emptyScorecard, rollDice,
};