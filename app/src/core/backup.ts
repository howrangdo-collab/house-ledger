/**
 * 백업 / 내보내기.
 *
 * 데이터가 폰 안에만 있으므로 이것이 유일한 안전장치다. iOS 사파리의 저장공간
 * 정리 정책이 홈 화면 PWA의 IndexedDB에 적용되는지는 확인되지 않았다.
 * 날아가면 복구가 불가능하니 백업을 미루지 않게 만드는 것이 목적이다.
 */
import { db, getSetting, merchantKey, setSetting, type MerchantRule } from "./db";
import type { Adjustment, Transaction } from "./settlement";

/** 마지막 백업 시각을 담는 설정 키. App이 라이브 쿼리로 감시한다. */
export const LAST_BACKUP_KEY = "lastBackupAt";
const LAST_BACKUP = LAST_BACKUP_KEY;

export interface BackupFile {
  app: "mageum";
  version: 1;
  exportedAt: string;
  transactions: Transaction[];
  adjustments: Adjustment[];
}

export async function buildBackup(): Promise<BackupFile> {
  return {
    app: "mageum",
    version: 1,
    exportedAt: new Date().toISOString(),
    transactions: await db.transactions.toArray(),
    adjustments: await db.adjustments.toArray(),
  };
}

/**
 * 파일을 사용자에게 건넨다.
 *
 * 홈 화면에 설치한 iOS PWA에서는 `<a download>` 방식이 조용히 무시되는 경우가
 * 있다. 백업은 데이터를 지킬 유일한 수단이라 실패하면 안 되므로, 아이폰에서
 * 확실히 동작하는 **공유 시트**(파일에 저장/메일/메시지)를 먼저 시도한다.
 */
async function deliver(filename: string, content: string, mime: string) {
  const type = `${mime};charset=utf-8`;
  const file = new File([content], filename, { type });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      // 사용자가 공유 시트를 닫은 것이면 다운로드로 되풀이하지 않는다
      if (e instanceof DOMException && e.name === "AbortError") return;
      // 그 밖의 실패는 아래 다운로드로 넘어간다
    }
  }

  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 사파리가 다운로드를 시작할 시간을 준 뒤 해제한다
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");

export async function exportJson() {
  const data = await buildBackup();
  await deliver(`가계부_백업_${stamp()}.json`, JSON.stringify(data, null, 1), "application/json");
  await setSetting(LAST_BACKUP, new Date().toISOString());
  return data.transactions.length;
}

/**
 * 엑셀로 옮기기 위한 CSV. 엑셀 양식에 실제로 써넣는 것은 PC에서
 * `tools/import_to_excel.py` 가 한다 (브라우저에서는 드롭다운·서식을 지킬 수 없다).
 */
export async function exportCsv(year: number, month?: number) {
  let rows = await db.transactions.where("year").equals(year).toArray();
  if (month) rows = rows.filter((t) => t.month === month);
  rows.sort(
    (a, b) =>
      a.month - b.month ||
      (a.day ?? 0) - (b.day ?? 0) ||
      a.household.localeCompare(b.household),
  );

  const esc = (v: string | number | null) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = "연,월,일,세대,범주,상세,결제수단,금액";
  const body = rows.map((t) =>
    [t.year, t.month, t.day ?? "", t.household, t.category, t.description, t.payment, t.amount]
      .map(esc)
      .join(","),
  );

  const suffix = month ? `${year}년${month}월` : `${year}년`;
  // BOM: 엑셀이 UTF-8 CSV의 한글을 깨뜨리지 않게 한다
  await deliver(`가계부_${suffix}.csv`, "﻿" + [header, ...body].join("\n"), "text/csv");
  return rows.length;
}

export async function importJson(file: File): Promise<{ added: number; skipped: number }> {
  const parsed = JSON.parse(await file.text()) as BackupFile;
  if (parsed.app !== "mageum") throw new Error("이 앱의 백업 파일이 아닙니다.");

  // 같은 날 같은 가게에서 같은 금액을 두 번 쓰는 일은 실제로 있다 (하루에 두 번
  // 들른 경우). 그래서 "이미 있는 서명이면 버린다"가 아니라 **개수를 맞춘다**.
  // 같은 파일을 두 번 복원해도 개수가 이미 같으므로 아무것도 추가되지 않는다.
  const have = new Map<string, number>();
  for (const t of await db.transactions.toArray()) {
    const s = signature(t);
    have.set(s, (have.get(s) ?? 0) + 1);
  }

  const want = new Map<string, Transaction[]>();
  for (const t of parsed.transactions ?? []) {
    const { id: _drop, ...rest } = t;
    void _drop;
    const s = signature(rest as Transaction);
    if (!want.has(s)) want.set(s, []);
    want.get(s)!.push(rest as Transaction);
  }

  let added = 0;
  let skipped = 0;
  const toAdd: Transaction[] = [];
  for (const [sig, rows] of want) {
    const already = have.get(sig) ?? 0;
    const missing = Math.max(0, rows.length - already);
    toAdd.push(...rows.slice(0, missing));
    added += missing;
    skipped += rows.length - missing;
  }
  if (toAdd.length) await db.transactions.bulkAdd(toAdd);

  // 복원한 기록으로 상호명 규칙을 세운다. 이게 있어야 "자주 가는 곳" 퀵 입력과
  // 상호명 자동 분류가 첫날부터 동작한다.
  await rebuildMerchants();

  // 조정은 같은 연월·금액이 없을 때만
  const adjExisting = await db.adjustments.toArray();
  const adjSeen = new Set(adjExisting.map((a) => `${a.year}-${a.month}-${a.amount}`));
  for (const a of parsed.adjustments ?? []) {
    const key = `${a.year}-${a.month}-${a.amount}`;
    if (adjSeen.has(key)) continue;
    adjSeen.add(key);
    const { id: _drop, ...rest } = a;
    void _drop;
    await db.adjustments.add(rest as Adjustment);
  }

  return { added, skipped };
}

/**
 * 거래 서명. 개수 비교에만 쓴다 — 같은 서명이 여러 건이면 그 개수만큼 실제
 * 거래가 있다는 뜻이지 중복이 아니다.
 */
const signature = (t: Transaction) =>
  `${t.year}|${t.month}|${t.day}|${t.household}|${t.description}|${t.amount}`;

/** 전체 거래를 훑어 상호명 규칙을 다시 만든다. 여러 건을 한꺼번에 넣은 뒤 호출한다. */
export async function rebuildMerchants() {
  const rows = await db.transactions.toArray();
  const tally = new Map<string, MerchantRule>();

  // 최근 기록이 범주·세대를 덮어쓰도록 시간순으로 본다
  rows.sort((a, b) => a.year - b.year || a.month - b.month || (a.day ?? 0) - (b.day ?? 0));

  for (const t of rows) {
    const k = merchantKey(t.description);
    if (!k) continue;
    const prev = tally.get(k);
    if (prev) {
      prev.count++;
      prev.category = t.category;
      prev.household = t.household;
      prev.payment = t.payment;
    } else {
      tally.set(k, {
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

  await db.merchants.clear();
  await db.merchants.bulkAdd([...tally.values()]);
}

export async function lastBackupAt(): Promise<Date | null> {
  const v = await getSetting(LAST_BACKUP);
  return v ? new Date(v) : null;
}

/** 마지막 백업 이후 며칠 지났는지. 백업한 적이 없으면 null. */
export async function daysSinceBackup(): Promise<number | null> {
  const at = await lastBackupAt();
  if (!at) return null;
  return Math.floor((Date.now() - at.getTime()) / 86_400_000);
}
