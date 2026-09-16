/**
 * 상호명 → 범주 추측 정확도 측정.
 * 실행: cd app && npx tsx ../tools/guess_test.ts
 *
 * 실제 가계부 449건의 상호명과 사람이 넣은 범주를 정답지로 쓴다.
 * 추측이 틀리면 없느니만 못하므로, **틀린 비율**을 특히 본다.
 */
import { readFileSync } from "node:fs";
import { guessCategory } from "../app/src/core/categories.ts";

interface Row {
  description: string;
  category: string;
  year: number;
  month: number;
}

const raw = JSON.parse(
  readFileSync(new URL("../data/ledger.json", import.meta.url), "utf-8"),
) as { transactions: Row[] };

// 상호명별로 사람이 넣은 범주 (가장 많이 쓴 것을 정답으로)
const truth = new Map<string, Map<string, number>>();
for (const t of raw.transactions) {
  const name = (t.description ?? "").trim();
  if (!name) continue;
  if (!truth.has(name)) truth.set(name, new Map());
  const m = truth.get(name)!;
  m.set(t.category, (m.get(t.category) ?? 0) + 1);
}

let hit = 0;
let miss = 0;
let unknown = 0;
const wrong: string[] = [];
const notGuessed: [string, string, number][] = [];

for (const [name, counts] of truth) {
  const answer = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const uses = [...counts.values()].reduce((a, b) => a + b, 0);
  const guess = guessCategory(name);

  if (guess === "기타") {
    if (answer === "기타") hit++;
    else {
      unknown++;
      notGuessed.push([name, answer, uses]);
    }
  } else if (guess === answer) {
    hit++;
  } else {
    miss++;
    wrong.push(`${name}: 추측=${guess} 실제=${answer} (${uses}건)`);
  }
}

const total = hit + miss + unknown;
console.log(`가게 ${total}곳`);
console.log(`  맞음      ${hit}곳 (${((hit / total) * 100).toFixed(0)}%)`);
console.log(`  틀림      ${miss}곳 (${((miss / total) * 100).toFixed(0)}%)  <- 이게 중요`);
console.log(`  못 맞힘   ${unknown}곳 (${((unknown / total) * 100).toFixed(0)}%)  (기타로 두고 사용자가 고름)`);

if (wrong.length) {
  console.log("\n--- 틀리게 추측한 것 (잘못 넣으면 손으로 고쳐야 한다) ---");
  for (const w of wrong) console.log("  " + w);
}

// 자주 쓰는데 못 맞힌 가게 = 힌트를 추가하면 이득이 큰 곳
notGuessed.sort((a, b) => b[2] - a[2]);
if (notGuessed.length) {
  console.log("\n--- 자주 쓰는데 못 맞힌 가게 상위 12곳 ---");
  for (const [name, answer, uses] of notGuessed.slice(0, 12)) {
    console.log(`  ${name} -> ${answer} (${uses}건)`);
  }
}

// 틀린 추측이 5%를 넘으면 실패로 본다
if (miss / total > 0.05) {
  console.log("\n틀린 비율이 5%를 넘습니다. 힌트를 손봐야 합니다.");
  process.exitCode = 1;
}
