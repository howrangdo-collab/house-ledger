/**
 * 카드사 이용내역 파일(CSV/엑셀) 가져오기.
 *
 * 아이폰은 앱이 결제 알림을 자동으로 읽을 수 없고, 카드사 문자 알림은 보통
 * 유료 서비스다. 그래서 **월 1회 카드사에서 내려받은 이용내역 파일**을 통째로
 * 넣는 것이 무료로 누락 없이 기록하는 가장 확실한 길이다.
 *
 * 카드사마다 컬럼 이름과 헤더 위치가 달라서, 위치가 아니라 **컬럼 이름을 찾아**
 * 매핑한다. 전부 브라우저 안에서 처리되고 어디로도 전송되지 않는다.
 */
import type { HouseholdKey, Transaction } from "./settlement";

/** 컬럼 이름 후보. 카드사·은행마다 표현이 다르다. */
const HEADERS = {
  date: ["이용일", "이용일자", "거래일자", "승인일자", "매출일자", "사용일자",
         "거래일시", "이용일시", "결제일", "일자", "날짜"],
  merchant: ["가맹점명", "가맹점", "이용하신곳", "이용가맹점", "이용내역", "상호",
             "사용처", "내용", "적요", "가맹점명(사업자번호)", "거래내용"],
  amount: ["이용금액", "승인금액", "거래금액", "결제금액", "사용금액", "출금액",
           "청구금액", "합계금액", "금액", "원화금액"],
  kind: ["구분", "거래구분", "취소여부", "승인구분", "상태"],
} as const;

export interface StatementRow {
  /** 이 행을 실제로 등록할지 */
  include: boolean;
  year: number;
  month: number;
  day: number;
  merchant: string;
  amount: number;
  /** 취소·환불로 보이는 행 */
  canceled: boolean;
  /** 이미 같은 거래가 있어 중복으로 보이는 행 */
  duplicate: boolean;
  category: string;
  household: HouseholdKey;
  payment: string;
}

export interface ParseResult {
  rows: StatementRow[];
  /** 찾아낸 컬럼 이름 (사용자에게 보여줘 잘못 잡혔는지 확인시킨다) */
  columns: { date: string; merchant: string; amount: string };
  /** 건너뛴 행 수 */
  skipped: number;
}

export class StatementError extends Error {}

/** 파일을 2차원 문자열 배열로 읽는다. */
async function readGrid(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    // 카드사 CSV는 보통 EUC-KR이다. UTF-8로 읽어 깨지면 EUC-KR로 다시 읽는다.
    const buf = await file.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("�")) {
      try {
        text = new TextDecoder("euc-kr").decode(buf);
      } catch {
        /* 브라우저가 euc-kr을 모르면 그대로 둔다 */
      }
    }
    return parseCsv(text);
  }

  // 엑셀: SheetJS는 무거워서 파일을 실제로 열 때만 불러온다
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new StatementError("엑셀에서 시트를 찾지 못했습니다.");
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
}

/** 따옴표와 줄바꿈을 처리하는 최소한의 CSV 파서 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, "").trim();

/** 컬럼 이름 후보와 맞는 열 번호를 찾는다 */
function findColumn(header: string[], candidates: readonly string[]): number {
  // 정확히 일치하는 것 우선
  for (let i = 0; i < header.length; i++) {
    if (candidates.includes(clean(header[i]))) return i;
  }
  // 포함 관계 («이용금액(원)» 같은 변형)
  for (let i = 0; i < header.length; i++) {
    const h = clean(header[i]);
    if (h && candidates.some((c) => h.includes(c))) return i;
  }
  return -1;
}

/**
 * 날짜 문자열을 연/월/일로. 다양한 형식을 받는다.
 *
 * @param today 연도가 없는 날짜의 연도를 추정하는 기준
 */
function parseDate(
  raw: string,
  today: { year: number; month: number },
): { y: number; m: number; d: number } | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  // 2026-09-16 / 2026.09.16 / 2026/09/16 / 20260916
  let m = s.match(/(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };

  // 09/16 · 09.16 (연도 없음)
  m = s.match(/(?<!\d)(\d{1,2})[-./](\d{1,2})(?!\d)/);
  if (m) {
    const month = +m[1];
    // 1월에 "12/28"을 만나면 지난해 12월이다. 올해로 잡으면 11개월 뒤가 된다.
    // 카드 내역은 과거 기록이므로, 오늘보다 한참 뒤 달이면 지난해로 본다.
    const year = month > today.month + 1 ? today.year - 1 : today.year;
    return { y: year, m: month, d: +m[2] };
  }

  return null;
}

function parseAmount(raw: string): number {
  const s = String(raw ?? "").replace(/[^\d.-]/g, "");
  if (!s) return 0;
  const v = Math.round(parseFloat(s));
  return Number.isFinite(v) ? v : 0;
}

/**
 * 이용내역 파일을 파싱한다.
 *
 * @param defaults 범주·세대·결제수단 기본값. 상호명 규칙이 있으면 호출부가 덮어쓴다.
 */
export async function parseStatement(
  file: File,
  defaults: { household: HouseholdKey; payment: string; year: number; month?: number },
): Promise<ParseResult> {
  // 연도가 없는 날짜를 해석할 기준. 호출부가 월을 주지 않으면 오늘 기준.
  const today = { year: defaults.year, month: defaults.month ?? new Date().getMonth() + 1 };
  const grid = await readGrid(file);
  if (!grid.length) throw new StatementError("파일이 비어 있습니다.");

  // 헤더 행 찾기 — 날짜·가맹점·금액 컬럼이 모두 잡히는 첫 행.
  // 카드사 파일은 위쪽에 제목·조회기간 같은 줄이 붙어 있는 경우가 많다.
  let headerIdx = -1;
  let cols = { date: -1, merchant: -1, amount: -1 };
  for (let i = 0; i < Math.min(grid.length, 30); i++) {
    const c = {
      date: findColumn(grid[i], HEADERS.date),
      merchant: findColumn(grid[i], HEADERS.merchant),
      amount: findColumn(grid[i], HEADERS.amount),
    };
    if (c.date >= 0 && c.merchant >= 0 && c.amount >= 0) {
      headerIdx = i;
      cols = c;
      break;
    }
  }

  if (headerIdx < 0) {
    throw new StatementError(
      "이용일자·가맹점명·이용금액 컬럼을 찾지 못했습니다. " +
        "카드사에서 '이용내역'을 엑셀이나 CSV로 내려받은 파일인지 확인해주세요.",
    );
  }

  const header = grid[headerIdx];
  const kindIdx = findColumn(header, HEADERS.kind);

  const rows: StatementRow[] = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = grid[i];
    if (!r || !r.length) continue;

    const amount = parseAmount(r[cols.amount]);
    const date = parseDate(r[cols.date], today);
    const merchant = String(r[cols.merchant] ?? "").trim();

    // 합계 행이나 빈 행
    if (!date || !merchant || amount === 0) {
      skipped++;
      continue;
    }

    const kind = String(kindIdx >= 0 ? r[kindIdx] : "");
    const canceled = /취소|환불/.test(kind) || amount < 0;

    rows.push({
      include: !canceled,
      year: date.y,
      month: date.m,
      day: date.d,
      merchant,
      amount: Math.abs(amount),
      canceled,
      duplicate: false,
      category: "기타",
      household: defaults.household,
      payment: defaults.payment,
    });
  }

  if (!rows.length) {
    throw new StatementError("읽을 수 있는 거래가 없습니다. 다른 파일을 확인해주세요.");
  }

  return {
    rows,
    columns: {
      date: String(header[cols.date]),
      merchant: String(header[cols.merchant]),
      amount: String(header[cols.amount]),
    },
    skipped,
  };
}

export const toTransaction = (r: StatementRow): Transaction => ({
  year: r.year,
  month: r.month,
  day: r.day,
  household: r.household,
  category: r.category,
  description: r.merchant,
  payment: r.payment,
  amount: r.amount,
});
