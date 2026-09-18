import { useEffect, useRef, useState } from "react";
import { CATEGORIES, PAYMENTS } from "../core/categories";
import { HOUSEHOLDS, type HouseholdKey, type Transaction } from "../core/settlement";
import { lookupMerchant } from "../core/db";

export interface TxnDraft {
  year: number;
  month: number;
  day: number;
  household: HouseholdKey;
  description: string;
  category: string;
  payment: string;
  amount: number;
}

export function toDraft(t: Transaction): TxnDraft {
  return {
    year: t.year,
    month: t.month,
    day: t.day ?? 1,
    household: t.household,
    description: t.description,
    category: t.category,
    payment: t.payment,
    amount: t.amount,
  };
}

/**
 * 거래 입력 폼. 추가와 수정 양쪽에서 쓴다.
 *
 * `learnFromMerchant`가 켜져 있으면 상호명을 입력했을 때 과거 기록에서
 * 범주·세대·결제수단을 자동으로 채운다.
 */
export function TxnForm({
  value,
  onChange,
  learnFromMerchant = true,
}: {
  value: TxnDraft;
  onChange: (v: TxnDraft) => void;
  learnFromMerchant?: boolean;
}) {
  const set = <K extends keyof TxnDraft>(k: K, v: TxnDraft[K]) =>
    onChange({ ...value, [k]: v });

  // 금액 입력은 문자열로 들고 있어야 지우는 중에 0이 튀어나오지 않는다
  const [amountText, setAmountText] = useState(value.amount ? String(value.amount) : "");
  useEffect(() => {
    setAmountText(value.amount ? String(value.amount) : "");
  }, [value.amount]);

  const [autoFilled, setAutoFilled] = useState<string | null>(null);

  /**
   * 최신 값을 따로 들고 있는다.
   *
   * 상호 칸에서 범주 버튼을 바로 누르면 blur 가 먼저 나고, 조회가 끝날 무렵엔
   * 사용자가 이미 범주를 고른 뒤다. blur 시점의 값으로 덮어쓰면 방금 고른
   * 범주가 되돌아간다.
   */
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  async function onMerchantBlur() {
    const before = latest.current;
    if (!learnFromMerchant || !before.description.trim()) return;
    const rule = await lookupMerchant(before.description);
    if (!rule) return;
    const now = latest.current;
    // 기다리는 사이에 상호가 또 바뀌었으면 이 결과는 낡은 것이다
    if (now.description !== before.description) return;
    const touched = {
      category: now.category !== before.category,
      household: now.household !== before.household,
      payment: now.payment !== before.payment,
    };
    onChange({
      ...now,
      category: touched.category ? now.category : rule.category,
      household: touched.household ? now.household : rule.household,
      payment: touched.payment ? now.payment : rule.payment,
    });
    setAutoFilled(`${rule.merchant} → ${rule.category} (지난 기록에서 자동 입력)`);
  }

  const daysInMonth = new Date(value.year, value.month, 0).getDate();

  return (
    <>
      <div className="field">
        <label>어느 세대</label>
        <div className="chips">
          {(Object.keys(HOUSEHOLDS) as HouseholdKey[]).map((k) => (
            <button
              key={k}
              className={`chip ${value.household === k ? "on" : ""}`}
              onClick={() => set("household", k)}
            >
              {HOUSEHOLDS[k].label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>금액</label>
        <input
          className="amount"
          type="text"
          inputMode="numeric"
          value={amountText}
          placeholder="0"
          onChange={(e) => {
            const digits = e.target.value.replace(/[^\d]/g, "");
            setAmountText(digits);
            set("amount", digits ? parseInt(digits, 10) : 0);
          }}
        />
      </div>

      <div className="field">
        <label>어디서</label>
        <input
          type="text"
          value={value.description}
          placeholder="가게 이름"
          onChange={(e) => {
            setAutoFilled(null);
            set("description", e.target.value);
          }}
          onBlur={onMerchantBlur}
        />
        {autoFilled && <div className="hint">{autoFilled}</div>}
      </div>

      <div className="field">
        <label>범주</label>
        <div className="chips">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              className={`chip ${value.category === c ? "on" : ""}`}
              onClick={() => set("category", c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>결제수단</label>
        <div className="chips">
          {PAYMENTS.map((p) => (
            <button
              key={p}
              className={`chip ${value.payment === p ? "on" : ""}`}
              onClick={() => set("payment", p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>날짜</label>
        <input
          type="date"
          value={`${value.year}-${String(value.month).padStart(2, "0")}-${String(
            Math.min(value.day, daysInMonth),
          ).padStart(2, "0")}`}
          onChange={(e) => {
            const [y, mo, d] = e.target.value.split("-").map(Number);
            if (!y || !mo || !d) return;
            onChange({ ...value, year: y, month: mo, day: d });
          }}
        />
      </div>
    </>
  );
}
