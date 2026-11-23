import { currentProvider, GagError, generateGags, MSG } from "@/lib/gag";

export const runtime = "nodejs";
export const maxDuration = 120;

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

  try {
    const result = await generateGags(text, avoidList);
    return Response.json({ ...result, provider: currentProvider() });
  } catch (err) {
    if (err instanceof GagError) return Response.json({ error: err.message }, { status: err.status });
    console.error(err);
    return Response.json({ error: MSG.failed }, { status: 500 });
  }
}
