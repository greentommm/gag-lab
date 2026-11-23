import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

export const GagSchema = z.object({
  gag_name: z.string().describe("ギャグの名前（日本語。短く、声に出して言いやすいもの）"),
  wordplay: z.string().describe("言葉遊びの仕組み（例：寝そべる＋ベリンガム）"),
  reference: z.string().describe("元ネタ（入力語が何を指すか。人物・作品・物など）"),
  association: z
    .string()
    .describe("使った連想経路（音韻／意味／視覚／身体／文化 のいずれか、または組み合わせ）"),
  action: z.string().describe("実際に行う動作"),
  expression: z.string().describe("表情・演技"),
  punchline: z.string().describe("オチ・演出"),
  image_prompt: z
    .string()
    .describe("画像生成用プロンプト（英語。ポーズと構図を具体的に。文字なし）"),
});

const ResultSchema = z.object({
  reading: z.string().describe("入力語の読み方（カタカナ）"),
  gags: z.array(GagSchema).describe("面白い順に並べた3つのギャグ"),
});

export type Gag = z.infer<typeof GagSchema>;
export type GagResult = z.infer<typeof ResultSchema>;

const SYSTEM = `あなたは日本のお笑い芸人の一発ギャグ作家です。
ユーザーが入力した言葉から、実際に身体で再現できる「一発ギャグ」を考えます。

# 作り方
1. 入力語を分析する：読み方（カタカナ）、発音、音韻構造（モーラ・母音・子音）、意味、関連する人物・作品・文化的背景。
2. 連想経路を複数探索する：音韻的・意味的・視覚的・身体的・文化的連想。
   特に音韻的連想を重視する。単に意味の近い言葉ではなく、音が重なる意外な日本語の動詞・名詞・擬音と合体させる。
   例：Bellingham → ベリンガム → 「寝そべる」の「べる」と「ベリ」が重なる → 「寝そベリンガム」
3. 候補をたくさん頭の中で作り、次の観点で評価して上位3つだけを出す：
   元の言葉との関連性／意外性／独創性／実演のしやすさ／理解のしやすさ。
4. 3つはそれぞれ異なる連想経路・異なる動作にする。

# ギャグ名のルール
- 入力語の音が聞き取れる形で残っていること。
- 声に出して叫べる長さ（目安：12文字以内）。
- 単なるダジャレで終わらず、動作と名前が一致していること。

# 実演
- action：誰でも一人で、道具なし（または身近な物）で再現できる具体的な動作。体の向き・手足の位置まで書く。
- expression：表情や声のトーン。
- punchline：決めポーズやオチ。元ネタの有名な動き・ポーズの再現があれば使う。

# image_prompt（英語）
- ギャグの動作が一目で分かる、シュールで少し可笑しいイラストを描写する。
- 人物のポーズ・手足の位置・体の向き・表情を正確に書く。
- 構図（全身／俯瞰／横からなど）はギャグに合わせて選ぶ。
- 実在の人物名は書かず、「a soccer player in a white kit」のように一般化した人物で表現する。
- 画像内に文字・ロゴ・吹き出しを入れない（"no text, no letters, no logos" を必ず含める）。

すべての説明文は日本語、image_prompt だけ英語で書くこと。`;

export { SYSTEM, ResultSchema };

/** 表示用・サーバー用のエラー。message はそのままユーザーに見せる。 */
export class GagError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

export const MSG = {
  parse: "AIの応答を読み取れませんでした。もう一度お試しください。",
  refusal: "この言葉ではギャグを作れませんでした。別の言葉でお試しください。",
  truncated: "生成が途中で止まりました。もう一度お試しください。",
  rateLimit: "混み合っています（無料枠の回数制限の可能性があります）。しばらくしてからお試しください。",
  auth: "サーバーのAPIキー設定に問題があります。",
  failed: "ギャグの生成に失敗しました。",
};

export function buildUserMessage(word: string, avoid: string[]) {
  const avoidText =
    avoid.length > 0
      ? `\n\n前回すでに以下のギャグを出しました。これらとは異なる連想経路・異なる音の重ね方・異なる動作を優先してください：\n${avoid
          .map((n) => `- ${n}`)
          .join("\n")}`
      : "";
  return `入力語：${word}${avoidText}\n\nギャグを3つ作ってください。`;
}

/** 不正なJSONや欠けた項目を弾き、最大3件に揃える。 */
export function validateResult(data: unknown): GagResult {
  const check = ResultSchema.safeParse(data);
  if (!check.success || check.data.gags.length === 0) throw new GagError(MSG.parse, 502);
  return { ...check.data, gags: check.data.gags.slice(0, 3) };
}

export type GagProvider = "gemini" | "anthropic" | "mock";

/** GAG_PROVIDER が無ければ、キーがある方を使う。どちらも無ければモック。 */
export function currentProvider(): GagProvider {
  const p = process.env.GAG_PROVIDER?.trim().toLowerCase();
  if (p === "gemini" || p === "anthropic" || p === "mock") return p;
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "mock";
}

export async function generateGags(word: string, avoid: string[]): Promise<GagResult> {
  const provider = currentProvider();
  if (provider === "gemini") {
    if (!process.env.GEMINI_API_KEY) throw new GagError("サーバーに GEMINI_API_KEY が設定されていません。");
    const { generateWithGemini } = await import("./providers/gemini");
    return generateWithGemini(word, avoid);
  }
  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) throw new GagError("サーバーに ANTHROPIC_API_KEY が設定されていません。");
    return generateWithClaude(word, avoid);
  }
  const { generateMock } = await import("./providers/mock");
  return generateMock(word, avoid);
}

let claude: Anthropic | null = null;

async function generateWithClaude(word: string, avoid: string[]): Promise<GagResult> {
  claude ??= new Anthropic();
  let response;
  try {
    response = await claude.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "medium", format: zodOutputFormat(ResultSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: buildUserMessage(word, avoid) }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new GagError(MSG.auth);
    if (err instanceof Anthropic.RateLimitError) throw new GagError(MSG.rateLimit, 429);
    throw err;
  }
  if (response.stop_reason === "refusal") throw new GagError(MSG.refusal, 422);
  if (response.stop_reason === "max_tokens") throw new GagError(MSG.truncated, 502);
  return validateResult(response.parsed_output);
}
