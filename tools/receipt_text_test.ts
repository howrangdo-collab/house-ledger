/**
 * 영수증 텍스트 파서 검증 (아이폰 라이브 텍스트로 긁은 것을 흉내).
 * 실행: cd app && npx tsx ../tools/receipt_text_test.ts
 */
import { parseReceiptText } from "../app/src/core/textParse.ts";

interface Case {
  name: string;
  text: string;
  want: { amount: number; merchant: string; month: number | null; day: number | null };
}

const CASES: Case[] = [
  {
    name: "카페 영수증 (합계 + 받은금액 함정)",
    text: `스타벅스 역삼점
사업자번호 123-45-67890
서울시 강남구 테헤란로 123
TEL: 02-1234-5678

2026-09-16 14:23

아메리카노(T)   1   4,500
카페라떼(T)     1   5,000

합계            9,500
받은금액       10,000
거스름돈          500`,
    want: { amount: 9500, merchant: "스타벅스 역삼점", month: 9, day: 16 },
  },
  {
    name: "마트 영수증 (과세/부가세 함정)",
    text: `농민식자재
대표자 홍길동
사업자 111-22-33333

2026.09.02

돼지고기       12,000
양파 1망        3,800
두부 2모        4,000
계란 30구       7,000

과세물품가액   24,364
부가세          2,436
합계금액       26,800`,
    want: { amount: 26800, merchant: "농민식자재", month: 9, day: 2 },
  },
  {
    // "과세" 두 글자로 줄을 통째로 버리면 진짜 총액인 «과세 합계»까지 놓친다.
    name: "과세 합계가 총액인 영수증",
    text: `행복마트
사업자 222-33-44444

2026-09-11

품목A           5,000
품목B           7,000
과세 합계      12,000
신용카드       12,000`,
    want: { amount: 12000, merchant: "행복마트", month: 9, day: 11 },
  },
  {
    // 소계는 부분합이라 총액이 아니다.
    name: "소계와 합계가 함께 있는 영수증",
    text: `커피나무
사업자 333-44-55555

2026-09-12

아메리카노      4,500
케이크          6,500
소계           11,000
할인            1,000
합계           10,000
받은금액       20,000
거스름돈       10,000`,
    want: { amount: 10000, merchant: "커피나무", month: 9, day: 12 },
  },
  {
    name: "금액이 다음 줄에 오는 형태",
    text: `브런즈
2026-09-09
브런치세트
22,640
결제금액
22,640`,
    want: { amount: 22640, merchant: "브런즈", month: 9, day: 9 },
  },
  {
    name: "짧은 연도 (26.09.14)",
    text: `두부가
26.09.14
순두부백반  8,000
합계 8,000`,
    want: { amount: 8000, merchant: "두부가", month: 9, day: 14 },
  },
];

let pass = 0;
const fails: string[] = [];

for (const c of CASES) {
  const r = parseReceiptText(c.text);
  if (!r) {
    fails.push(`${c.name}: 파싱 실패(null)`);
    continue;
  }
  const bad: string[] = [];
  if (r.amount !== c.want.amount) bad.push(`금액=${r.amount} (기대 ${c.want.amount})`);
  if (r.merchant !== c.want.merchant) bad.push(`상호="${r.merchant}" (기대 "${c.want.merchant}")`);
  if (r.month !== c.want.month) bad.push(`월=${r.month} (기대 ${c.want.month})`);
  if (r.day !== c.want.day) bad.push(`일=${r.day} (기대 ${c.want.day})`);

  if (bad.length === 0) {
    pass++;
    console.log(`OK   ${c.name}`);
  } else {
    fails.push(`${c.name}: ${bad.join(", ")}`);
  }
}

// 금액이 전혀 없으면 null
if (parseReceiptText("안녕하세요\n오늘 날씨가 좋네요") === null) {
  pass++;
  console.log("OK   금액 없는 텍스트 -> null");
} else {
  fails.push("금액 없는 텍스트인데 파싱됨");
}

console.log(`\n통과 ${pass}/${pass + fails.length}`);
for (const f of fails) console.log("FAIL " + f);
if (fails.length) process.exitCode = 1;
