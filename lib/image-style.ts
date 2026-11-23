// 画像プロンプトの共通部分（サーバーとブラウザの両方で使う）

export const IMAGE_STYLE =
  "Flat 2D cartoon illustration with simple bold outlines and flat colors, NOT a photograph, not photorealistic. " +
  "Surreal, slightly absurd comedic mood. Single clear scene, plain simple background, " +
  "the character's pose and body movement drawn accurately and readable at a glance. " +
  "Absolutely no text, no letters, no captions, no logos, no speech bubbles.";

export function buildImagePrompt(prompt: string) {
  // 改行を含むとPollinationsのURLパスとして404になるので空白にまとめる
  return `Cartoon illustration: ${prompt.slice(0, 1500)} ${IMAGE_STYLE}`.replace(/\s+/g, " ").trim();
}

export type ImageProvider = "pollinations" | "openai";

export function currentImageProvider(): ImageProvider {
  return (process.env.IMAGE_PROVIDER || "").toLowerCase() === "openai" ? "openai" : "pollinations";
}
