/**
 * 붙여넣은 텍스트에서 결제 내용을 뽑아낸다. 전부 로컬에서 도는 정규식 파서로,
 * API 호출도 비용도 없다.
 *
 * 두 종류를 받는다.
 *  1. **결제 알림** (`parseSms`) — 카드 앱 푸시나 문자를 길게 눌러 복사한 것.
 *     이미 글자라서 사진과 달리 오인식이 없다.
 *  2. **영수증 텍스트** (`parseReceiptText`) — 아이폰 사진 앱의 텍스트 인식
 *     (라이브 텍스트)으로 영수증에서 긁어온 것. 애플이 기기 안에서 처리하므로
 *     무료이고 사진이 밖으로 나가지 않는다.
 */
import { normalizePayment } from "./categories";

export interface ParsedSms {
  amount: number;
  merchant: string;
  month: number | null;
  day: number | null;
  payment: string;
  /** 카드사 이름 등 파악한 것 */
  issuer: string | null;
  /** 취소/환불 문자로 보이면 true */
  canceled: boolean;
}

const ISSUERS = [
  "신한", "국민", "KB국민", "KB", "삼성", "현대", "롯데", "우리", "하나",
  "BC", "비씨", "농협", "NH", "씨티", "카카오뱅크", "케이뱅크", "토스",
];

/** 금액이 아닌 숫자(누적/잔액/할부 등)를 걸러내기 위한 앞말 */
const NOT_AMOUNT = /(누적|잔액|한도|포인트|적립|총|합계|이용가능)/;

/**
 * 결제 문자에서 값을 뽑는다. 카드사마다 형식이 달라 위치가 아니라
 * 패턴으로 찾는다. 하나라도 못 찾으면 null을 반환해 호출부가 수동 입력으로
 * 넘어가게 한다.
 */
export function parseSms(raw: string): ParsedSms | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;

  // --- 금액: "12,500원" 중 누적/잔액 같은 수식어가 앞에 없는 첫 번째 값
  let amount = 0;
  const amountRe = /([0-9][0-9,]*)\s*원/g;
  for (const line of lines) {
    let m: RegExpExecArray | null;
    amountRe.lastIndex = 0;
    while ((m = amountRe.exec(line))) {
      const before = line.slice(Math.max(0, m.index - 12), m.index);
      if (NOT_AMOUNT.test(before)) continue;
      const v = parseInt(m[1].replace(/,/g, ""), 10);
      if (v > 0) {
        amount = v;
        break;
      }
    }
    if (amount) break;
  }
  if (!amount) return null;

  // --- 날짜: MM/DD 또는 MM월 DD일
  const { month, day } = pickDate(text);

  // --- 카드사
  const issuer = ISSUERS.find((n) => text.includes(n + "카드") || text.includes(n + "체크")) ?? null;

  // --- 결제수단: 문자에 '체크'가 있으면 체크카드, 그 외 카드면 신용카드
  const payment = /체크/.test(text) ? "체크카드" : "신용카드";

  // "취소는 앱에서 가능합니다" 같은 안내 문구까지 취소로 보면 멀쩡한 결제가
  // 취소로 표시된다. 안내 문구를 걷어낸 뒤 남는 것만 본다.
  const canceled = /취소|환불/.test(text.replace(CANCEL_NOTE, ""));

  // --- 상호명: 금액·날짜·카드사·안내 문구가 아닌 줄 중 마지막 것.
  // 대부분의 카드사가 가맹점명을 맨 아래쪽에 둔다.
  const merchant = pickMerchant(lines) || tailAfterTime(text);

  return {
    amount,
    merchant,
    month,
    day,
    payment: normalizePayment(payment),
    issuer,
    canceled,
  };
}

/** 결제 취소가 아니라 "취소 방법" 안내인 문장 */
const CANCEL_NOTE = /(취소|환불)\s*(는|를|은|이|도|문의|안내|가능|접수|방법|하려|하시|원하)[^\n]*/g;

/**
 * 날짜가 아니라 할부 회차인 "3/6" 을 가려내기 위한 **바로 붙은** 문맥.
 *
 * 넓게 잡으면 안 된다 — "3/6개월 할부" 다음 줄의 진짜 날짜 "09/15"까지
 * 할부로 보고 버리게 된다. 회차 표기는 숫자에 딱 붙어 나온다.
 */
/**
 * 할부 회차 표기("3/6개월")는 숫자에 단위가 바로 붙는다. 이걸로 거른다.
 *
 * 반대로 "할부 09/14" 처럼 **앞에** 할부가 오는 것으로는 거르지 않는다 —
 * 한 줄로 오는 알림에서 진짜 날짜 바로 앞이 "할부"인 경우가 있다.
 */
const INSTALLMENT_AFTER = /^[ \t]?(개월|회차|회|차)/;
/** 결제 알림의 날짜는 대개 시각이 뒤따른다. 후보가 여럿이면 이쪽을 믿는다. */
const FOLLOWED_BY_TIME = /^[ \t]?\d{1,2}:\d{2}/;

/**
 * 결제 알림에서 날짜를 고른다.
 *
 * `3/6개월 할부` 처럼 날짜가 아닌 슬래시 표기가 섞여 있다. 먼저 나온 것을 그냥
 * 쓰면 3월 6일로 기록돼 **정산 달이 통째로 바뀐다**. 후보마다 앞뒤 문맥을 보고
 * 할부 회차로 보이는 것은 버린다.
 */
function pickDate(text: string): { month: number | null; day: number | null } {
  const re = /(?<!\d)(\d{1,2})\/(\d{1,2})(?!\d)/g;
  const found: { month: number; day: number; timed: boolean }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    const after = text.slice(end, end + 8);
    if (INSTALLMENT_AFTER.test(after)) continue;
    const a = +m[1];
    const b = +m[2];
    if (a < 1 || a > 12 || b < 1 || b > 31) continue;
    found.push({ month: a, day: b, timed: FOLLOWED_BY_TIME.test(after) });
  }
  const best = found.find((f) => f.timed) ?? found[0];
  if (best) return { month: best.month, day: best.day };

  const korean = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (korean) {
    const a = +korean[1];
    const b = +korean[2];
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31) return { month: a, day: b };
  }

  return { month: null, day: null };
}

const NOISE = [
  /^\[?web발신\]?$/i,
  /^\[?국외발신\]?$/i,
  /^\[?광고\]?/,
  /카드/,
  /승인|취소|환불|결제/,
  /일시불|할부/,
  /누적|잔액|한도|포인트|적립|이용가능/,
  /^\d{1,2}\/\d{1,2}/,
  /^\d{1,2}:\d{2}/,
  /^[0-9,]+\s*원/,
  /^\(?\d{3,4}\)?$/,
  /^[가-힣]\*+[가-힣]?님?$/, // 홍*동, 홍*동님
];

/**
 * 모든 정보가 한 줄에 오는 형식의 대비책.
 * 예: "[Web발신] 삼성카드 승인 홍*동 37,800원 09/15 19:04 이마트몰"
 * 줄 단위로는 통째로 걸러지므로, 마지막 시각(또는 날짜) 뒤 꼬리를 상호로 본다.
 */
function tailAfterTime(text: string): string {
  const oneLine = text.replace(/\s+/g, " ");
  // 시각 뒤가 우선, 없으면 날짜 뒤
  const patterns = [/\d{1,2}:\d{2}\s+(.+)$/, /\d{1,2}[/.]\d{1,2}\s+(.+)$/];
  for (const re of patterns) {
    const m = oneLine.match(re);
    if (!m) continue;
    const tail = m[1]
      .replace(/(누적|잔액|한도|포인트|적립|이용가능)[^\s]*\s*[0-9,]*\s*원?.*/g, "")
      .replace(/[0-9][0-9,]*\s*원/g, "")
      .replace(/\d{1,2}\/\d{1,2}\s*개월/g, "")
      .replace(/(일시불|할부|\d{1,2}\s*개월)/g, "")
      .replace(/^[\s\-·|]+|[\s\-·|]+$/g, "")
      .trim();
    if (tail.length >= 2 && tail.length <= 30) return tail;
  }
  return "";
}

function pickMerchant(lines: string[]): string {
  const candidates = lines.filter((l) => {
    if (l.length < 2 || l.length > 30) return false;
    return !NOISE.some((re) => re.test(l));
  });

  if (!candidates.length) return "";

  // 마지막 후보를 쓰되, 줄 안에 시각/금액이 섞여 있으면 떼어낸다
  let s = candidates[candidates.length - 1];
  s = s
    .replace(/\d{1,2}\/\d{1,2}/g, "")
    .replace(/\d{1,2}:\d{2}/g, "")
    .replace(/[0-9][0-9,]*\s*원/g, "")
    .replace(/^[\s\-·|]+|[\s\-·|]+$/g, "")
    .trim();
  return s;
}

/* ==================================================================== */
/* 영수증 텍스트 (아이폰 라이브 텍스트로 긁어온 것)                        */
/* ==================================================================== */

/** 결제 총액을 가리키는 말. 앞에 있을수록 우선한다. */
const TOTAL_KEYS = [
  "결제금액", "승인금액", "카드결제", "총결제", "합계금액", "받을금액",
  "판매총액", "총금액", "총액", "합계", "계",
];

/** 총액으로 착각하기 쉬운 것들 — 이 말이 있는 줄은 금액 후보에서 뺀다. */
// "과세"를 통째로 막으면 «과세 합계 12,000» 같은 진짜 총액 줄까지 버린다.
// 막아야 하는 것은 과세 구분 금액이지 합계가 아니다. "소계"는 부분합이라 제외한다.
const NOT_TOTAL =
  /(받은금액|받은돈|거스름|거스름돈|잔돈|공급가액|부가세|면세물품|면세금액|과세물품|과세금액|과세계|소계|포인트|적립|잔액|할인전|정상가)/;

/** 상호명 줄이 아닌 것 */
const NOT_NAME =
  /(사업자|등록번호|대표자?[\s:]|주소|전화|TEL|T\.|영수증|거래명세|카드|승인|매출|POS|단말|가맹점번호|http|www\.|\d{3}-\d{2}-\d{5})/i;

/**
 * 영수증에서 인식한 텍스트를 읽는다.
 *
 * 아이폰: 사진 앱에서 영수증 사진을 열고 → 텍스트를 길게 눌러 전체 선택 → 복사.
 * 애플의 기기 내 OCR을 쓰므로 비용이 들지 않고 사진이 외부로 전송되지 않는다.
 */
export function parseReceiptText(raw: string): ParsedSms | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  // --- 금액: 총액을 뜻하는 말이 있는 줄에서 찾는다
  let amount = 0;
  outer: for (const key of TOTAL_KEYS) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes(key) || NOT_TOTAL.test(line)) continue;

      // 같은 줄의 금액, 없으면 다음 줄 (표 형태로 값이 아래에 오는 경우)
      const v = firstAmount(line.slice(line.indexOf(key) + key.length)) || firstAmount(lines[i + 1] ?? "");
      if (v > 0) {
        amount = v;
        break outer;
      }
    }
  }

  // 총액 표시를 못 찾으면 금액으로 보이는 값 중 가장 큰 것
  if (!amount) {
    for (const line of lines) {
      if (NOT_TOTAL.test(line)) continue;
      const v = firstAmount(line);
      if (v > amount) amount = v;
    }
  }
  if (!amount) return null;

  // --- 날짜: 2026-09-16 / 2026.09.16 / 26/09/16
  let month: number | null = null;
  let day: number | null = null;
  const full = text.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  const short = text.match(/(?<!\d)(\d{2})[-./](\d{1,2})[-./](\d{1,2})(?!\d)/);
  const hit = full ?? short;
  if (hit) {
    const m = +hit[2];
    const d = +hit[3];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      month = m;
      day = d;
    }
  }

  // --- 상호: 위에서부터 사업자 정보가 아닌 첫 줄. 영수증은 상호를 맨 위에 둔다.
  let merchant = "";
  for (const line of lines.slice(0, 8)) {
    if (line.length < 2 || line.length > 30) continue;
    if (NOT_NAME.test(line)) continue;
    if (/^[\d\s,.\-:]+$/.test(line)) continue; // 숫자만 있는 줄
    merchant = line.replace(/[*=\-_]{2,}/g, "").trim();
    if (merchant) break;
  }

  return {
    amount,
    merchant,
    month,
    day,
    payment: normalizePayment(/현금/.test(text) && !/카드/.test(text) ? "현금" : "신용카드"),
    issuer: null,
    canceled: /취소|환불/.test(text),
  };
}

/** 문자열에서 첫 번째 금액을 뽑는다. 3자리 이상이어야 금액으로 본다. */
function firstAmount(s: string): number {
  const m = String(s ?? "").match(/([0-9][0-9,]{2,})/);
  if (!m) return 0;
  const v = parseInt(m[1].replace(/,/g, ""), 10);
  return Number.isFinite(v) ? v : 0;
}

/* ==================================================================== */

/** 영수증에서만 보이는 말 */
const RECEIPT_HINT = /(사업자|부가세|과세물품|대표자|거스름|받은금액|영수증|단말기|가맹점번호)/;
/** 결제 알림에서만 보이는 말 */
const NOTICE_HINT = /(web발신|승인|일시불|할부|누적)/i;

/**
 * 붙여넣은 것이 결제 알림인지 영수증 텍스트인지 가려서 알맞은 파서를 쓴다.
 * 사용자가 무엇을 붙여넣었는지 고르게 하지 않기 위한 것이다.
 */
export function parsePasted(raw: string): ParsedSms | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  const looksReceipt = RECEIPT_HINT.test(text);
  const looksNotice = NOTICE_HINT.test(text);

  if (looksReceipt && !looksNotice) return parseReceiptText(text);
  if (looksNotice && !looksReceipt) return parseSms(text);

  // 애매하면 둘 다 해보고 먼저 성공하는 쪽. 줄이 많으면 영수증일 가능성이 높다.
  const manyLines = text.split(/\r?\n/).filter((l) => l.trim()).length >= 6;
  return manyLines
    ? (parseReceiptText(text) ?? parseSms(text))
    : (parseSms(text) ?? parseReceiptText(text));
}
