/** 범주·결제수단 목록. 엑셀 `LIST` 시트에서 그대로 가져왔다. */

/**
 * 유동비 14종. 엑셀 LIST!F5:F18.
 * 고정비/투자 구분은 엑셀에서도 전 월 미사용이라 옮기지 않았다.
 */
export const CATEGORIES = [
  "식비",
  "주거",
  "의류",
  "교통비",
  "차량유지비",
  "통신",
  "의료",
  "미용",
  "자기계발",
  "문화여가",
  "친목",
  "선물/용돈",
  "경조사",
  "기타",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** 엑셀 LIST!H5:H10 */
export const PAYMENTS = [
  "신용카드",
  "체크카드",
  "현금",
  "카카오페이",
  "삼성페이",
  "지역화폐",
] as const;

export type Payment = (typeof PAYMENTS)[number];

/** 범주별 색상. 목록·차트에서 한눈에 구분하기 위한 것. */
export const CATEGORY_COLOR: Record<string, string> = {
  식비: "#e8743b",
  주거: "#6b8cc7",
  의류: "#c76b9e",
  교통비: "#5aa9a3",
  차량유지비: "#8b7cc7",
  통신: "#4d8fbf",
  의료: "#cc5f5f",
  미용: "#d98cb3",
  자기계발: "#7ba05b",
  문화여가: "#d4a03c",
  친목: "#b8873f",
  "선물/용돈": "#a67bc7",
  경조사: "#8a8f98",
  기타: "#9aa0a6",
};

export const colorOf = (category: string) => CATEGORY_COLOR[category] ?? "#9aa0a6";

/** 알 수 없는 범주를 허용된 값으로 보정한다. 엑셀에는 오분류가 섞여 있다. */
export function normalizeCategory(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "기타";
  if ((CATEGORIES as readonly string[]).includes(s)) return s;
  // 엑셀 고정비 범주와 유동비 범주가 겹치는 경우를 흡수
  const alias: Record<string, string> = {
    "용돈/선물": "선물/용돈",
    자녀교육: "자기계발",
    대출: "주거",
    보험: "기타",
    기부: "기타",
  };
  return alias[s] ?? "기타";
}

export function normalizePayment(raw: string): string {
  const s = (raw ?? "").trim();
  return (PAYMENTS as readonly string[]).includes(s) ? s : "신용카드";
}
