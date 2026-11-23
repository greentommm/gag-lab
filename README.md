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
| 画像生成 | Pollinations.ai | 不要 |

無料枠には回数制限があり、Gemini の無料枠では入力内容が Google の品質改善に使われる場合があります。

### 切り替え

| 変数 | 値 |
|---|---|
| `GAG_PROVIDER` | `gemini` / `anthropic`（Claude Opus 5.5・有料） / `mock`（AIなし）。未指定ならキーがある方、無ければ `mock` |
| `IMAGE_PROVIDER` | `pollinations`（既定） / `openai`（有料・`OPENAI_API_KEY` が必要） |
| `GEMINI_MODEL` | 既定 `gemini-3.8-flash` |

APIキーはサーバー側（`app/api/*`）でのみ使用し、クライアントには出しません。

## 構成

- `lib/gag.ts` — プロンプト、出力スキーマ（gag_name / wordplay / reference / action / expression / punchline / image_prompt）、検証、プロバイダ切り替え、Claude呼び出し
- `lib/providers/gemini.ts` / `mock.ts` — Gemini とモック
- `app/api/gags` — ギャグ生成。`avoid` に過去のギャグ名を渡すと別の連想経路を優先
- `app/api/image` — 1ギャグにつき1枚の画像を生成（3枚並行）。Pollinations または OpenAI
- `app/page.tsx` — 単一ページUI（昔の個人ホームページ風）
