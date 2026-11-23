// ブラウザから直接 Pollinations に画像を頼む。
// 無料枠は「1つのIPにつき45秒に1枚」なので、訪問者ごとの制限になるよう
// サーバーを通さず、このブラウザ内で1枚ずつ順番に処理する。
//
// fetch() で取りに行くとボット対策（Turnstile）で 403 になるため、
// 普通の <img> と同じ読み込み方（new Image()）を使う。

import { buildImagePrompt } from "./image-style";

const GAP_MS = 46_000;
const MAX_ATTEMPTS = 3;
const LOAD_TIMEOUT_MS = 90_000;

let tail: Promise<unknown> = Promise.resolve();
let lastFinished = 0;

const abortError = () => new DOMException("aborted", "AbortError");

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(abortError());
    });
  });

/** 画像を作って、<img src> に使える URL を返す（読み込み済みなのですぐ表示される）。 */
export function requestPollinationsImage(prompt: string, signal: AbortSignal): Promise<string> {
  const run = () => loadWithRetry(prompt, signal);
  const result = tail.then(run, run);
  tail = result.catch(() => undefined);
  return result;
}

async function loadWithRetry(prompt: string, signal: AbortSignal): Promise<string> {
  const base =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(buildImagePrompt(prompt))}` +
    `?width=768&height=768&nologo=true&private=true`;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // 取り消された画像は、無料枠を使わずにすぐ抜ける
    if (signal.aborted) throw abortError();
    await sleep(lastFinished + GAP_MS - Date.now(), signal);

    const url = `${base}&seed=${Math.floor(Math.random() * 1_000_000)}`;
    const ok = await loadImage(url, signal);
    lastFinished = Date.now();
    if (ok) return url;
  }
  throw new Error("画像の生成に失敗しました（無料サービスが混雑している可能性があります）。");
}

function loadImage(url: string, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const done = (ok: boolean) => {
      clearTimeout(timer);
      img.onload = img.onerror = null;
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), LOAD_TIMEOUT_MS);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      img.src = "";
      reject(abortError());
    });
    img.onload = () => done(img.naturalWidth > 0);
    img.onerror = () => done(false);
    img.src = url;
  });
}
