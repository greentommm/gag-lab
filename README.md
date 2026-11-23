# GAG LAB

AI One-liner Generator（v1.1 MVP）

好きな言葉を入れると、AIが一発ギャグを3つ考えて、それぞれのイメージ画像を作ります。

## セットアップ

```
npm install
cp .env.example .env.local   # GEMINI_API_KEY を記入
npm run dev
```

http://localhost:3000 を開く。

### 無料構成（既定）

| 用途 | サービス | キー |
|---|---|---|
| ギャグ生成 | Google Gemini API 無料枠 | `GEMINI_API_KEY`（Google AI Studio で無料発行） |
| 画像生成 | Pollinations.ai（訪問者のブラウザから直接読み込み） | 不要 |

無料枠には回数制限があります。

- Gemini：混雑時は `gemini-3.8-flash` → `3.7` → `3.6` → `3.5` → `3.5-flash-lite` の順に自動で切り替えます。無料枠では入力内容が Google の品質改善に使われる場合があります。
- Pollinations：1つのIPにつき45秒に1枚。訪問者ごとの制限になるよう、画像はブラウザから直接読み込み、1枚ずつ順番に作ります（3枚で2〜3分）。
- 1人（IP）あたりのギャグ生成は、既定で10分に5回まで（`RATE_LIMIT_PER_10MIN`）。

### 切り替え

| 変数 | 値 |
|---|---|
| `GAG_PROVIDER` | `gemini` / `anthropic`（Claude Opus 5.5・有料） / `mock`（AIなし）。未指定ならキーがある方、無ければ `mock` |
| `IMAGE_PROVIDER` | `pollinations`（既定） / `openai`（有料・`OPENAI_API_KEY` が必要） |
| `GEMINI_MODEL` | 既定 `gemini-3.8-flash` |
| `RATE_LIMIT_PER_10MIN` | 1人あたり10分間の生成回数。既定 `5` |

APIキーはサーバー側（`app/api/*`）でのみ使用し、クライアントには出しません。

## 構成

- `lib/gag.ts` — プロンプト、出力スキーマ（gag_name / wordplay / reference / action / expression / punchline / image_prompt）、検証、プロバイダ切り替え、Claude呼び出し
- `lib/providers/gemini.ts` / `mock.ts` — Gemini とモック
- `app/api/gags` — ギャグ生成。`avoid` に過去のギャグ名を渡すと別の連想経路を優先
- `lib/pollinations-client.ts` — ブラウザから Pollinations の画像を1枚ずつ読み込む
- `lib/rate-limit.ts` — 1人あたりの生成回数の制限（サーバーのメモリ上の簡易版）
- `app/api/image` — `IMAGE_PROVIDER=openai` のときだけ使う画像生成
- `app/page.tsx` — 単一ページUI（昔の個人ホームページ風）

## Vercel で公開する

1. [Vercel](https://vercel.com) に GitHub アカウントでサインインし、「Add New → Project」でこのリポジトリを選ぶ
2. 「Environment Variables」に `GEMINI_API_KEY` を追加する（必要なら `GAG_PROVIDER=gemini` も）
3. 「Deploy」を押す

APIの処理時間は60秒以内（Vercel の無料プランの上限）に収まるようにしてあります。
