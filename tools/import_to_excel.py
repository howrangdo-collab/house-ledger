# -*- coding: utf-8 -*-
"""앱에서 내보낸 CSV/JSON을 기존 엑셀 가계부 양식에 넣는다.

앱으로 완전히 넘어가기 전까지 엑셀 마감을 병행하기 위한 도구다.

반드시 Excel COM으로 쓴다. openpyxl로 저장하면 드롭다운(데이터 유효성 검사)이
삭제된다 — 프로젝트 루트 CLAUDE.md의 "엑셀을 건드릴 때의 규칙" 참조.

사용:
    python tools/import_to_excel.py 가계부_2026년.csv --year 2026 --month 9
    python tools/import_to_excel.py 백업.json --year 2026            # 그 해 전체
    python tools/import_to_excel.py ... --dry-run                    # 쓰지 않고 확인만
"""
import argparse
import csv
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

LEDGER_DIR = Path(r"C:\Users\howra\Desktop\회계마감")

# 세대별 입력 영역 시작 열 (1-based). CLAUDE.md "두 세대와 분담 비율" 참조.
COLS = {"eunji": 2, "jisu": 7}  # 은지네 B~F, 지수네 G~K
ROW_START, ROW_END = 20, 52
CAPACITY = ROW_END - ROW_START + 1  # 세대당 33행


def load_rows(path: Path):
    """CSV 또는 JSON 백업에서 거래 목록을 읽는다."""
    if path.suffix.lower() == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("app") != "mageum":
            sys.exit("이 앱의 백업 파일이 아닙니다.")
        return data["transactions"]

    rows = []
    with path.open(encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            rows.append({
                "year": int(r["연"]),
                "month": int(r["월"]),
                "day": int(r["일"]) if r["일"] else None,
                "household": r["세대"],
                "category": r["범주"],
                "description": r["상세"],
                "payment": r["결제수단"],
                "amount": int(float(r["금액"])),
            })
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", type=Path, help="앱에서 내보낸 CSV 또는 JSON")
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--month", type=int, help="생략하면 그 해 전체 월")
    ap.add_argument("--dry-run", action="store_true", help="파일을 쓰지 않고 결과만 출력")
    args = ap.parse_args()

    target = LEDGER_DIR / f"{args.year}년_가계부.xlsx"
    if not target.exists():
        sys.exit(f"엑셀 파일이 없습니다: {target}")

    rows = [r for r in load_rows(args.source) if r["year"] == args.year]
    if args.month:
        rows = [r for r in rows if r["month"] == args.month]
    if not rows:
        sys.exit("넣을 거래가 없습니다.")

    months = sorted({r["month"] for r in rows})

    # 행 수 한도를 먼저 확인한다. 쓰다가 중간에 멈추면 엑셀이 반만 채워진다.
    over = []
    for m in months:
        for hk in COLS:
            n = len([r for r in rows if r["month"] == m and r["household"] == hk])
            if n > CAPACITY:
                over.append(f"  {m}월 {hk}: {n}건 (엑셀 최대 {CAPACITY}건)")
    if over:
        print("엑셀 양식의 행 수를 넘습니다. 넣을 수 없습니다:")
        print("\n".join(over))
        sys.exit(1)

    print(f"대상: {target.name}")
    for m in months:
        e = len([r for r in rows if r["month"] == m and r["household"] == "eunji"])
        j = len([r for r in rows if r["month"] == m and r["household"] == "jisu"])
        print(f"  {m}월: 은지네 {e}건, 지수네 {j}건")

    if args.dry_run:
        print("\n--dry-run 이므로 파일을 쓰지 않았습니다.")
        return

    backup = target.with_name(
        f"{target.stem}_백업_{datetime.now():%Y%m%d_%H%M%S}{target.suffix}"
    )
    shutil.copy2(target, backup)
    print(f"백업: {backup.name}")

    import win32com.client as win32

    xl = win32.gencache.EnsureDispatch("Excel.Application")
    xl.Visible = False
    xl.DisplayAlerts = False
    wb = xl.Workbooks.Open(str(target.resolve()))
    try:
        # 쓰기 전에 대상 시트가 2세대 정산 구조인지 먼저 다 확인한다.
        # 2024년 1~8월은 원본 템플릿(N2='총 지출')이라 B20:K52의 의미가 다르다.
        # 거기에 쓰면 엉뚱한 칸이 채워지고 수식이 어긋난다. CLAUDE.md 참조.
        wrong = []
        for m in months:
            n2 = str(wb.Worksheets(f"{m}월").Range("N2").Value or "").strip()
            if n2 != "은지네":
                wrong.append(f"  {m}월: N2='{n2}' (2세대 정산 구조가 아님)")
        if wrong:
            print("2세대 정산 구조가 아닌 시트가 있어 중단합니다:")
            print(chr(10).join(wrong))
            print("원본 백업은 그대로 있습니다:", backup.name)
            sys.exit(1)

        for m in months:
            ws = wb.Worksheets(f"{m}월")
            for hk, c0 in COLS.items():
                # 기존 값만 지운다. ClearContents 여야 서식·드롭다운이 남는다
                ws.Range(
                    ws.Cells(ROW_START, c0), ws.Cells(ROW_END, c0 + 4)
                ).ClearContents()

                items = sorted(
                    [r for r in rows if r["month"] == m and r["household"] == hk],
                    key=lambda r: (r["day"] or 0),
                )
                for i, r in enumerate(items):
                    row = ROW_START + i
                    # 일자는 엑셀 원본과 같은 '19일' 형태의 문자열로 넣는다
                    ws.Cells(row, c0).Value = f"{r['day']}일" if r["day"] else ""
                    ws.Cells(row, c0 + 1).Value = r["category"]
                    ws.Cells(row, c0 + 2).Value = r["description"]
                    ws.Cells(row, c0 + 3).Value = r["payment"]
                    ws.Cells(row, c0 + 4).Value = r["amount"]

        xl.CalculateFullRebuild()
        for m in months:
            ws = wb.Worksheets(f"{m}월")
            print(
                f"  {m}월 결과: 은지 {ws.Range('P2').Value:,.0f} / "
                f"지수 {ws.Range('P4').Value:,.0f} / 누적 {ws.Range('Q12').Value:,.0f}"
            )
        wb.Save()
        print("저장 완료.")
    finally:
        wb.Close(SaveChanges=False)
        xl.Quit()


if __name__ == "__main__":
    main()
