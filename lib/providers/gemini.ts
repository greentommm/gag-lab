import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { buildUserMessage, GagError, MSG, ResultSchema, SYSTEM, validateResult, type GagResult } from "../gag";

let client: GoogleGenAI | null = null;
const jsonSchema = z.toJSONSchema(ResultSchema);

// 混雑(503)や無料枠の上限(429)のとき、順に別のモデルで試す
const FALLBACK_MODELS = ["gemini-3.7-flash", "gemini-3.5-flash", "gemini-2.5-flash"];
const MODEL_TIMEOUT_MS = 40_000;

function isTimeout(err: unknown) {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

export async function generateWithGemini(word: string, avoid: string[]): Promise<GagResult> {
  const first = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const models = [first, ...FALLBACK_MODELS.filter((m) => m !== first)];
  let lastErr: unknown;
  for (const model of models) {
    try {
      return await generateWithModel(model, word, avoid);
    } catch (err) {
      lastErr = err;
      const retryable =
        err instanceof GagError
          ? err.status === 429
          : (err instanceof ApiError && err.status >= 500) || isTimeout(err);
      if (!retryable) throw err;
      console.warn(`[gemini] ${model} unavailable, trying next model`);
    }
  }
  if (lastErr instanceof GagError) throw lastErr;
  throw new GagError("Gemini が混み合っています。しばらくしてからお試しください。", 503);
}

async function generateWithModel(model: string, word: string, avoid: string[]): Promise<GagResult> {
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
        abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      },
    });
    text = res.text;
  } catch (err) {
    if (err instanceof ApiError) {
      console.error(`[gemini] ${err.status}: ${err.message}`);
      if (err.status === 429) throw new GagError(MSG.rateLimit, 429);
      if (err.status === 401 || err.status === 403) throw new GagError(MSG.auth);
      if (err.status === 404) throw new GagError(`モデル「${model}」が見つかりません。GEMINI_MODEL を確認してください。`);
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
