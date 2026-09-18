/**
 * 결제 알림 텍스트 파서 검증. 실행: cd app && npx tsx ../tools/sms_test.ts
 *
 * 카드사 문자뿐 아니라 카드 앱 푸시 알림을 복사해 붙여넣는 경우도 받는다.
 */
import { parseSms } from "../app/src/core/textParse.ts";

interface Case {
  name: string;
  sms: string;
  want: { amount: number; merchant: string; month: number | null; day: number | null };
}

const CASES: Case[] = [
  {
    name: "신한카드 문자",
    sms: `[Web발신]
신한카드(1234)승인 홍*동
12,500원 일시불
09/16 14:23
농민식자재
누적1,234,567원`,
    want: { amount: 12500, merchant: "농민식자재", month: 9, day: 16 },
  },
  {
    name: "KB국민카드 문자",
    sms: `[Web발신]
KB국민카드 승인
홍*동님
5,900원
09/16 12:30
스타벅스 역삼점`,
    want: { amount: 5900, merchant: "스타벅스 역삼점", month: 9, day: 16 },
  },
  {
    name: "한 줄로 오는 형식",
    sms: `[Web발신] 삼성카드 승인 홍*동 37,800원 09/15 19:04 이마트몰`,
    want: { amount: 37800, merchant: "이마트몰", month: 9, day: 15 },
  },
  {
    name: "체크카드 (잔액 표기)",
    sms: `[Web발신]
우리체크카드 출금
8,000원
09/14 08:11
두부가
잔액 1,203,000원`,
    want: { amount: 8000, merchant: "두부가", month: 9, day: 14 },
  },
  {
    name: "할부 회차가 날짜로 읽히면 안 된다",
    sms: `[Web발신]
삼성카드 승인 홍*동
37,800원 3/6개월 할부
09/15 19:04
이마트몰`,
    want: { amount: 37800, merchant: "이마트몰", month: 9, day: 15 },
  },
  {
    name: "한 줄 형식에 할부 표기가 섞인 경우",
    sms: `[Web발신] 현대카드 승인 홍*동 12,000원 2/3개월 할부 09/14 11:02 스타벅스`,
    want: { amount: 12000, merchant: "스타벅스", month: 9, day: 14 },
  },
  {
    name: "한글 날짜",
    sms: `현대카드 승인
23,400원 일시불
9월 3일 18:22
브런즈`,
    want: { amount: 23400, merchant: "브런즈", month: 9, day: 3 },
  },
];

let pass = 0;
const fails: string[] = [];

for (const c of CASES) {
  const r = parseSms(c.sms);
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
    console.log(`OK   ${c.name}  (${r.payment}${r.issuer ? ", " + r.issuer : ""})`);
  } else {
    fails.push(`${c.name}: ${bad.join(", ")}`);
  }
}

// 취소 문자 감지
const cancel = parseSms(`[Web발신]\n신한카드 승인취소\n12,500원\n09/16 15:00\n농민식자재`);
if (cancel?.canceled === true) {
  pass++;
  console.log("OK   취소 문자 감지");
} else {
  fails.push("취소 문자를 감지하지 못했다");
}

// "취소 방법 안내" 문구를 취소로 보면 안 된다
const notice = parseSms(
  `[Web발신]
신한카드 승인
5,000원
09/15 12:00
스타벅스
취소는 앱에서 가능합니다`,
);
if (notice && notice.canceled === false) {
  pass++;
  console.log("OK   취소 안내 문구는 취소가 아니다");
} else {
  fails.push(`취소 안내 문구를 취소로 잘못 읽었다: ${JSON.stringify(notice)}`);
}

// 결제와 무관한 문자는 null
const junk = parseSms("안녕하세요 오늘 저녁에 볼까요?");
if (junk === null) {
  pass++;
  console.log("OK   결제와 무관한 문자 -> null");
} else {
  fails.push(`결제와 무관한 문자인데 파싱됨: ${JSON.stringify(junk)}`);
}

console.log(`\n통과 ${pass}/${pass + fails.length}`);
for (const f of fails) console.log("FAIL " + f);
if (fails.length) process.exitCode = 1;
