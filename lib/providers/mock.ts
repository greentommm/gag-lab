import type { GagResult } from "../gag";

/** APIキーなしで画面の動作を確認するための固定データ。 */
export async function generateMock(word: string, avoid: string[]): Promise<GagResult> {
  await new Promise((r) => setTimeout(r, 600));
  const round = Math.floor(avoid.length / 3) + 1;
  return {
    reading: "（モック）",
    gags: [
      {
        gag_name: `寝そべり${word}`,
        wordplay: `寝そべる＋${word}（モック${round}回目）`,
        reference: `入力された「${word}」`,
        association: "音韻的連想",
        action: "床にうつ伏せに寝そべり、両手を左右に大きく広げる。",
        expression: "真顔のまま、ゆっくり顔だけ上げる。",
        punchline: `「${word}…」と小声で言って静止する。`,
        image_prompt:
          "A man lying face down on a plain floor with both arms stretched out wide to the sides, chin slightly raised, deadpan expression, full body view from a low side angle",
      },
      {
        gag_name: `${word}体操`,
        wordplay: `${word}＋ラジオ体操`,
        reference: `入力された「${word}」`,
        association: "身体的連想",
        action: "ラジオ体操の腕を回す運動を、異常に真剣な顔でやる。",
        expression: "目を見開き、汗をかいているように見せる。",
        punchline: "最後に片足で立ち、両手を天に突き上げる。",
        image_prompt:
          "A serious-looking man doing a stretching exercise, standing on one leg with both arms raised straight up to the sky, eyes wide open, plain background, full body",
      },
      {
        gag_name: `${word}してる場合か`,
        wordplay: `${word}＋「〜してる場合か」`,
        reference: `入力された「${word}」`,
        association: "意味的連想",
        action: "その場で足踏みしながら、急に止まって客席を指さす。",
        expression: "怒っているような、困っているような顔。",
        punchline: "指さしたまま3秒静止。",
        image_prompt:
          "A man frozen mid-step, pointing directly at the viewer with a confused and slightly angry face, one foot lifted, plain background, full body",
      },
    ],
  };
}
