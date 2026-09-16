import { useMemo, useState } from "react";
import { colorOf } from "../core/categories";
import { HOUSEHOLDS, type HouseholdKey, type Transaction } from "../core/settlement";
import { db } from "../core/db";
import { useMonthTransactions } from "./useLedger";
import { won } from "./format";
import { EditSheet } from "./EditSheet";

type Filter = "all" | HouseholdKey;

export function LedgerView({ year, month }: { year: number; month: number }) {
  const txns = useMonthTransactions(year, month);
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Transaction | null>(null);

  const groups = useMemo(() => {
    const rows = (txns ?? []).filter((t) => filter === "all" || t.household === filter);
    const map = new Map<number, Transaction[]>();
    for (const t of rows) {
      const d = t.day ?? 0;
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(t);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [txns, filter]);

  const total = (txns ?? [])
    .filter((t) => filter === "all" || t.household === filter)
    .reduce((s, t) => s + t.amount, 0);

  return (
    <div className="page">
      <div className="chips" style={{ marginTop: 12 }}>
        {(["all", "eunji", "jisu"] as Filter[]).map((f) => (
          <button
            key={f}
            className={`chip ${filter === f ? "on" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "전체" : HOUSEHOLDS[f].label}
          </button>
        ))}
        <span style={{ marginLeft: "auto", alignSelf: "center", fontSize: 14, fontWeight: 600 }}>
          {won(total)}원
        </span>
      </div>

      {groups.length === 0 && <div className="empty">기록이 없습니다.</div>}

      {groups.map(([day, rows]) => (
        <div className="daygroup" key={day}>
          <div className="dayhead">
            <span>{day ? `${month}월 ${day}일` : "날짜 없음"}</span>
            <span>{won(rows.reduce((s, t) => s + t.amount, 0))}원</span>
          </div>
          {rows.map((t) => (
            <button className="txn" key={t.id} onClick={() => setEditing(t)}>
              <span className="dot" style={{ background: colorOf(t.category) }} />
              <span className="body">
                <span className="desc">{t.description || t.category}</span>
                <span className="meta">
                  {HOUSEHOLDS[t.household].label} · {t.category} · {t.payment}
                </span>
              </span>
              <span className="amt">{won(t.amount)}</span>
            </button>
          ))}
        </div>
      ))}

      {editing && (
        <EditSheet
          transaction={editing}
          onClose={() => setEditing(null)}
          onDelete={async (id) => {
            await db.transactions.delete(id);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
