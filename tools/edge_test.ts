/**
 * 경계·엣지 케이스 전수검사. 실행: cd app && npx tsx ../tools/edge_test.ts
 *
 * 평소 잘 돌아가다가 특정 시점·특정 데이터에서만 틀리는 것들을 모아 둔다.
 */
import { settle, type Adjustment, type Transaction } from "../app/src/core/settlement.ts";
import { parseStatement, resolveYear } from "../app/src/core/statement.ts";
import { shiftMonth } from "../app/src/ui/format.ts";

const results: string[] = [];
const fails: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) results.push(`OK   ${name}`);
  else fails.push(`${name}${detail ? " — " + detail : ""}`);
}

const txn = (o: Partial<Transaction>): Transaction => ({
  year: 2026, month: 1, day: 1, household: "eunji",
  category: "식비", description: "가게", payment: "신용카드", amount: 0, ...o,
});

async function main() {
  /* ---------------------------------------------------------- 정산 엔진 */

  // 한쪽만 지출하면 GAP은 정확히 비율만큼
  {
    const m = settle([txn({ amount: 10000, household: "eunji" })])[0];
    check("한쪽만 지출: 은지 GAP = +6000", Math.round(m.gap.eunji) === 6000,
          `got ${m.gap.eunji}`);
    check("한쪽만 지출: 두 GAP 합은 0", Math.abs(m.gap.eunji + m.gap.jisu) < 1e-6);
  }

  // 정확히 비율대로 쓰면 GAP 0
  {
    const m = settle([
      txn({ amount: 40000, household: "eunji" }),
      txn({ amount: 60000, household: "jisu" }),
    ])[0];
    check("비율대로 지출하면 GAP 0", Math.round(m.gap.eunji) === 0, `got ${m.gap.eunji}`);
  }

  // 거래가 없고 보정만 있는 달도 누적에 반영돼야 한다
  {
    const adj: Adjustment[] = [{ year: 2026, month: 3, amount: -5000, reason: "테스트" }];
    const ms = settle([txn({ month: 1, amount: 1000 })], adj);
    const march = ms.find((m) => m.month === 3);
    check("거래 없이 보정만 있는 달도 계산된다", !!march && march.adjustment === -5000);
    check("보정이 누적에 반영된다",
          !!march && Math.abs(march.cumulative - (600 - 5000)) < 1e-6,
          `got ${march?.cumulative}`);
  }

  // 연도를 넘어가도 누적이 이어진다
  {
    const ms = settle([
      txn({ year: 2025, month: 12, amount: 10000, household: "eunji" }),
      txn({ year: 2026, month: 1, amount: 10000, household: "eunji" }),
    ]);
    check("연도를 넘어 누적이 이어진다",
          Math.round(ms[1].cumulative) === 12000, `got ${ms[1].cumulative}`);
  }

  // 시간순이 아닌 입력도 정렬해서 계산해야 한다
  {
    const ms = settle([
      txn({ month: 5, amount: 10000 }),
      txn({ month: 2, amount: 20000 }),
    ]);
    check("입력 순서와 무관하게 월 오름차순", ms[0].month === 2 && ms[1].month === 5);
    check("정렬 후 누적이 맞다", Math.round(ms[1].cumulative) === 18000,
          `got ${ms[1].cumulative}`);
  }

  // 거래가 하나도 없으면 빈 배열
  check("거래 0건이면 빈 결과", settle([]).length === 0);

  /* ------------------------------------------------------- 월 이동 계산 */
  {
    const a = shiftMonth(2026, 1, -1);
    check("1월에서 이전 달 = 전년 12월", a.year === 2025 && a.month === 12,
          `got ${a.year}/${a.month}`);
    const b = shiftMonth(2026, 12, 1);
    check("12월에서 다음 달 = 다음해 1월", b.year === 2027 && b.month === 1,
          `got ${b.year}/${b.month}`);
    const c = shiftMonth(2026, 6, -18);
    check("18개월 전으로 이동", c.year === 2024 && c.month === 12,
          `got ${c.year}/${c.month}`);
  }

  /* --------------------------------------------- 카드 내역: 연도 없는 날짜 */
  const csv = (text: string) =>
    new File([new TextEncoder().encode(text)], "t.csv", { type: "text/csv" });

  {
    // 1월에 12/28 내역을 가져오면 지난해여야 한다
    const r = await parseStatement(
      csv("이용일자,가맹점명,이용금액\n12/28,농민식자재,10000\n"),
      { household: "eunji", payment: "신용카드", year: 2027, month: 1 },
    );
    check("1월에 만난 12/28 = 지난해 12월",
          r.rows[0].year === 2026 && r.rows[0].month === 12,
          `got ${r.rows[0].year}/${r.rows[0].month}`);
  }
  {
    // 같은 해 안이면 그대로
    const r = await parseStatement(
      csv("이용일자,가맹점명,이용금액\n09/16,농민식자재,10000\n"),
      { household: "eunji", payment: "신용카드", year: 2026, month: 9 },
    );
    check("9월에 만난 09/16 = 올해 9월",
          r.rows[0].year === 2026 && r.rows[0].month === 9,
          `got ${r.rows[0].year}/${r.rows[0].month}`);
  }
  {
    // 바로 다음 달까지는 올해로 본다 (결제일이 조금 앞선 경우)
    const r = await parseStatement(
      csv("이용일자,가맹점명,이용금액\n10/01,농민식자재,10000\n"),
      { household: "eunji", payment: "신용카드", year: 2026, month: 9 },
    );
    check("9월에 만난 10/01 = 올해 10월", r.rows[0].year === 2026,
          `got ${r.rows[0].year}`);
  }

  /* ------------------------------------------- 카드 내역: 금액/행 엣지 */
  {
    const r = await parseStatement(
      csv(
        "이용일자,가맹점명,이용금액,구분\n" +
          "2026-09-01,정상가게,10000,승인\n" +
          "2026-09-02,음수취소,-5000,승인\n" +
          "2026-09-03,빈금액,,승인\n" +
          "2026-09-04,큰금액,12345678,승인\n",
      ),
      { household: "eunji", payment: "신용카드", year: 2026, month: 9 },
    );
    check("음수 금액은 취소로 보고 절대값 보관",
          r.rows.some((x) => x.merchant === "음수취소" && x.canceled && x.amount === 5000));
    check("음수 취소는 기본 체크 해제",
          r.rows.find((x) => x.merchant === "음수취소")?.include === false);
    check("금액 빈 행은 건너뛴다", !r.rows.some((x) => x.merchant === "빈금액"));
    check("큰 금액도 정확히 읽는다",
          r.rows.find((x) => x.merchant === "큰금액")?.amount === 12345678);
  }

  /* ------------------------- 연도 추정 (붙여넣기·카드내역 공용 규칙) */
  {
    // 알림 붙여넣기도 카드 내역과 같은 규칙을 써야 한다. 1월에 12월 알림을
    // 붙여넣고 올해로 잡으면 1년 뒤로 기록돼 누적 정산이 어긋난다.
    check("1월에 만난 12월 = 지난해", resolveYear(12, { year: 2026, month: 1 }) === 2025);
    check("9월에 만난 9월 = 올해", resolveYear(9, { year: 2026, month: 9 }) === 2026);
    check("9월에 만난 10월(선결제) = 올해", resolveYear(10, { year: 2026, month: 9 }) === 2026);
    check("12월에 만난 1월 = 올해", resolveYear(1, { year: 2026, month: 12 }) === 2026);
  }

  /* ------------------------------------------------ 요약 */
  console.log(results.join("\n"));
  console.log(`\n통과 ${results.length}/${results.length + fails.length}`);
  for (const f of fails) console.log("FAIL " + f);
  if (fails.length) process.exitCode = 1;
}

main();
