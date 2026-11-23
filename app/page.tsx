"use client";

import { useRef, useState } from "react";
import type { Gag, GagResult } from "@/lib/gag";

type ImageState = { status: "loading" } | { status: "done"; src: string } | { status: "error"; message: string };

export default function Home() {
  const [input, setInput] = useState("");
  const [word, setWord] = useState("");
  const [result, setResult] = useState<(GagResult & { provider?: string }) | null>(null);
  const [images, setImages] = useState<ImageState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const history = useRef<string[]>([]);
  const requestId = useRef(0);
  const imageAbort = useRef<AbortController | null>(null);

  async function generate(target: string, regenerate: boolean) {
    const text = target.trim();
    if (!text || loading) return;
    if (!regenerate) history.current = [];
    const id = ++requestId.current;
    // 前回の画像待ちは不要になるので取り消す（無料枠の順番を空けるため）
    imageAbort.current?.abort();
    imageAbort.current = new AbortController();
    const signal = imageAbort.current.signal;

    setLoading(true);
    setError("");
    setResult(null);
    setImages([]);
    setWord(text);

    try {
      const res = await fetch("/api/gags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: text, avoid: history.current }),
      });
      const data = await res.json().catch(() => ({ error: "応答が不正です。" }));
      if (id !== requestId.current) return;
      if (!res.ok) throw new Error(data.error || "エラーが発生しました。");

      const gags = (data as GagResult).gags;
      history.current = [...history.current, ...gags.map((g) => g.gag_name)];
      setResult(data as GagResult);
      setImages(gags.map(() => ({ status: "loading" })));
      gags.forEach((g, i) => loadImage(g, i, id, signal));
    } catch (e) {
      if (id === requestId.current) setError(e instanceof Error ? e.message : "エラーが発生しました。");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  async function loadImage(gag: Gag, index: number, id: number, signal: AbortSignal) {
    let next: ImageState;
    try {
      const res = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: gag.image_prompt }),
        signal,
      });
      const data = await res.json().catch(() => ({}));
      next = res.ok && data.image
        ? { status: "done", src: data.image }
        : { status: "error", message: data.error || "画像の生成に失敗しました。" };
    } catch {
      next = { status: "error", message: "画像の生成に失敗しました。" };
    }
    if (id !== requestId.current) return;
    setImages((prev) => prev.map((s, i) => (i === index ? next : s)));
  }

  return (
    <div className="wrap">
      <h1>GAG LAB</h1>
      <div className="small">AI One-liner Generator</div>
      <hr />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          generate(input, false);
        }}
      >
        <p>好きな言葉を入力してください。</p>
        <p>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Bellingham"
            maxLength={50}
          />
        </p>
        <p>
          <button type="submit" disabled={loading || !input.trim()}>
            生成
          </button>
        </p>
      </form>

      <hr />

      {loading && <p>ギャグを考えています...</p>}
      {error && <p className="error">{error}</p>}

      {result && (
        <>
          <p className="small">
            「{word}」（{result.reading}）のギャグ
          </p>
          {result.provider === "mock" && (
            <p className="small error">※ APIキー未設定のため、モックデータを表示しています。</p>
          )}
          {result.gags.map((g, i) => (
            <div className="gag" key={i}>
              <h2>{g.gag_name}</h2>
              <GagImage state={images[i]} alt={g.gag_name} />
              <br />
              <dl className="detail">
                <dt>言葉遊び：</dt>
                <dd>{g.wordplay}</dd>
                <dt>元ネタ：</dt>
                <dd>{g.reference}</dd>
                <dt>実演方法：</dt>
                <dd>
                  {g.action}
                  <br />
                  表情：{g.expression}
                  <br />
                  オチ：{g.punchline}
                </dd>
              </dl>
              {i < result.gags.length - 1 && <hr />}
            </div>
          ))}
          <hr />
          <p>
            <button type="button" onClick={() => generate(word, true)} disabled={loading}>
              もう一度生成
            </button>
          </p>
        </>
      )}

      <p className="small">&copy; GAG LAB</p>
    </div>
  );
}

function GagImage({ state, alt }: { state?: ImageState; alt: string }) {
  if (!state || state.status === "loading") return (
      <div className="noimg">
        画像を生成しています...
        <br />
        <span className="small">（無料枠のため1枚ずつ順番に作ります。3枚そろうまで2〜3分ほどかかります）</span>
      </div>
    );
  if (state.status === "error") return <div className="noimg small">{state.message}</div>;
  return <img src={state.src} alt={alt} />;
}
