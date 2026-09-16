/**
 * 2세대 정산 엔진.
 *
 * 엑셀 장부(2024/9~2026/12, 28개월)의 계산을 그대로 재현한다.
 * 셀 대응은 프로젝트 루트 CLAUDE.md의 "정산 계산 순서" 표 참조.
 */

export type HouseholdKey = "eunji" | "jisu";

export const HOUSEHOLDS: Record<HouseholdKey, { label: string; ratio: number }> = {
  // 엑셀 Q2 = 2/5, Q4 = 3/5. 36개 월 시트 전부 동일한 하드코딩.
  eunji: { label: "은지네", ratio: 2 / 5 },
  jisu: { label: "지수네", ratio: 3 / 5 },
};

export interface Transaction {
  id?: number;
  year: number;
  month: number;
  day: number | null;
  household: HouseholdKey;
  category: string;
  description: string;
  payment: string;
  amount: number;
}

/** 누적 GAP에 손으로 넣는 보정. 엑셀에서는 수식에 박혀 있어 추적이 불가능했다. */
export interface Adjustment {
  id?: number;
  year: number;
  month: number;
  amount: number; // 은지네 GAP 기준 가감액
  reason: string;
}

export interface MonthSettlement {
  year: number;
  month: number;
  /** 세대별 실제 결제액 (엑셀 P2, P4) */
  paid: Record<HouseholdKey, number>;
  /** 전체 공동지출 (엑셀 P6) */
  total: number;
  /** 세대별 부담해야 할 금액 (엑셀 P8, P10) */
  share: Record<HouseholdKey, number>;
  /** 세대별 GAP = 실제 결제액 - 부담액 (엑셀 P12, P14). 양수면 받을 돈 */
  gap: Record<HouseholdKey, number>;
  /** 이 달의 수동 보정 합계 */
  adjustment: number;
  /** 누적 GAP, 은지네 기준 (엑셀 Q12) */
  cumulative: number;
}

const ym = (year: number, month: number) => year * 12 + (month - 1);

/**
 * 월별 정산을 시간순으로 계산한다.
 *
 * @param carryIn 최초 월 이전의 이월 누적값 (엑셀 1월 N16에 해당)
 */
export function settle(
  transactions: Transaction[],
  adjustments: Adjustment[] = [],
  carryIn = 0,
): MonthSettlement[] {
  const buckets = new Map<number, MonthSettlement>();

  const bucketFor = (year: number, month: number): MonthSettlement => {
    const key = ym(year, month);
    let b = buckets.get(key);
    if (!b) {
      b = {
        year,
        month,
        paid: { eunji: 0, jisu: 0 },
        total: 0,
        share: { eunji: 0, jisu: 0 },
        gap: { eunji: 0, jisu: 0 },
        adjustment: 0,
        cumulative: 0,
      };
      buckets.set(key, b);
    }
    return b;
  };

  for (const t of transactions) {
    bucketFor(t.year, t.month).paid[t.household] += t.amount;
  }
  for (const a of adjustments) {
    bucketFor(a.year, a.month).adjustment += a.amount;
  }

  const months = [...buckets.values()].sort(
    (a, b) => ym(a.year, a.month) - ym(b.year, b.month),
  );

  let running = carryIn;
  for (const m of months) {
    m.total = m.paid.eunji + m.paid.jisu;
    for (const key of ["eunji", "jisu"] as const) {
      m.share[key] = m.total * HOUSEHOLDS[key].ratio;
      m.gap[key] = m.paid[key] - m.share[key];
    }
    running += m.gap.eunji + m.adjustment;
    m.cumulative = running;
  }

  return months;
}

/**
 * 누적 GAP을 사람이 읽는 문장으로. 양수면 은지네가 더 냈으므로 받을 돈이다.
 */
export function describeCumulative(cumulative: number): string {
  const won = Math.round(Math.abs(cumulative)).toLocaleString("ko-KR");
  if (Math.round(cumulative) === 0) return "정산 완료 (주고받을 금액 없음)";
  return cumulative > 0
    ? `지수네 → 은지네 ${won}원`
    : `은지네 → 지수네 ${won}원`;
}
