/**
 * 카드사 이용내역 파서 검증. 실행: cd app && npx tsx ../tools/statement_test.ts
 *
 * 카드사마다 헤더 이름과 위치가 다르다. 실제 파일에서 자주 보이는 형태를 흉내냈다.
 */
import { parseStatement, StatementError } from "../app/src/core/statement.ts";

const DEFAULTS = { household: "eunji" as const, payment: "신용카드", year: 2026 };

function csvFile(name: string, text: string): File {
  return new File([new TextEncoder().encode(text)], name, { type: "text/csv" });
}

interface Case {
  name: string;
  file: File;
  expect: { count: number; first: { month: number; day: number; merchant: string; amount: number } };
}

const CASES: Case[] = [
  {
    // 제목 줄과 조회기간이 위에 붙은 전형적인 카드사 파일
    name: "제목 행이 있는 신용카드 내역",
    file: csvFile(
      "shinhan.csv",
      `카드 이용내역
조회기간,2026-09-01 ~ 2026-09-30
,
이용일자,가맹점명,이용금액,구분
2026-09-01,농민식자재,78020,일시불
2026-09-03,오케이마트,8500,일시불
2026-09-16,브런즈,22640,일시불
합계,,109160,
`,
    ),
    expect: { count: 3, first: { month: 9, day: 1, merchant: "농민식자재", amount: 78020 } },
  },
  {
    name: "다른 컬럼명 (이용하신곳·승인금액) + 점 날짜",
    file: csvFile(
      "kb.csv",
      `이용일,이용하신곳,승인금액
2026.09.05,이마트몰,35900
2026.09.07,스타벅스 역삼점,5900
`,
    ),
    expect: { count: 2, first: { month: 9, day: 5, merchant: "이마트몰", amount: 35900 } },
  },
  {
    name: "금액에 쉼표·원, 취소 행 포함",
    file: csvFile(
      "samsung.csv",
      `거래일자,가맹점,거래금액,거래구분
2026-09-10,"두부가","6,000원",승인
2026-09-11,"청과마을","34,700원",취소
2026-09-12,"농민식자재","25,890원",승인
`,
    ),
    expect: { count: 3, first: { month: 9, day: 10, merchant: "두부가", amount: 6000 } },
  },
  {
    name: "연도 없는 날짜 (09/16)",
    file: csvFile(
      "nodate.csv",
      `이용일자,가맹점명,이용금액
09/16,푸주간,10000
09/18,농민식자재,7760
`,
    ),
    expect: { count: 2, first: { month: 9, day: 16, merchant: "푸주간", amount: 10000 } },
  },
];

async function main() {
  let pass = 0;
  const fails: string[] = [];

  for (const c of CASES) {
    try {
      const r = await parseStatement(c.file, DEFAULTS);
      const problems: string[] = [];
      if (r.rows.length !== c.expect.count)
        problems.push(`행 수 ${r.rows.length} (기대 ${c.expect.count})`);
      const f = r.rows[0];
      if (f) {
        const e = c.expect.first;
        if (f.month !== e.month || f.day !== e.day)
          problems.push(`첫 행 날짜 ${f.month}/${f.day} (기대 ${e.month}/${e.day})`);
        if (f.merchant !== e.merchant) problems.push(`첫 행 상호 "${f.merchant}" (기대 "${e.merchant}")`);
        if (f.amount !== e.amount) problems.push(`첫 행 금액 ${f.amount} (기대 ${e.amount})`);
      }
      if (problems.length === 0) {
        pass++;
        const cancels = r.rows.filter((x) => x.canceled).length;
        console.log(`OK   ${c.name}  (컬럼: ${r.columns.date}/${r.columns.merchant}/${r.columns.amount}, 취소 ${cancels}건, 건너뜀 ${r.skipped})`);
      } else {
        fails.push(`${c.name}: ${problems.join(", ")}`);
      }
    } catch (e) {
      fails.push(`${c.name}: 예외 ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 알아볼 수 없는 파일은 친절한 오류를 내야 한다
  try {
    await parseStatement(csvFile("junk.csv", "가나다\n1,2,3\n"), DEFAULTS);
    fails.push("엉뚱한 파일인데 예외가 안 났다");
  } catch (e) {
    const ok = e instanceof StatementError && e.message.includes("컬럼을 찾지 못했습니다");
    if (ok) {
      pass++;
      console.log("OK   알아볼 수 없는 파일 -> 안내 메시지");
    } else {
      fails.push(`엉뚱한 파일 처리: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`\n통과 ${pass}/${CASES.length + 1}`);
  for (const f of fails) console.log("FAIL " + f);
  if (fails.length) process.exitCode = 1;

}

main();
