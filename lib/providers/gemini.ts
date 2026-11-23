import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { buildUserMessage, GagError, MSG, ResultSchema, SYSTEM, validateResult, type GagResult } from "../gag";

let client: GoogleGenAI | null = null;
const jsonSchema = z.toJSONSchema(ResultSchema);

// 混雑(503)や無料枠の上限(429)のとき、順に別のモデルで試す
// （gemini-2.5-flash は新規ユーザーには提供終了のため使わない）
const FALLBACK_MODELS = ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
// Vercel の上限（60秒）に収まるよう、1モデルあたりと全体の待ち時間を決めておく
const MODEL_TIMEOUT_MS = 35_000;
const TOTAL_BUDGET_MS = 52_000;
const MIN_TRY_MS = 8_000;

function isTimeout(err: unknown) {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/** 無料枠の上限（429）。daily=true は「1日の上限」で、回復まで長くかかる。 */
class QuotaError extends Error {
  constructor(public daily: boolean, public retryAfterMs: number) {
    super("quota exceeded");
  }
}

// 上限に達したモデルは、回復するまで呼ばずに飛ばす（サーバーのメモリ上の簡易版）
const exhaustedUntil = new Map<string, { until: number; daily: boolean }>();

const MSG_DAILY_LIMIT = "今日の生成回数の上限（無料枠）に達しました。明日またお試しください。";
const MSG_BUSY_AND_LIMIT =
  "AIが混み合っていて、一部は今日の上限（無料枠）にも達しています。しばらくしてからお試しください。";
const MSG_BUSY = "Gemini が混み合っています。しばらくしてからお試しください。";

export async function generateWithGemini(word: string, avoid: string[]): Promise<GagResult> {
  const first = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const models = [first, ...FALLBACK_MODELS.filter((m) => m !== first)];
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let dailyLimited = 0;
  let busy = 0;

  for (const model of models) {
    const skip = exhaustedUntil.get(model);
    if (skip && skip.until > Date.now()) {
      if (skip.daily) dailyLimited++;
      else busy++;
      continue;
    }
    const remaining = deadline - Date.now();
    if (remaining < MIN_TRY_MS) {
      busy++;
      continue;
    }
    try {
      return await generateWithModel(model, word, avoid, Math.min(MODEL_TIMEOUT_MS, remaining));
    } catch (err) {
      if (err instanceof QuotaError) {
        exhaustedUntil.set(model, { until: Date.now() + err.retryAfterMs, daily: err.daily });
        if (err.daily) dailyLimited++;
        else busy++;
      } else if (
        (err instanceof GagError && err.status === 404) ||
        (err instanceof ApiError && err.status >= 500) ||
        isTimeout(err)
      ) {
        busy++;
      } else {
        throw err;
      }
      console.warn(`[gemini] ${model} unavailable, trying next model`);
    }
  }

  if (dailyLimited > 0 && busy === 0) throw new GagError(MSG_DAILY_LIMIT, 429);
  if (dailyLimited > 0) throw new GagError(MSG_BUSY_AND_LIMIT, 503);
  throw new GagError(MSG_BUSY, 503);
}

function quotaFromError(err: ApiError): QuotaError {
  const daily = /per ?day/i.test(err.message);
  const delay = /"retryDelay":"(\d+)s"/.exec(err.message);
  const fallback = daily ? 60 * 60 * 1000 : 60 * 1000;
  return new QuotaError(daily, delay ? Number(delay[1]) * 1000 : fallback);
}

async function generateWithModel(
  model: string,
  word: string,
  avoid: string[],
  timeoutMs: number,
): Promise<GagResult> {
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  let text: string | undefined;
  try {
    const res = await client.models.generateContent({
      model,
      contents: buildUserMessage(word, avoid),
      config: {
        systemInstruction: SYSTEM,
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchema,
        temperature: 1.0,
        // 混雑時に応答が返らないことがあるので、待ちすぎずに次のモデルへ
        abortSignal: AbortSignal.timeout(timeoutMs),
      },
    });
    text = res.text;
  } catch (err) {
    if (err instanceof ApiError) {
      console.error(`[gemini] ${err.status}: ${err.message}`);
      if (err.status === 429) throw quotaFromError(err);
      if (err.status === 401 || err.status === 403) throw new GagError(MSG.auth);
      if (err.status === 404) throw new GagError(`モデル「${model}」が見つかりません。GEMINI_MODEL を確認してください。`, 404);
      if (err.status === 400 && /api key/i.test(err.message)) throw new GagError(MSG.auth);
    }
    throw err;
  }

  if (!text) throw new GagError(MSG.refusal, 422);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new GagError(MSG.parse, 502);
  }
  return validateResult(data);
}
