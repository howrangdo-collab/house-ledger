import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../core/db";
import { daysSinceBackup, exportCsv, exportJson, importJson } from "../core/backup";
import { currentYm } from "./format";

export function SettingsView() {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState<number | null | undefined>(undefined);
  const importRef = useRef<HTMLInputElement>(null);

  const counts = useLiveQuery(async () => {
    return {
      txns: await db.transactions.count(),
      merchants: await db.merchants.count(),
      adjustments: await db.adjustments.count(),
    };
  }, []);

  useEffect(() => {
    void (async () => {
      setDays(await daysSinceBackup());
    })();
  }, []);

  async function doExportJson() {
    setErr(null);
    const n = await exportJson();
    setDays(0);
    setMsg(`${n}건을 백업 파일로 내려받았습니다.`);
  }

  async function doExportCsv() {
    setErr(null);
    const { year } = currentYm();
    const n = await exportCsv(year);
    setMsg(`${year}년 ${n}건을 CSV로 내려받았습니다.`);
  }

  async function doImport(file: File | undefined) {
    if (!file) return;
    setErr(null);
    try {
      const { added, skipped } = await importJson(file);
      setMsg(`${added}건 복원했습니다. 중복 ${skipped}건은 건너뛰었습니다.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "복원에 실패했습니다.");
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  }

  return (
    <div className="page">
      <div className="card">
        <h2>백업</h2>
        <div className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
          기록은 이 폰 안에만 저장됩니다. 서버에 올라가지 않으므로, 폰을 바꾸거나
          사파리가 저장공간을 정리하면 되돌릴 방법이 없습니다. 주기적으로 내려받아
          두세요.
          {days === null && " 아직 한 번도 백업하지 않았습니다."}
          {typeof days === "number" && ` 마지막 백업: ${days === 0 ? "오늘" : `${days}일 전`}.`}
        </div>
        <button className="btn" onClick={doExportJson}>
          백업 파일 내려받기
        </button>
        <button className="btn ghost" style={{ marginTop: 8 }} onClick={doExportCsv}>
          올해 기록 CSV로 내보내기
        </button>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(e) => doImport(e.target.files?.[0])}
        />
        <button
          className="btn ghost"
          style={{ marginTop: 8 }}
          onClick={() => importRef.current?.click()}
        >
          백업 파일에서 복원
        </button>
        <div className="hint">
          CSV는 PC에서 <code>tools/import_to_excel.py</code> 로 기존 엑셀 양식에 넣을 수
          있습니다.
        </div>
      </div>

      <div className="card">
        <h2>저장된 데이터</h2>
        <div className="rows">
          <div className="row">
            <span className="k">거래</span>
            <span className="v">{counts?.txns ?? "…"}건</span>
          </div>
          <div className="row">
            <span className="k">학습된 가게</span>
            <span className="v">{counts?.merchants ?? "…"}곳</span>
          </div>
          <div className="row">
            <span className="k">수동 보정</span>
            <span className="v">{counts?.adjustments ?? "…"}건</span>
          </div>
        </div>
      </div>

      {msg && <div className="banner">{msg}</div>}
      {err && <div className="err">{err}</div>}
    </div>
  );
}
