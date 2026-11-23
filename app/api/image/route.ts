import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 300;

const STYLE =
  "Flat 2D cartoon illustration with simple bold outlines and flat colors, NOT a photograph, not photorealistic. " +
  "Surreal, slightly absurd comedic mood. Single clear scene, plain simple background, " +
  "the character's pose and body movement drawn accurately and readable at a glance. " +
  "Absolutely no text, no letters, no captions, no logos, no speech bubbles.";

class ImageError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

export async function POST(req: Request) {
  let prompt = "";
  try {
    const body = (await req.json()) as { prompt?: unknown };
    prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 1500) : "";
  } catch {
    /* fallthrough */
  }
  if (!prompt) return Response.json({ error: "プロンプトがありません。" }, { status: 400 });

  const fullPrompt = `Cartoon illustration: ${prompt}\n\n${STYLE}`;
  const provider = (process.env.IMAGE_PROVIDER || "pollinations").toLowerCase();

  try {
    const image =
      provider === "openai" ? await openaiImage(fullPrompt) : await pollinationsImage(fullPrompt, req.signal);
    return Response.json({ image });
  } catch (err) {
    if (err instanceof ImageError) return Response.json({ error: err.message }, { status: err.status });
    console.error(err);
    return Response.json({ error: "画像の生成に失敗しました。" }, { status: 500 });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// キーなしの無料枠は「1つのIPにつき45秒に1枚」で、重なったリクエストは失敗扱いになる。
// そのため1枚ずつ直列に処理し、前のリクエストが終わってから45秒以上あける。
// （開発時のホットリロードでも状態を共有するため globalThis に置く）
const POLLINATIONS_GAP_MS = 46_000;
type PollQueue = { tail: Promise<void>; lastFinished: number };
const g = globalThis as unknown as { __pollinationsQueue?: PollQueue };
const queue = (g.__pollinationsQueue ??= { tail: Promise.resolve(), lastFinished: 0 });

async function inPollinationsQueue<T>(fn: () => Promise<T>): Promise<T> {
  const prev = queue.tail;
  let release!: () => void;
  queue.tail = new Promise<void>((r) => (release = r));
  try {
    await prev;
    return await fn();
  } finally {
    release();
  }
}

/** Pollinations.ai：無料・キー不要。 */
async function pollinationsImage(prompt: string, signal: AbortSignal): Promise<string> {
  const seed = Math.floor(Math.random() * 1_000_000);
  // 改行を含むとURLパスとして404になる
  const clean = prompt.replace(/\s+/g, " ").trim();
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(clean)}` +
    `?width=768&height=768&nologo=true&private=true&seed=${seed}`;
  const cancelled = new ImageError("キャンセルされました。", 499);

  return inPollinationsQueue(async () => {
    let extraWaitMs = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = Math.max(queue.lastFinished + POLLINATIONS_GAP_MS - Date.now(), extraWaitMs);
      if (wait > 0) await sleep(wait);
      // 再生成などでブラウザ側が待つのをやめていたら、枠を使わずに抜ける
      if (signal.aborted) throw cancelled;

      let res: Response;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      } catch (err) {
        queue.lastFinished = Date.now();
        console.error(`[pollinations] attempt ${attempt + 1}:`, err);
        continue;
      }
      const type = res.headers.get("content-type") || "";
      if (res.ok && type.startsWith("image/")) {
        const buf = Buffer.from(await res.arrayBuffer());
        queue.lastFinished = Date.now();
        return `data:${type.split(";")[0]};base64,${buf.toString("base64")}`;
      }
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      queue.lastFinished = Date.now();
      console.error(`[pollinations] attempt ${attempt + 1}: HTTP ${res.status} ${detail}`);
      const retryAfter = /Retry after (\d+)s/i.exec(detail);
      extraWaitMs = retryAfter ? (Number(retryAfter[1]) + 2) * 1000 : 0;
      if (res.status !== 402 && res.status !== 429 && res.status < 500) break;
    }
    throw new ImageError("画像の生成に失敗しました（無料サービスが混雑している可能性があります）。", 502);
  });
}

let openai: OpenAI | null = null;

async function openaiImage(prompt: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) throw new ImageError("サーバーに OPENAI_API_KEY が設定されていません。", 503);
  openai ??= new OpenAI();
  const res = await openai.images.generate({
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    prompt,
    size: "1024x1024",
    quality: "medium",
    n: 1,
  });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("no image data");
  return `data:image/png;base64,${b64}`;
}
