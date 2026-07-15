import type { Context } from "@netlify/functions";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

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

  const key = buildObjectKey(file.name);

  try {
    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
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
