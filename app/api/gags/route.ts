import { currentProvider, GagError, generateGags, MSG } from "@/lib/gag";
import { currentImageProvider } from "@/lib/image-style";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
// Vercel の無料プランで使える上限
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "リクエストが不正です。" }, { status: 400 });
  }
  const { word, avoid } = (body ?? {}) as { word?: unknown; avoid?: unknown };
  const text = typeof word === "string" ? word.trim() : "";
  if (!text) return Response.json({ error: "言葉を入力してください。" }, { status: 400 });
  if (text.length > 50) return Response.json({ error: "50文字以内で入力してください。" }, { status: 400 });
  const avoidList = Array.isArray(avoid)
    ? avoid.filter((a): a is string => typeof a === "string").slice(0, 30)
    : [];

  const waitMinutes = checkRateLimit(clientIp(req));
  if (waitMinutes !== null) {
    return Response.json(
      { error: `短い時間に生成しすぎです。${waitMinutes}分ほど待ってからお試しください。` },
      { status: 429 },
    );
  }

  try {
    const result = await generateGags(text, avoidList);
    return Response.json({ ...result, provider: currentProvider(), imageProvider: currentImageProvider() });
  } catch (err) {
    if (err instanceof GagError) return Response.json({ error: err.message }, { status: err.status });
    console.error(err);
    return Response.json({ error: MSG.failed }, { status: 500 });
  }
}
