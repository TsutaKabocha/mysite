import type { Context } from "@netlify/functions";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const DEFAULT_SIZE_LIMIT_BYTES = 943718400; // 900MB
const PRESIGNED_URL_EXPIRES_SECONDS = 300;

interface RequestPayload {
  password?: string;
  filename?: string;
  contentType?: string;
  size?: number;
}

// Netlify Functions(AWS Lambda)は同期呼び出しのリクエストボディが6MB(バイナリは実質4.5MB)までしか
// 受け付けられず、この上限はプラットフォーム側の制約でnetlify.tomlからは緩和できない。
// そのためファイル本体はこの関数を経由させず、署名付きURLを発行してブラウザからR2へ直接PUTさせる。
export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return json({ success: false, message: "Method Not Allowed" }, 405);
  }

  const expectedPassword = process.env.DIARY_PASSWORD;
  if (!expectedPassword) {
    return json(
      { success: false, message: "サーバー設定エラー: DIARY_PASSWORD が未設定です" },
      500
    );
  }

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !publicUrl) {
    return json(
      {
        success: false,
        message:
          "サーバー設定エラー: R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME / R2_PUBLIC_URL が未設定です",
      },
      500
    );
  }

  let payload: RequestPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ success: false, message: "リクエストボディが不正です" }, 400);
  }

  const { password, filename, contentType, size } = payload ?? {};

  if (typeof password !== "string" || password !== expectedPassword) {
    return json({ success: false, message: "パスワードが違います" }, 401);
  }

  if (typeof filename !== "string" || filename.trim().length === 0) {
    return json({ success: false, message: "filename が指定されていません" }, 400);
  }
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    return json({ success: false, message: "size が不正です" }, 400);
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const sizeLimitBytes = getSizeLimitBytes();
  const limitMb = Math.round(sizeLimitBytes / (1024 * 1024));

  if (size > sizeLimitBytes) {
    return json(
      {
        success: false,
        message: `ファイルサイズが上限(${limitMb}MB)を超えています(このファイル: ${Math.round(size / (1024 * 1024))}MB)`,
      },
      429
    );
  }

  let currentUsage: number;
  try {
    currentUsage = await getR2BucketUsageBytes(s3, bucketName);
  } catch (error) {
    console.error(error);
    return json(
      {
        success: false,
        message: "R2使用量の取得に失敗したためアップロードを中止しました",
      },
      503
    );
  }

  if (currentUsage + size > sizeLimitBytes) {
    const remainingMb = Math.max(
      0,
      Math.round((sizeLimitBytes - currentUsage) / (1024 * 1024))
    );
    return json(
      {
        success: false,
        message: `R2の使用量上限(${limitMb}MB)を超えるためアップロードできません(あと約${remainingMb}MBまで送信可能です)`,
      },
      429
    );
  }

  const key = buildObjectKey(filename);
  const resolvedContentType = contentType || "application/octet-stream";

  let uploadUrl: string;
  try {
    uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        ContentType: resolvedContentType,
      }),
      { expiresIn: PRESIGNED_URL_EXPIRES_SECONDS }
    );
  } catch (error) {
    console.error(error);
    return json(
      { success: false, message: "アップロードURLの発行に失敗しました" },
      500
    );
  }

  const url = `${publicUrl.replace(/\/$/, "")}/${key}`;

  return json({
    success: true,
    uploadUrl,
    url,
    filename,
    contentType: resolvedContentType,
  });
};

function getSizeLimitBytes(): number {
  const raw = process.env.R2_SIZE_LIMIT_BYTES;
  if (!raw) return DEFAULT_SIZE_LIMIT_BYTES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SIZE_LIMIT_BYTES;
}

// バケット内の全オブジェクトを列挙してサイズを合計する(R2にはS3の集計APIがないため)
async function getR2BucketUsageBytes(
  s3: S3Client,
  bucket: string
): Promise<number> {
  let totalSize = 0;
  let continuationToken: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of res.Contents ?? []) {
      totalSize += obj.Size ?? 0;
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
  return totalSize;
}

// R2上でのオブジェクトキーを生成する(日付ディレクトリ + UUID接頭辞でファイル名衝突を避ける)
function buildObjectKey(originalFilename: string): string {
  const safeName = originalFilename.replace(/[^\w.\-]/g, "_") || "file";
  const id = crypto.randomUUID();
  const date = new Date().toISOString().slice(0, 10);
  return `media/${date}/${id}-${safeName}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
