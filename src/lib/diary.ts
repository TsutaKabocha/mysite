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
