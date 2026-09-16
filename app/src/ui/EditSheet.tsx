import { useState } from "react";
import type { Transaction } from "../core/settlement";
import { db } from "../core/db";
import { Sheet } from "./Sheet";
import { TxnForm, toDraft, type TxnDraft } from "./TxnForm";

export function EditSheet({
  transaction,
  onClose,
  onDelete,
}: {
  transaction: Transaction;
  onClose: () => void;
  onDelete: (id: number) => void;
}) {
  const [draft, setDraft] = useState<TxnDraft>(toDraft(transaction));
  const [confirming, setConfirming] = useState(false);

  async function save() {
    await db.transactions.update(transaction.id!, { ...draft });
    onClose();
  }

  return (
    <Sheet title="항목 수정" onClose={onClose}>
      <TxnForm value={draft} onChange={setDraft} />

      <button className="btn" onClick={save} disabled={draft.amount <= 0}>
        저장
      </button>

      {confirming ? (
        <div className="banner" style={{ marginTop: 10 }}>
          <span>정말 삭제할까요? 되돌릴 수 없습니다.</span>
          <button onClick={() => onDelete(transaction.id!)}>삭제</button>
        </div>
      ) : (
        <button
          className="btn danger"
          style={{ marginTop: 8 }}
          onClick={() => setConfirming(true)}
        >
          삭제
        </button>
      )}
    </Sheet>
  );
}
