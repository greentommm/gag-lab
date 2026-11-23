// 1人（IPアドレス）あたりの生成回数を制限して、Gemini の無料枠を守る。
// サーバーのメモリに記録するだけの簡易版。Vercel ではサーバーが複数に分かれたり
// 再起動したりするので完全ではないが、連打による使いすぎはほぼ防げる。

const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = Number(process.env.RATE_LIMIT_PER_10MIN) || 5;

const hits = new Map<string, number[]>();

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "local";
}

/** 使えるなら null、上限なら何分後に使えるかを返す。 */
export function checkRateLimit(ip: string): number | null {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(ip, recent);
    return Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 60_000));
  }
  recent.push(now);
  hits.set(ip, recent);

  // メモリが増え続けないよう、たまに古い記録を掃除する
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(key);
    }
  }
  return null;
}
