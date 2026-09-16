import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // 상대 경로로 빌드해야 어느 정적 호스팅의 하위 경로에 올려도 동작한다
  base: "./",
  server: {
    // 같은 와이파이의 아이폰에서 PC 주소로 접속해 테스트하기 위한 것
    host: true,
  },
});
