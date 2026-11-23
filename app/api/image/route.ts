import OpenAI from "openai";
import { buildImagePrompt, currentImageProvider } from "@/lib/image-style";

// IMAGE_PROVIDER=openai のときだけ使う（Pollinations はブラウザから直接呼ぶ）
export const runtime = "nodejs";
export const maxDuration = 60;

let openai: OpenAI | null = null;

export async function POST(req: Request) {
  if (currentImageProvider() !== "openai") {
    return Response.json({ error: "この画像生成はサーバーでは扱っていません。" }, { status: 400 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "サーバーに OPENAI_API_KEY が設定されていません。" }, { status: 503 });
  }
  let prompt = "";
  try {
    const body = (await req.json()) as { prompt?: unknown };
    prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  } catch {
    /* fallthrough */
  }
  if (!prompt) return Response.json({ error: "プロンプトがありません。" }, { status: 400 });

  try {
    openai ??= new OpenAI();
    const res = await openai.images.generate({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
      prompt: buildImagePrompt(prompt),
      size: "1024x1024",
      quality: "medium",
      n: 1,
    });
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new Error("no image data");
    return Response.json({ image: `data:image/png;base64,${b64}` });
  } catch (err) {
    console.error(err);
    return Response.json({ error: "画像の生成に失敗しました。" }, { status: 500 });
  }
}
