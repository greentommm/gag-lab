import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { buildUserMessage, GagError, MSG, ResultSchema, SYSTEM, validateResult, type GagResult } from "../gag";

let client: GoogleGenAI | null = null;
const jsonSchema = z.toJSONSchema(ResultSchema);

// 混雑(503)や無料枠の上限(429)のとき、順に別のモデルで試す
// （gemini-2.5-flash は新規ユーザーには提供終了のため使わない）
const FALLBACK_MODELS = ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
// Vercel の上限（60秒）に収まるよう、全体の待ち時間を決めておく
const TOTAL_BUDGET_MS = 52_000;
// これより残り時間が少ないなら、新しいモデルは始めない
const MIN_TRY_MS = 8_000;
// 返事が遅いモデルがあれば、この時間がたった時点で別のモデルも並行して試す
// （Gemini は普段でも15〜30秒かかるため、早すぎると無料枠を二重に使う）
const BACKUP_AFTER_MS = 20_000;
const MAX_PARALLEL = 2;

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
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let dailyLimited = 0;
  let busy = 0;

  // 上限に達しているモデルは最初から外す
  const queue: string[] = [];
  for (const model of [first, ...FALLBACK_MODELS.filter((m) => m !== first)]) {
    const skip = exhaustedUntil.get(model);
    if (skip && skip.until > Date.now()) {
      if (skip.daily) dailyLimited++;
      else busy++;
    } else {
      queue.push(model);
    }
  }

  const stopAll = new AbortController();

  return new Promise<GagResult>((resolve, reject) => {
    let inFlight = 0;
    let settled = false;
    let backupTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (done: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(backupTimer);
      stopAll.abort(); // 残りのリクエストは止める
      done();
    };

    const giveUp = () =>
      finish(() => {
        if (dailyLimited > 0 && busy === 0) reject(new GagError(MSG_DAILY_LIMIT, 429));
        else if (dailyLimited > 0) reject(new GagError(MSG_BUSY_AND_LIMIT, 503));
        else reject(new GagError(MSG_BUSY, 503));
      });

    const launch = () => {
      if (settled) return;
      const remaining = deadline - Date.now();
      const model = remaining >= MIN_TRY_MS ? queue.shift() : undefined;
      if (!model) {
        if (inFlight === 0) giveUp();
        return;
      }

      inFlight++;
      const signal = AbortSignal.any([stopAll.signal, AbortSignal.timeout(remaining)]);
      generateWithModel(model, word, avoid, signal).then(
        (result) => finish(() => resolve(result)),
        (err) => {
          inFlight--;
          if (settled) return;
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
            finish(() => reject(err));
            return;
          }
          console.warn(`[gemini] ${model} unavailable, trying next model`);
          launch(); // すぐ失敗したモデルの代わりを、待たずに始める
        },
      );

      // 返事が遅ければ、予備のモデルも並行して始める
      clearTimeout(backupTimer);
      backupTimer = setTimeout(() => {
        if (!settled && inFlight < MAX_PARALLEL) {
          console.warn(`[gemini] ${model} is slow, starting a backup model`);
          launch();
        }
      }, BACKUP_AFTER_MS);
    };

    launch();
  });
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
  signal: AbortSignal,
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
        abortSignal: signal,
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
