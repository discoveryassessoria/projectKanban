import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { r2, R2_BUCKET, R2_PUBLIC_URL } from "@/src/lib/r2";
import { verifyAuth } from "@/src/lib/verify-auth";

// Mesmas regras do anexoUploader do UploadThing
const MAX_SIZE = 64 * 1024 * 1024; // 64MB
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.ms-excel", // .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
]);

function sanitize(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")     // tira acentos
    .replace(/[^a-zA-Z0-9._-]/g, "_")    // troca o resto por _
    .replace(/_+/g, "_")
    .slice(0, 120);
}

export async function POST(req: NextRequest) {
  const auth = verifyAuth(req);
    if (!auth.isAuthenticated) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

  let body: { filename?: string; contentType?: string; size?: number; prefix?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { filename, contentType, size, prefix } = body;

  if (!filename || !contentType || typeof size !== "number") {
    return NextResponse.json(
      { error: "filename, contentType e size são obrigatórios" },
      { status: 400 }
    );
  }
  if (size <= 0 || size > MAX_SIZE) {
    return NextResponse.json(
      { error: `Tamanho inválido. Limite: ${MAX_SIZE / 1024 / 1024}MB` },
      { status: 400 }
    );
  }
  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json(
      { error: `Tipo não permitido: ${contentType}` },
      { status: 400 }
    );
  }

  const safeName = sanitize(filename) || "arquivo";
  const folder = prefix ? `${prefix.replace(/^\/+|\/+$/g, "")}/` : "uploads/";
  const key = `${folder}${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: contentType,
    ContentLength: size,
  });

  try {
    const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 300 }); // 5 min
    const publicUrl = `${R2_PUBLIC_URL}/${key}`;

    return NextResponse.json({ uploadUrl, publicUrl, key });
  } catch (err) {
    console.error("[/api/storage/presign] erro:", err);
    return NextResponse.json(
      { error: "Erro ao gerar URL de upload" },
      { status: 500 }
    );
  }
}