import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./core/db";
import { daysSinceBackup, exportJson } from "./core/backup";
import { SettlementView } from "./ui/SettlementView";
import { LedgerView } from "./ui/LedgerView";
import { SettingsView } from "./ui/SettingsView";
import { AddSheet } from "./ui/AddSheet";
import { currentYm, monthLabel, shiftMonth } from "./ui/format";

type Tab = "settle" | "ledger" | "settings";

/** 이 일수를 넘도록 백업하지 않으면 배너로 알린다. */
const BACKUP_NAG_DAYS = 14;

export default function App() {
  const [tab, setTab] = useState<Tab>("settle");
  const [{ year, month }, setYm] = useState(currentYm);
  const [adding, setAdding] = useState(false);
  const [nag, setNag] = useState(false);

  /**
   * 기록이 하나도 없으면 복원 안내를 띄운다 (첫 실행 또는 새 기기).
   * 설정에서 복원하면 이 값이 바로 따라 바뀌도록 라이브 쿼리로 본다.
   */
  const count = useLiveQuery(() => db.transactions.count(), []);
  const ready = count !== undefined;
  const fresh = count === 0;

  useEffect(() => {
    void (async () => {
      const d = await daysSinceBackup();
      setNag(d === null || d >= BACKUP_NAG_DAYS);
    })();
  }, []);

  if (!ready) {
    return (
      <div className="app">
        <div className="empty">
          <span className="spinner" /> 불러오는 중…
        </div>
      </div>
    );
  }

  const showMonthNav = tab !== "settings";

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          {tab === "settle" ? "정산" : tab === "ledger" ? "기록" : "설정"}
        </h1>
        {showMonthNav && (
          <div className="monthnav">
            <button onClick={() => setYm(shiftMonth(year, month, -1))} aria-label="이전 달">
              ‹
            </button>
            <span className="label">{monthLabel(year, month)}</span>
            <button onClick={() => setYm(shiftMonth(year, month, 1))} aria-label="다음 달">
              ›
            </button>
          </div>
        )}
      </header>

      {fresh && tab !== "settings" && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <div className="banner">
            <span>기록이 없습니다. 지난 가계부 파일이 있으면 불러오세요.</span>
            <button onClick={() => setTab("settings")}>설정으로</button>
          </div>
        </div>
      )}

      {!fresh && nag && tab !== "settings" && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <div className="banner">
            <span>백업한 지 오래됐습니다. 기록은 이 폰 안에만 있습니다.</span>
            <button
              onClick={async () => {
                await exportJson();
                setNag(false);
              }}
            >
              지금 백업
            </button>
          </div>
        </div>
      )}

      {tab === "settle" && <SettlementView year={year} month={month} />}
      {tab === "ledger" && <LedgerView year={year} month={month} />}
      {tab === "settings" && <SettingsView />}

      <nav className="tabbar">
        <button className={tab === "settle" ? "on" : ""} onClick={() => setTab("settle")}>
          <span className="glyph">⚖</span>
          정산
        </button>
        <button className={tab === "ledger" ? "on" : ""} onClick={() => setTab("ledger")}>
          <span className="glyph">☰</span>
          기록
        </button>
        <button className="fab" onClick={() => setAdding(true)} aria-label="항목 추가">
          <span className="glyph">+</span>
        </button>
        <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>
          <span className="glyph">⚙</span>
          설정
        </button>
      </nav>

      {adding && <AddSheet onClose={() => setAdding(false)} />}
    </div>
  );
}
