import { useMemo } from "react";
import { HOUSEHOLDS, describeCumulative, type HouseholdKey } from "../core/settlement";
import { colorOf } from "../core/categories";
import { useMonthSettlement, useMonthTransactions, useSettlements } from "./useLedger";
import { won, wonSigned } from "./format";

const KEYS: HouseholdKey[] = ["eunji", "jisu"];

export function SettlementView({ year, month }: { year: number; month: number }) {
  const m = useMonthSettlement(year, month);
  const all = useSettlements();
  const txns = useMonthTransactions(year, month);

  const byCategory = useMemo(() => {
    if (!txns) return [];
    const map = new Map<string, number>();
    for (const t of txns) map.set(t.category, (map.get(t.category) ?? 0) + t.amount);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [txns]);

  /** 전월까지의 누적. 이번 달이 얼마나 움직였는지 보여주기 위한 것. */
  const prevCumulative = useMemo(() => {
    if (!all) return 0;
    const idx = all.findIndex((x) => x.year === year && x.month === month);
    return idx > 0 ? all[idx - 1].cumulative : 0;
  }, [all, year, month]);

  if (!m) {
    return (
      <div className="page">
        <div className="empty">
          이 달은 아직 기록이 없습니다.
          <br />
          아래 + 버튼으로 첫 항목을 추가해보세요.
        </div>
      </div>
    );
  }

  const maxCat = byCategory.length ? byCategory[0][1] : 1;
  const settled = Math.round(m.cumulative) === 0;

  return (
    <div className="page">
      <div className="verdict">
        <div className="who">{settled ? "누적 정산" : "지금까지 누적하면"}</div>
        <div className="amount">{describeCumulative(m.cumulative)}</div>
        <div className="note">
          {year}년 {month}월까지 합산 · 이번 달 {wonSigned(m.cumulative - prevCumulative)}원
        </div>
      </div>

      <div className="card">
        <h2>이번 달</h2>
        <div className="pair">
          {KEYS.map((k) => (
            <div className="house" key={k}>
              <div className="name">
                <span>{HOUSEHOLDS[k].label}</span>
                <span className="ratio">{Math.round(HOUSEHOLDS[k].ratio * 100)}%</span>
              </div>
              <div className="paid">{won(m.paid[k])}원</div>
              <div className={`gap ${m.gap[k] >= 0 ? "plus" : "minus"}`}>
                {m.gap[k] >= 0 ? "더 냄 " : "덜 냄 "}
                {won(Math.abs(m.gap[k]))}원
              </div>
            </div>
          ))}
        </div>

        <div className="rows" style={{ marginTop: 14 }}>
          <div className="row">
            <span className="k">공동지출 합계</span>
            <span className="v">{won(m.total)}원</span>
          </div>
          <div className="row">
            <span className="k">은지네 부담 (40%)</span>
            <span className="v">{won(m.share.eunji)}원</span>
          </div>
          <div className="row">
            <span className="k">지수네 부담 (60%)</span>
            <span className="v">{won(m.share.jisu)}원</span>
          </div>
          {m.adjustment !== 0 && (
            <div className="row">
              <span className="k">수동 보정</span>
              <span className="v">{wonSigned(m.adjustment)}원</span>
            </div>
          )}
        </div>
      </div>

      {byCategory.length > 0 && (
        <div className="card">
          <h2>범주별</h2>
          <div className="bar">
            {byCategory.map(([cat, amt]) => (
              <div className="line" key={cat}>
                <span className="swatch" style={{ background: colorOf(cat) }} />
                <span className="cat">{cat}</span>
                <span className="track">
                  <span
                    className="fill"
                    style={{ width: `${(amt / maxCat) * 100}%`, background: colorOf(cat) }}
                  />
                </span>
                <span className="amt">{won(amt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
