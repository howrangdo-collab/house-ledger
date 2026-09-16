import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { db } from "../core/db";
import { settle, type MonthSettlement } from "../core/settlement";

/**
 * 전체 거래로 정산을 계산한다.
 *
 * 누적 GAP은 첫 달부터 순서대로 더해야 나오므로 특정 달만 떼어 계산할 수 없다.
 * 데이터가 수백 건 규모라 전량 계산해도 부담이 없다.
 */
export function useSettlements(): MonthSettlement[] | undefined {
  const transactions = useLiveQuery(() => db.transactions.toArray(), []);
  const adjustments = useLiveQuery(() => db.adjustments.toArray(), []);

  return useMemo(() => {
    if (!transactions || !adjustments) return undefined;
    return settle(transactions, adjustments, 0);
  }, [transactions, adjustments]);
}

export function useMonthSettlement(year: number, month: number) {
  const all = useSettlements();
  return useMemo(() => {
    if (!all) return undefined;
    return all.find((m) => m.year === year && m.month === month);
  }, [all, year, month]);
}

/** 가장 최근 달의 누적 GAP. 실제로 주고받아야 할 금액이다. */
export function useLatestCumulative(): number | undefined {
  const all = useSettlements();
  if (!all) return undefined;
  return all.length ? all[all.length - 1].cumulative : 0;
}

export function useMonthTransactions(year: number, month: number) {
  return useLiveQuery(
    () => db.transactions.where("[year+month]").equals([year, month]).toArray(),
    [year, month],
  );
}
