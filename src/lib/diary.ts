import { marked, type Tokens } from "marked";

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "avi"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a", "aac"]);

function getUrlExtension(url: string): string {
  const clean = url.split(/[?#]/)[0];
  const match = clean.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderImageTag(href: string, alt: string): string {
  return `<img src="${escapeHtmlAttr(href)}" alt="${escapeHtmlAttr(alt)}" class="diary-media diary-media--image" data-lightbox loading="lazy">`;
}

let diaryRendererRegistered = false;

// marked のデフォルトレンダラーを拡張し、
// - [ファイル名](url) のうち動画/音声拡張子のものを <video>/<audio> に変換
// - 画像には幅指定・ライトボックス起動用のクラス/属性を付与
// - 空行を挟まず連続する画像2枚を .diary-image-pair でまとめる(3枚以上は先頭2枚のみペア化)
// を行う。marked.use() はモジュールをまたいで共有されるグローバル設定のため、二重登録を防ぐ。
function registerDiaryRenderer() {
  if (diaryRendererRegistered) return;
  diaryRendererRegistered = true;

  marked.use({
    renderer: {
      link(token: Tokens.Link) {
        const ext = getUrlExtension(token.href);
        if (VIDEO_EXTENSIONS.has(ext)) {
          return `<video class="diary-media diary-media--video" controls playsinline preload="metadata" src="${escapeHtmlAttr(token.href)}"></video>`;
        }
        if (AUDIO_EXTENSIONS.has(ext)) {
          return `<audio class="diary-media diary-media--audio" controls preload="metadata" src="${escapeHtmlAttr(token.href)}"></audio>`;
        }
        return false; // 通常のリンクは marked のデフォルト実装にフォールバック
      },

      image(token: Tokens.Image) {
        return renderImageTag(token.href, token.text ?? "");
      },

      paragraph(token: Tokens.Paragraph) {
        const children = token.tokens ?? [];
        const parts: string[] = [];
        let i = 0;

        while (i < children.length) {
          const child = children[i];

          if (child.type === "image") {
            // 空行なしで連続する画像の並びを検出する(間の空白テキストは無視する)
            const run: Tokens.Image[] = [child as Tokens.Image];
            let j = i + 1;
            while (j < children.length) {
              const next = children[j];
              if (next.type === "image") {
                run.push(next as Tokens.Image);
                j++;
                continue;
              }
              if (
                next.type === "text" &&
                next.text.trim() === "" &&
                j + 1 < children.length &&
                children[j + 1].type === "image"
              ) {
                j++; // 空白のみのテキストトークンはスキップして連続とみなす
                continue;
              }
              break;
            }

            if (run.length >= 2) {
              parts.push(
                `<div class="diary-image-pair">${renderImageTag(
                  run[0].href,
                  run[0].text ?? ""
                )}${renderImageTag(run[1].href, run[1].text ?? "")}</div>`
              );
              // 3枚目以降はペア化せず通常表示
              for (let k = 2; k < run.length; k++) {
                parts.push(renderImageTag(run[k].href, run[k].text ?? ""));
              }
            } else {
              parts.push(renderImageTag(run[0].href, run[0].text ?? ""));
            }
            i = j;
            continue;
          }

          parts.push(this.parser.parseInline([child]));
          i++;
        }

        return `<p>${parts.join("")}</p>`;
      },
    },
  });
}

// 日記本文のMarkdownをHTMLに変換する(parseDiaryEntries() で分割済みの本文を渡す想定)
export function renderDiaryMarkdown(body: string): string {
  registerDiaryRenderer();
  return marked.parse(body) as string;
}

// "2026-07" → "2026.7"（ゼロ埋めなしのコンパクト表記）
export function formatYearMonthCompact(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  return `${y}.${Number(m)}`;
}

// "2026-07" → "2026年7月"
export function formatYearMonthLong(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  return `${y}年${Number(m)}月`;
}

export interface DiaryGroup {
  heading: string;
  bodies: string[];
  sortKey: number;
}

// 見出しから月日を取り出してソートキーにする(例: "7月15日（予定）" → 715)
// 月日を取り出せない見出しは元の出現順を保つため、十分大きい値に出現順を加算する
function extractDateKey(heading: string, appearanceOrder: number): number {
  const match = heading.match(/(\d+)\s*月\s*(\d+)\s*日/);
  if (!match) {
    return 10000 + appearanceOrder;
  }
  const month = Number(match[1]);
  const day = Number(match[2]);
  return month * 100 + day;
}

// "## 見出し" で区切られたMarkdown本文を見出しごとにグルーピングし、
// 同じ見出し文字列のエントリはまとめ、日付昇順に並べ替える
export function parseDiaryEntries(raw: string): DiaryGroup[] {
  const lines = raw.split(/\r\n|\r|\n/);
  const groups = new Map<string, DiaryGroup>();
  const order: string[] = [];

  let currentHeading: string | null = null;
  let bodyLines: string[] = [];

  const flush = () => {
    if (currentHeading === null) return;
    const body = bodyLines.join("\n").trim();
    let group = groups.get(currentHeading);
    if (!group) {
      group = {
        heading: currentHeading,
        bodies: [],
        sortKey: extractDateKey(currentHeading, order.length),
      };
      groups.set(currentHeading, group);
      order.push(currentHeading);
    }
    group.bodies.push(body);
  };

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1].trim();
      bodyLines = [];
      continue;
    }
    if (currentHeading !== null) {
      bodyLines.push(line);
    }
  }
  flush();

  return order
    .map((heading) => groups.get(heading)!)
    .sort((a, b) => a.sortKey - b.sortKey);
}
