import type { Context } from "@netlify/functions";

interface RequestPayload {
  password?: string;
  date?: string;
  content?: string;
  mode?: "single" | "bulk";
}

interface DiaryEntry {
  date: string; // YYYY-MM-DD
  body: string;
}

const DIARY_DIR = "src/content/diary";

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return json({ success: false, message: "Method Not Allowed" }, 405);
  }

  let payload: RequestPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ success: false, message: "リクエストボディが不正です" }, 400);
  }

  const { password, date, content, mode } = payload ?? {};

  const expectedPassword = process.env.DIARY_PASSWORD;
  if (!expectedPassword) {
    return json(
      { success: false, message: "サーバー設定エラー: DIARY_PASSWORD が未設定です" },
      500
    );
  }
  if (typeof password !== "string" || password !== expectedPassword) {
    return json({ success: false, message: "パスワードが違います" }, 401);
  }

  if (mode !== "single" && mode !== "bulk") {
    return json(
      { success: false, message: "mode は single または bulk を指定してください" },
      400
    );
  }

  const token = process.env.GITHUB_TOKEN;
  const repoFull = process.env.GITHUB_REPO;
  if (!token || !repoFull) {
    return json(
      {
        success: false,
        message: "サーバー設定エラー: GITHUB_TOKEN / GITHUB_REPO が未設定です",
      },
      500
    );
  }
  const [owner, repo] = repoFull.split("/");
  if (!owner || !repo) {
    return json(
      { success: false, message: "GITHUB_REPO の形式が不正です (例: owner/repo)" },
      500
    );
  }

  let entries: DiaryEntry[];

  if (mode === "single") {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json(
        { success: false, message: "date は YYYY-MM-DD 形式で指定してください" },
        400
      );
    }
    if (typeof content !== "string" || content.trim().length === 0) {
      return json({ success: false, message: "本文が空です" }, 400);
    }
    entries = [{ date, body: normalizeBody(content) }];
  } else {
    if (typeof content !== "string" || content.trim().length === 0) {
      return json(
        { success: false, message: "インポートするテキストが空です" },
        400
      );
    }
    try {
      entries = parseBulkContent(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : "パースエラー";
      return json({ success: false, message }, 400);
    }
    if (entries.length === 0) {
      return json(
        {
          success: false,
          message: "6桁の日付行(例: 260714)が見つかりませんでした",
        },
        400
      );
    }
  }

  const grouped = groupByMonth(entries);
  const updatedMonths: string[] = [];

  try {
    for (const [yearMonth, monthEntries] of grouped) {
      const commitMessage =
        mode === "single"
          ? `diary: ${date} を追記`
          : `diary: ${yearMonth} に一括インポート (${monthEntries.length}件)`;
      await appendEntriesToMonth(
        owner,
        repo,
        token,
        yearMonth,
        monthEntries,
        commitMessage
      );
      updatedMonths.push(yearMonth);
    }
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error ? error.message : "GitHubへの書き込みに失敗しました";
    return json({ success: false, message }, 500);
  }

  return json({
    success: true,
    message: `${entries.length}件のエントリを保存しました (${updatedMonths.join(", ")})`,
    updatedMonths,
  });
};

// ==========================================================================
// 一括インポートのパース
// ==========================================================================

function parseBulkContent(raw: string): DiaryEntry[] {
  const lines = raw.split(/\r\n|\r|\n/);
  const rawEntries: { date: string; lines: string[] }[] = [];
  let current: { date: string; lines: string[] } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\d{6}$/.test(trimmed)) {
      current = { date: yymmddToIso(trimmed), lines: [] };
      rawEntries.push(current);
      continue;
    }
    if (current) {
      current.lines.push(line);
    }
    // 最初の日付行より前の行は無視する
  }

  return rawEntries
    .map((entry) => ({
      date: entry.date,
      body: normalizeBody(entry.lines.join("\n")),
    }))
    .filter((entry) => entry.body.length > 0);
}

function yymmddToIso(yymmdd: string): string {
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
    throw new Error(`日付として解釈できない行です: ${yymmdd}`);
  }
  const year = 2000 + yy;
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

// 空行は段落区切り(\n\n)として保持しつつ、3行以上の連続空行は2行に正規化する
function normalizeBody(text: string): string {
  return text.trim().replace(/\n{3,}/g, "\n\n");
}

function groupByMonth(entries: DiaryEntry[]): Map<string, DiaryEntry[]> {
  const map = new Map<string, DiaryEntry[]>();
  for (const entry of entries) {
    const yearMonth = entry.date.slice(0, 7);
    const list = map.get(yearMonth);
    if (list) {
      list.push(entry);
    } else {
      map.set(yearMonth, [entry]);
    }
  }
  return map;
}

// ==========================================================================
// GitHub REST API
// ==========================================================================

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mysite-diary-post-function",
    "Content-Type": "application/json",
  };
}

async function githubGetFile(
  owner: string,
  repo: string,
  path: string,
  token: string
): Promise<{ content: string; sha: string } | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    { headers: githubHeaders(token) }
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GitHub からのファイル取得に失敗しました: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { content: string; sha: string };
  const content = Buffer.from(json.content, "base64").toString("utf-8");
  return { content, sha: json.sha };
}

async function githubPutFile(
  owner: string,
  repo: string,
  path: string,
  token: string,
  content: string,
  sha: string | undefined,
  message: string
): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    {
      method: "PUT",
      headers: githubHeaders(token),
      body: JSON.stringify({
        message,
        content: Buffer.from(content, "utf-8").toString("base64"),
        ...(sha ? { sha } : {}),
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`GitHub へのファイル書き込みに失敗しました: ${res.status} ${await res.text()}`);
  }
}

// ==========================================================================
// diary Markdown 組み立て
// ==========================================================================

function formatHeading(date: string): string {
  const [, m, d] = date.split("-");
  return `## ${Number(m)}月${Number(d)}日`;
}

function buildFrontmatter(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  const title = `${y}年${Number(m)}月の日記`;
  return `---\ntitle: "${title}"\nyearMonth: "${yearMonth}"\n---\n`;
}

async function appendEntriesToMonth(
  owner: string,
  repo: string,
  token: string,
  yearMonth: string,
  entries: DiaryEntry[],
  commitMessage: string
): Promise<void> {
  const path = `${DIARY_DIR}/${yearMonth}.md`;
  const existing = await githubGetFile(owner, repo, path, token);
  let content = existing ? existing.content : buildFrontmatter(yearMonth);

  for (const entry of entries) {
    const section = `${formatHeading(entry.date)}\n\n${entry.body}\n`;
    content = `${content.trimEnd()}\n\n${section}`;
  }
  content = `${content.trimEnd()}\n`;

  await githubPutFile(owner, repo, path, token, content, existing?.sha, commitMessage);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
