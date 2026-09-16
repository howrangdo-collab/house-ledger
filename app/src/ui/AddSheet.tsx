import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { addTransaction, db, lookupMerchant } from "../core/db";
import { normalizePayment } from "../core/categories";
import { parsePasted } from "../core/textParse";
import { Sheet } from "./Sheet";
import { TxnForm, type TxnDraft } from "./TxnForm";
import { StatementImport } from "./StatementImport";
import { currentYm, won } from "./format";

type Mode = "paste" | "quick" | "manual" | "statement";

function blankDraft(): TxnDraft {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    household: "eunji",
    description: "",
    category: "식비",
    payment: "신용카드",
    amount: 0,
  };
}

export function AddSheet({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("paste");
  const [draft, setDraft] = useState<TxnDraft>(blankDraft());
  /** 값을 채워 폼 단계로 넘어갔는지 */
  const [staged, setStaged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");

  const frequent = useLiveQuery(
    () => db.merchants.orderBy("count").reverse().limit(8).toArray(),
    [],
  );

  /* ------------------------------------------------ 결제 알림 붙여넣기 */
  async function applyPaste() {
    setError(null);
    const r = parsePasted(pasted);
    if (!r) {
      setError("결제 내용을 찾지 못했습니다. 전체를 복사했는지 확인하거나 직접 입력해주세요.");
      return;
    }
    const now = new Date();
    const rule = r.merchant ? await lookupMerchant(r.merchant) : undefined;
    setDraft({
      year: now.getFullYear(),
      month: r.month ?? now.getMonth() + 1,
      day: r.day ?? now.getDate(),
      household: rule?.household ?? "eunji",
      description: r.merchant,
      category: rule?.category ?? "식비",
      payment: normalizePayment(r.payment),
      amount: r.amount,
    });
    setStaged(true);
    setNotice(
      r.canceled
        ? "취소 알림으로 보입니다. 기록할 내용이 맞는지 확인해주세요."
        : `${r.merchant || "상호 미확인"} · ${won(r.amount)}원으로 읽었습니다.`,
    );
  }

  async function save() {
    await addTransaction({
      year: draft.year,
      month: draft.month,
      day: draft.day,
      household: draft.household,
      category: draft.category,
      description: draft.description.trim(),
      payment: draft.payment,
      amount: draft.amount,
    });
    onClose();
  }

  function reset() {
    setStaged(false);
    setNotice(null);
    setError(null);
    setPasted("");
    setDraft(blankDraft());
  }

  /* ------------------------------------------------------------ 카드 내역 */
  if (mode === "statement") return <StatementImport onClose={onClose} />;

  /* --------------------------------------------------------------- 입력 폼 */
  if (staged || mode === "manual") {
    return (
      <Sheet title="항목 추가" onClose={onClose}>
        {notice && <div className="hint" style={{ marginBottom: 12 }}>{notice}</div>}
        <TxnForm value={draft} onChange={setDraft} />
        <button className="btn" onClick={save} disabled={draft.amount <= 0}>
          저장
        </button>
        <button
          className="btn ghost"
          style={{ marginTop: 8 }}
          onClick={() => {
            reset();
            setMode("paste");
          }}
        >
          취소
        </button>
      </Sheet>
    );
  }

  /* ----------------------------------------------------------- 모드 선택 */
  return (
    <Sheet title="항목 추가" onClose={onClose}>
      <div className="chips" style={{ marginBottom: 16 }}>
        <button className={`chip ${mode === "paste" ? "on" : ""}`} onClick={() => setMode("paste")}>
          알림 붙여넣기
        </button>
        <button className={`chip ${mode === "quick" ? "on" : ""}`} onClick={() => setMode("quick")}>
          자주 가는 곳
        </button>
        <button className="chip" onClick={() => setMode("manual")}>
          직접 입력
        </button>
        <button className="chip" onClick={() => setMode("statement")}>
          카드 내역 파일
        </button>
      </div>

      {mode === "paste" && (
        <>
          <div className="field">
            <label>결제 알림이나 영수증 글자를 붙여넣으세요</label>
            <textarea
              value={pasted}
              onChange={(e) => {
                setPasted(e.target.value);
                setError(null);
              }}
              rows={5}
              placeholder={"카드 앱 푸시 알림이나 문자를 길게 눌러 복사한 뒤\n여기에 붙여넣으세요."}
              style={{ resize: "none", lineHeight: 1.5 }}
            />
          </div>
          <button className="btn" onClick={applyPaste} disabled={!pasted.trim()}>
            읽어오기
          </button>
          <div className="hint">
            상호·금액·날짜를 자동으로 뽑아냅니다. <strong>비용이 들지 않습니다.</strong>
            <br />
            영수증은 사진을 찍은 뒤 <strong>사진 앱에서 글자를 길게 눌러 전체 선택 →
            복사</strong> 하면 됩니다. 아이폰이 기기 안에서 글자를 읽어주므로 사진이
            밖으로 나가지 않습니다.
          </div>
          {error && <div className="err">{error}</div>}
        </>
      )}

      {mode === "quick" && (
        <>
          {!frequent?.length && (
            <div className="empty">아직 기록이 없습니다. 몇 건 입력하면 여기에 모입니다.</div>
          )}
          <div className="quickgrid">
            {frequent?.map((r) => (
              <button
                className="quick"
                key={r.id}
                onClick={() => {
                  const { year, month } = currentYm();
                  setDraft({
                    year,
                    month,
                    day: new Date().getDate(),
                    household: r.household,
                    description: r.merchant,
                    category: r.category,
                    payment: r.payment,
                    amount: 0,
                  });
                  setStaged(true);
                  setNotice("금액만 넣으면 됩니다.");
                }}
              >
                <div className="m">{r.merchant}</div>
                <div className="c">
                  {r.category} · {r.count}회
                </div>
              </button>
            ))}
          </div>
        </>
      )}

    </Sheet>
  );
}
