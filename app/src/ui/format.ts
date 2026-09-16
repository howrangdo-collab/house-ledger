export const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** 부호를 붙여서. 정산 GAP 표시용 */
export const wonSigned = (n: number) => {
  const r = Math.round(n);
  return (r > 0 ? "+" : r < 0 ? "−" : "") + Math.abs(r).toLocaleString("ko-KR");
};

export const monthLabel = (year: number, month: number) => `${year}년 ${month}월`;

/** 오늘 기준 연/월 */
export function currentYm() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function shiftMonth(year: number, month: number, delta: number) {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}
