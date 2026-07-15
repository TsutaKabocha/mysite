import type { Context } from "@netlify/functions";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const DEFAULT_SIZE_LIMIT_BYTES = 943718400; // 900MB

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

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return json(
      {
        success: false,
        message: "リクエストボディが不正です(multipart/form-data で送信してください)",
      },
      400
    );
  }

  const password = formData.get("password");
  if (typeof password !== "string" || password !== expectedPassword) {
    return json({ success: false, message: "パスワードが違います" }, 401);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return json({ success: false, message: "file が指定されていません" }, 400);
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

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

  const sizeLimitBytes = getSizeLimitBytes();
  if (currentUsage + file.size > sizeLimitBytes) {
    const limitMb = Math.round(sizeLimitBytes / (1024 * 1024));
    return json(
      {
        success: false,
        message: `R2の使用量上限(${limitMb}MB)を超えるためアップロードできません`,
      },
      429
    );
  }

  const key = buildObjectKey(file.name);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: file.type || "application/octet-stream",
      })
    );
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error ? error.message : "R2へのアップロードに失敗しました";
    return json({ success: false, message }, 500);
  }

  const url = `${publicUrl.replace(/\/$/, "")}/${key}`;

  return json({
    success: true,
    url,
    filename: file.name,
    contentType: file.type,
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
