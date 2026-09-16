/**
 * 정산 엔진 검증: 엑셀이 계산해둔 값과 앱 엔진의 계산 결과를 전 월 대조한다.
 *
 * 실행: cd app && npx tsx ../tools/verify.ts
 */
import { readFileSync } from "node:fs";
import { settle, type Transaction, type Adjustment } from "../app/src/core/settlement.ts";

interface MonthMeta {
  year: number;
  month: number;
  isSplit: boolean;
  carryIn: number | null;
  xl: {
    eunjiPaid: number | null;
    jisuPaid: number | null;
    total: number | null;
    eunjiShare: number | null;
    jisuShare: number | null;
    eunjiGap: number | null;
    cumulative: number | null;
  };
}

const raw = JSON.parse(
  readFileSync(new URL("../data/ledger.json", import.meta.url), "utf-8"),
) as { transactions: Transaction[]; months: MonthMeta[] };

// 2세대 정산 구조인 월만 대상. 그 이전은 원본 템플릿이라 비교 대상이 아니다.
const splitMonths = raw.months.filter((m) => m.isSplit);
const first = splitMonths[0];
const splitKeys = new Set(splitMonths.map((m) => `${m.year}-${m.month}`));
const txns = raw.transactions.filter((t) => splitKeys.has(`${t.year}-${t.month}`));

// 엑셀에서 수식 안에 섞여 있던 수동 보정을 별도 레코드로 분리한 것.
const adjustments: Adjustment[] = [
  {
    year: 2024,
    month: 9,
    amount: -55644,
    // 2024/9만 P12 = P2-P8-N17 로 다르다. N17=55644, N16 메모: "기존 재산세 납부 제외 마이너스"
    reason: "기존 재산세 납부 제외 (정산 시작 시 보정)",
  },
  {
    year: 2026,
    month: 5,
    amount: 30000,
    // 2026/5 Q12 = P12+'4월'!Q12:Q13+30000. 근거가 파일에 없다.
    reason: "엑셀 5월 수식에 박혀 있던 보정 (근거 미확인)",
  },
];

/**
 * 엑셀에서 보정이 GAP(P12) 안에 섞여 들어간 달.
 * 앱은 GAP과 보정을 분리하므로, P12와 비교할 때만 다시 더해 준다.
 * 2026/5의 보정은 P12가 아니라 누적(Q12) 수식에 들어갔으므로 여기 없다.
 */
const gapEmbedded = new Map<string, number>([["2024-9", -55644]]);

const result = settle(txns, adjustments, 0);

const EPS = 0.51; // 원 단위 미만 차이는 무시
let pass = 0;
const fails: string[] = [];

for (const m of result) {
  const meta = splitMonths.find((x) => x.year === m.year && x.month === m.month)!;
  const checks: [string, number, number | null][] = [
    ["은지결제", m.paid.eunji, meta.xl.eunjiPaid],
    ["지수결제", m.paid.jisu, meta.xl.jisuPaid],
    ["합계", m.total, meta.xl.total],
    ["은지부담", m.share.eunji, meta.xl.eunjiShare],
    ["지수부담", m.share.jisu, meta.xl.jisuShare],
    ["은지GAP", m.gap.eunji + (gapEmbedded.get(`${m.year}-${m.month}`) ?? 0), meta.xl.eunjiGap],
    ["누적", m.cumulative, meta.xl.cumulative],
  ];
  for (const [label, got, want] of checks) {
    if (want === null) continue;
    if (Math.abs(got - want) <= EPS) pass++;
    else
      fails.push(
        `${m.year}/${String(m.month).padStart(2, "0")} ${label}: 엔진=${got} 엑셀=${want} 차이=${(got - want).toFixed(1)}`,
      );
  }
}

console.log(`대상: ${splitMonths.length}개월 (${first.year}/${first.month}부터), 거래 ${txns.length}건`);
console.log(`일치 ${pass}건 / 불일치 ${fails.length}건`);
if (fails.length) {
  console.log("\n--- 불일치 목록 ---");
  for (const f of fails) console.log(f);
}
