/**
 * 영수증 사진 → 거래 항목 추출 (Claude vision).
 *
 * 브라우저에서 Anthropic API를 직접 호출한다. 중계 서버가 없으므로 호스팅 비용이 없다.
 * `dangerouslyAllowBrowser`의 "dangerous"는 키가 앱 사용자에게 보인다는 뜻인데,
 * 여기서는 앱 사용자 = 키 소유자 본인이라 해당되지 않는다 (CLAUDE.md 참조).
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { CATEGORIES } from "./categories";

export const ReceiptSchema = z.object({
  merchant: z.string().describe("가게 상호명. 지점명은 빼고 간결하게"),
  date: z
    .string()
    .describe("결제 날짜 YYYY-MM-DD. 영수증에 없으면 빈 문자열"),
  total: z.number().describe("최종 결제 금액(원). 할인 적용 후 실제 결제액"),
  payment: z
    .string()
    .describe("결제수단: 신용카드/체크카드/현금/카카오페이/삼성페이/지역화폐 중 하나. 불명이면 빈 문자열"),
  category: z
    .enum(CATEGORIES)
    .describe("가게 업종으로 판단한 지출 범주"),
  items: z
    .array(z.object({ name: z.string(), amount: z.number() }))
    .describe("품목 목록. 영수증에 품목이 안 보이면 빈 배열"),
  confidence: z
    .enum(["high", "low"])
    .describe("금액과 상호를 확실히 읽었으면 high, 흐릿하거나 추측이 섞였으면 low"),
});

export type ReceiptResult = z.infer<typeof ReceiptSchema>;

const SYSTEM = `당신은 한국 영수증을 읽어 가계부에 옮기는 도구입니다.

규칙:
- 금액은 반드시 최종 결제 금액을 씁니다. 공급가액/부가세/할인 전 금액이 아닙니다.
- 상호명은 영수증 상단의 가게 이름입니다. 사업자명과 다르면 가게 이름을 씁니다.
- 흐릿하거나 잘려서 확실하지 않으면 지어내지 말고 confidence를 low로 표시합니다.
- 금액에서 쉼표와 '원'은 제거하고 숫자만 씁니다.`;

/**
 * 카메라 사진을 API에 보내기 전에 줄인다.
 * 폰 원본은 4000px 이상이라 토큰과 업로드 시간을 크게 낭비한다.
 */
export async function shrinkImage(file: File, maxSide = 1600): Promise<{ base64: string; mime: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 처리할 수 없습니다.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { base64: dataUrl.split(",")[1], mime: "image/jpeg" };
}

export class ApiKeyMissing extends Error {
  constructor() {
    super("API 키가 없습니다. 설정에서 키를 넣어주세요.");
  }
}

export async function scanReceipt(file: File, apiKey: string): Promise<ReceiptResult> {
  if (!apiKey?.trim()) throw new ApiKeyMissing();

  const { base64, mime } = await shrinkImage(file);
  const client = new Anthropic({ apiKey: apiKey.trim(), dangerouslyAllowBrowser: true });

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 4096,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mime as "image/jpeg", data: base64 } },
          { type: "text", text: "이 영수증을 읽어서 가계부 항목으로 정리해주세요." },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(ReceiptSchema) },
  });

  // 안전 분류기가 거절하면 HTTP 200에 stop_reason만 refusal로 온다
  if (response.stop_reason === "refusal") {
    throw new Error("이미지를 처리할 수 없습니다. 다른 사진으로 시도해주세요.");
  }

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("영수증을 읽지 못했습니다. 더 밝은 곳에서 다시 찍어주세요.");
  return parsed;
}

/** 인식된 날짜 문자열을 연/월/일로. 실패하면 오늘 날짜를 쓴다. */
export function splitDate(raw: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((raw ?? "").trim());
  const now = new Date();
  if (!m) return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  return { year: +m[1], month: +m[2], day: +m[3] };
}
