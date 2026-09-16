import type { ReactNode } from "react";
import { useEffect } from "react";

/** 아래에서 올라오는 모달 시트. */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // 시트가 열린 동안 뒤 화면이 스크롤되지 않게 한다
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet">
        <div className="grabber" />
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
