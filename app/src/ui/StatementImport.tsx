import { useRef, useState } from "react";
import { db, lookupMerchant } from "../core/db";
import { rebuildMerchants } from "../core/backup";
import { HOUSEHOLDS, type HouseholdKey } from "../core/settlement";
import { CATEGORIES, colorOf, guessCategory } from "../core/categories";
import {
  parseStatement,
  StatementError,
  toTransaction,
  type StatementRow,
} from "../core/statement";
import { Sheet } from "./Sheet";
import { currentYm, won } from "./format";

/**
 * 카드사 이용내역 파일을 통째로 가져온다.
 *
 * 아이폰에서는 결제 알림을 앱이 자동으로 읽을 수 없으므로, 월 1회 이 방법으로
 * 넣는 것이 누락 없이 기록하는 가장 확실한 길이다. 비용도 들지 않는다.
 */
export function StatementImport({ onClose }: { onClose: () => void }) {
  const [household, setHousehold] = useState<HouseholdKey>("eunji");
  const [rows, setRows] = useState<StatementRow[] | null>(null);
  const [columns, setColumns] = useState<{ date: string; merchant: string; amount: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const { year, month } = currentYm();
      const parsed = await parseStatement(file, { household, payment: "신용카드", year, month });

      // 상호명 규칙으로 범주를 미리 채우고, 이미 있는 거래는 중복으로 표시한다.
      // 세대를 키에 넣어야 한다 — 두 세대가 같은 날 같은 가게에서 같은 금액을 쓰는 일이
      // 실제로 있고(농민식자재처럼 양쪽이 다 가는 곳), 세대를 빼면 한쪽이 누락된다.
      const existing = await db.transactions.toArray();
      const have = new Set(
        existing.map(
          (t) => `${t.year}|${t.month}|${t.day}|${t.household}|${t.description}|${t.amount}`,
        ),
      );

      const enriched: StatementRow[] = [];
      for (const r of parsed.rows) {
        const rule = await lookupMerchant(r.merchant);
        const duplicate = have.has(
          `${r.year}|${r.month}|${r.day}|${household}|${r.merchant}|${r.amount}`,
        );
        enriched.push({
          ...r,
          // 범주·결제수단은 지난 기록에서 가져오되, 세대는 사용자가 고른 값을 따른다.
          // 이 파일은 특정 카드의 내역이므로 "이 카드는 누구네 것"이 규칙보다 우선이다.
          category: rule?.category ?? guessCategory(r.merchant),
          household,
          payment: rule?.payment ?? "신용카드",
          duplicate,
          include: r.include && !duplicate,
        });
      }

      // 기록 화면과 같은 순서로 보여준다 — 날짜가 이른 것부터.
      // 카드사 파일은 최신순으로 오는 경우도 있어 그대로 두면 화면마다 순서가 다르다.
      enriched.sort((a, b) => a.year - b.year || a.month - b.month || a.day - b.day);

      setRows(enriched);
      setColumns(parsed.columns);
    } catch (e) {
      setError(
        e instanceof StatementError
          ? e.message
          : e instanceof Error
            ? `파일을 읽지 못했습니다: ${e.message}`
            : "파일을 읽지 못했습니다.",
      );
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function update(i: number, patch: Partial<StatementRow>) {
    setRows((prev) => prev && prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function save() {
    if (!rows) return;
    const picked = rows.filter((r) => r.include);
    if (!picked.length) return;
    await db.transactions.bulkAdd(picked.map(toTransaction));

    // 상호명 규칙은 한 번에 다시 세운다. 건마다 DB를 오가면 수십~수백 건짜리
    // 카드 내역에서 눈에 띄게 느려진다.
    await rebuildMerchants();

    setDone(picked.length);
  }

  /* ---------------------------------------------------------------- 결과 */
  if (done !== null) {
    return (
      <Sheet title="가져오기 완료" onClose={onClose}>
        <div className="verdict" style={{ marginTop: 0 }}>
          <div className="amount">{done}건</div>
          <div className="note">기록에 추가했습니다</div>
        </div>
        <button className="btn" style={{ marginTop: 14 }} onClick={onClose}>
          확인
        </button>
      </Sheet>
    );
  }

  /* ------------------------------------------------------------ 파일 선택 */
  if (!rows) {
    return (
      <Sheet title="카드 내역 가져오기" onClose={onClose}>
        <div className="field">
          <label>이 카드는 어느 세대 것인가요</label>
          <div className="chips">
            {(Object.keys(HOUSEHOLDS) as HouseholdKey[]).map((k) => (
              <button
                key={k}
                className={`chip ${household === k ? "on" : ""}`}
                onClick={() => setHousehold(k)}
              >
                {HOUSEHOLDS[k].label}
              </button>
            ))}
          </div>
          <div className="hint">
            가져온 뒤 항목별로 바꿀 수 있습니다. 이미 기록한 가게는 지난 분류를 따릅니다.
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          // 위와 같은 이유로 accept를 걸지 않는다. 형식이 맞지 않으면
          // parseStatement가 무엇이 잘못됐는지 알려준다.
          style={{ display: "none" }}
          onChange={(e) => onPick(e.target.files?.[0])}
        />
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? (
            <>
              <span className="spinner" /> 읽는 중…
            </>
          ) : (
            "내역 파일 선택"
          )}
        </button>

        <div className="hint">
          카드사 앱이나 홈페이지에서 <strong>이용내역을 엑셀/CSV로 내려받아</strong> 넣으세요.
          한 달치를 한 번에 기록할 수 있고, 문자 알림 서비스 없이도 빠뜨리는 항목이 없습니다.
          파일은 이 폰 안에서만 처리되고 어디로도 전송되지 않습니다.
        </div>

        {error && <div className="err">{error}</div>}
      </Sheet>
    );
  }

  /* -------------------------------------------------------------- 미리보기 */
  const picked = rows.filter((r) => r.include);
  const dupCount = rows.filter((r) => r.duplicate).length;
  const cancelCount = rows.filter((r) => r.canceled).length;
  const total = picked.reduce((s, r) => s + r.amount, 0);

  return (
    <Sheet title={`${rows.length}건 확인`} onClose={onClose}>
      <div className="hint" style={{ marginTop: 0 }}>
        읽은 컬럼: {columns?.date} · {columns?.merchant} · {columns?.amount}
        {dupCount > 0 && ` · 이미 있는 항목 ${dupCount}건은 체크 해제했습니다`}
        {cancelCount > 0 && ` · 취소 ${cancelCount}건 제외`}
      </div>

      <div className="rows" style={{ margin: "12px 0" }}>
        <div className="row">
          <span className="k">선택한 항목</span>
          <span className="v">
            {picked.length}건 · {won(total)}원
          </span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <button
          className="chip"
          onClick={() => setRows(rows.map((r) => ({ ...r, include: !r.duplicate && !r.canceled })))}
        >
          전체 선택
        </button>
        <button className="chip" onClick={() => setRows(rows.map((r) => ({ ...r, include: false })))}>
          전체 해제
        </button>
      </div>

      {rows.map((r, i) => (
        <div
          key={i}
          className="card"
          style={{ marginTop: 8, padding: 12, opacity: r.include ? 1 : 0.5 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="checkbox"
              checked={r.include}
              onChange={(e) => update(i, { include: e.target.checked })}
              style={{ width: 20, height: 20, flex: "none" }}
            />
            <span className="dot" style={{ background: colorOf(r.category), width: 8, height: 8, borderRadius: 3 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.merchant}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                {r.month}월 {r.day}일
                {r.duplicate && " · 이미 있음"}
                {r.canceled && " · 취소"}
              </div>
            </div>
            <div style={{ fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>{won(r.amount)}</div>
          </div>

          {r.include && (
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <select
                value={r.category}
                onChange={(e) => update(i, { category: e.target.value })}
                style={{
                  flex: 1,
                  background: "var(--surface-2)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: "6px 8px",
                }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                value={r.household}
                onChange={(e) => update(i, { household: e.target.value as HouseholdKey })}
                style={{
                  flex: "none",
                  background: "var(--surface-2)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: "6px 8px",
                }}
              >
                {(Object.keys(HOUSEHOLDS) as HouseholdKey[]).map((k) => (
                  <option key={k} value={k}>
                    {HOUSEHOLDS[k].label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      ))}

      <button className="btn" style={{ marginTop: 14 }} onClick={save} disabled={!picked.length}>
        {picked.length}건 기록하기
      </button>
      <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setRows(null)}>
        다른 파일 선택
      </button>
    </Sheet>
  );
}
