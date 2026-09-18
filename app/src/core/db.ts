/**
 * 로컬 저장소 (IndexedDB / Dexie).
 *
 * 데이터는 이 폰 안에만 있다. 서버가 없으므로 백업이 유일한 안전장치다 —
 * `backup.ts` 참조.
 */
import Dexie, { type EntityTable } from "dexie";
import type { Adjustment, HouseholdKey, Transaction } from "./settlement";

/** 상호명 → 범주 학습. 한 번 고치면 다음부터 자동 분류된다. */
export interface MerchantRule {
  id?: number;
  /** 정규화된 상호명 (소문자, 공백 제거) */
  key: string;
  merchant: string;
  category: string;
  household: HouseholdKey;
  payment: string;
  /** 사용 횟수. 퀵 입력 버튼 정렬에 쓴다 */
  count: number;
  lastUsed: number;
}

export interface Setting {
  key: string;
  value: string;
}

const db = new Dexie("mageum") as Dexie & {
  transactions: EntityTable<Transaction, "id">;
  adjustments: EntityTable<Adjustment, "id">;
  merchants: EntityTable<MerchantRule, "id">;
  settings: EntityTable<Setting, "key">;
};

db.version(1).stores({
  transactions: "++id, [year+month], year, household, category, day",
  adjustments: "++id, [year+month]",
  merchants: "++id, &key, count, lastUsed",
  settings: "key",
});

export { db };

export const merchantKey = (s: string) =>
  (s ?? "").trim().toLowerCase().replace(/\s+/g, "");

/** 상호명 → 저장된 규칙 조회 */
export async function lookupMerchant(name: string) {
  const k = merchantKey(name);
  if (!k) return undefined;
  return db.merchants.where("key").equals(k).first();
}

/** 거래를 기록하면서 상호명 규칙도 함께 학습한다. */
export async function addTransaction(t: Transaction) {
  const id = await db.transactions.add(t);
  await learnMerchant(t);
  return id;
}

/**
 * 거래를 고치면서 상호명 규칙도 함께 갱신한다.
 *
 * 범주를 손으로 고치는 일은 대부분 **수정 화면**에서 일어난다. 여기서 학습하지
 * 않으면 "한 번 고치면 다음부터 자동 분류된다"가 성립하지 않아, 같은 가게를
 * 매번 다시 고쳐야 한다.
 */
export async function updateTransaction(id: number, t: Transaction) {
  await db.transactions.update(id, { ...t });
  await learnMerchant(t);
}

async function learnMerchant(t: Transaction) {
  const k = merchantKey(t.description);
  if (!k) return;
  const existing = await db.merchants.where("key").equals(k).first();
  if (existing) {
    await db.merchants.update(existing.id!, {
      category: t.category,
      household: t.household,
      payment: t.payment,
      count: existing.count + 1,
      lastUsed: Date.now(),
    });
  } else {
    await db.merchants.add({
      key: k,
      merchant: t.description.trim(),
      category: t.category,
      household: t.household,
      payment: t.payment,
      count: 1,
      lastUsed: Date.now(),
    });
  }
}

export async function getSetting(key: string) {
  return (await db.settings.get(key))?.value;
}

export async function setSetting(key: string, value: string) {
  await db.settings.put({ key, value });
}

/* ------------------------------------------------------------------ */
/* 최초 실행                                                            */
/* ------------------------------------------------------------------ */

/**
 * 과거 기록은 코드에 넣지 않는다.
 *
 * GitHub Pages 무료 등급은 **공개 저장소에서만** 동작한다. 엑셀에서 추출한
 * 거래 449건을 앱 소스에 두면 상호명·날짜·금액이 그대로 인터넷에 공개된다.
 * 그래서 데이터는 저장소 밖에 두고, 설정 화면의 "백업 파일에서 복원"으로
 * 폰에 직접 넣는다. 초기 파일은 `tools/extract.py --backup` 이 만든다.
 *
 * 앱은 항상 빈 상태로 시작한다.
 */
export async function isEmpty(): Promise<boolean> {
  return (await db.transactions.count()) === 0;
}
