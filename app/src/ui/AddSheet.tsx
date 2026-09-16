import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { addTransaction, db, getSetting } from "../core/db";
import { normalizeCategory, normalizePayment } from "../core/categories";
import { Sheet } from "./Sheet";
import { TxnForm, type TxnDraft } from "./TxnForm";
import { currentYm, won } from "./format";

type Mode = "scan" | "quick" | "manual";

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
  const [mode, setMode] = useState<Mode>("scan");
  const [draft, setDraft] = useState<TxnDraft>(blankDraft());
  /** 폼이 열렸는지. 스캔/퀵에서 값을 채우면 폼 단계로 넘어간다. */
  const [staged, setStaged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const frequent = useLiveQuery(
    () => db.merchants.orderBy("count").reverse().limit(8).toArray(),
    [],
  );

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      // Anthropic SDK는 무겁고 스캔할 때만 필요하다. 첫 화면 로딩에서 빼기 위해
      // 여기서 처음 불러온다.
      const { scanReceipt, splitDate, ApiKeyMissing } = await import("../core/receipt");
      const apiKey = (await getSetting("apiKey")) ?? "";
      let r;
      try {
        r = await scanReceipt(file, apiKey);
      } catch (e) {
        if (e instanceof ApiKeyMissing) {
          setError("설정 탭에서 API 키를 먼저 넣어주세요.");
          return;
        }
        throw e;
      }
      const d = splitDate(r.date);
      setDraft({
        ...d,
        household: draft.household,
        description: r.merchant,
        category: normalizeCategory(r.category),
        payment: normalizePayment(r.payment),
        amount: Math.round(r.total),
      });
      setStaged(true);
      setNotice(
        r.confidence === "low"
          ? "흐릿하게 읽힌 부분이 있습니다. 금액과 상호를 확인해주세요."
          : `${r.merchant} · ${won(r.total)}원으로 읽었습니다. 맞는지 확인해주세요.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "인식에 실패했습니다.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
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
            setStaged(false);
            setNotice(null);
            setDraft(blankDraft());
            setMode("scan");
          }}
        >
          취소
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet title="항목 추가" onClose={onClose}>
      <div className="chips" style={{ marginBottom: 16 }}>
        <button className={`chip ${mode === "scan" ? "on" : ""}`} onClick={() => setMode("scan")}>
          영수증 스캔
        </button>
        <button className={`chip ${mode === "quick" ? "on" : ""}`} onClick={() => setMode("quick")}>
          자주 가는 곳
        </button>
        <button className="chip" onClick={() => setMode("manual")}>
          직접 입력
        </button>
      </div>

      {mode === "scan" && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={(e) => onPick(e.target.files?.[0])}
          />
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" /> 영수증 읽는 중…
              </>
            ) : (
              "카메라로 영수증 찍기"
            )}
          </button>
          <div className="hint">
            영수증 전체가 화면에 들어오게 찍으면 상호·금액·날짜를 자동으로 읽습니다.
            읽은 내용은 저장 전에 확인할 수 있습니다.
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
