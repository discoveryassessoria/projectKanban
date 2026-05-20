/**
 * Script de migração: UploadThing → Cloudflare R2 (v2)
 *
 * Migra todos os arquivos antigos do UploadThing (utfs.io / ufs.sh) pro R2,
 * e atualiza as URLs no banco.
 *
 * Como rodar:
 *   1. Garante que o .env local tem as 5 env vars R2_* + as do banco (PRISMA_DATABASE_URL)
 *   2. Instala o tsx (uma única vez): npm install -D tsx
 *   3. Roda:  npx tsx scripts/migrar-uploadthing-r2.ts
 *   4. Pra testar SEM migrar de verdade (só lista o que faria):
 *               npx tsx scripts/migrar-uploadthing-r2.ts --dry-run
 *
 * O script é resumível: se travar no meio, é só rodar de novo — ele continua
 * de onde parou (porque só seleciona registros que ainda têm URL do UploadThing).
 *
 * Logs ficam em: scripts/migracao.log
 *
 * v2: retry automático em downloads, timeout de 90s, bug do log corrigido.
 */

import { PrismaClient } from "@prisma/client";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

// ============================================================
// CONFIGURAÇÃO
// ============================================================

const DRY_RUN = process.argv.includes("--dry-run");
const LOG_FILE = path.join(__dirname, "migracao.log");
const PAUSA_ENTRE_ARQUIVOS_MS = 500;

const MAX_TENTATIVAS_DOWNLOAD = 3;
const PAUSA_ENTRE_TENTATIVAS_MS = 3000;
const TIMEOUT_DOWNLOAD_MS = 90_000; // 90 segundos

const directUrl = process.env.DIRECT_DATABASE_URL;
if (!directUrl) {
  console.error("❌ DIRECT_DATABASE_URL não encontrada no .env");
  console.error("   Pega ela em: Supabase → Project Settings → Database → Connection string (URI mode)");
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `${directUrl}${directUrl.includes("?") ? "&" : "?"}connection_limit=3&pool_timeout=60`,
    },
  },
});

function envOrDie(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`❌ Env var faltando: ${name}`);
    console.error(`   Confere se o .env tá no mesmo diretório e tem todas as 5 R2_*.`);
    process.exit(1);
  }
  return v;
}

const R2_ACCOUNT_ID = envOrDie("R2_ACCOUNT_ID");
const R2_ACCESS_KEY_ID = envOrDie("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = envOrDie("R2_SECRET_ACCESS_KEY");
const R2_BUCKET = envOrDie("R2_BUCKET_NAME");
const R2_PUBLIC_URL = envOrDie("R2_PUBLIC_URL");

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// ============================================================
// HELPERS
// ============================================================

function log(msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

function sanitize(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Download com timeout + retry automático.
 */
async function downloadComRetry(
  url: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_DOWNLOAD; tentativa++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_DOWNLOAD_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        log(
          `    ⚠️  Tentativa ${tentativa}/${MAX_TENTATIVAS_DOWNLOAD}: HTTP ${response.status}`
        );
        if (tentativa < MAX_TENTATIVAS_DOWNLOAD) {
          await sleep(PAUSA_ENTRE_TENTATIVAS_MS);
          continue;
        }
        return null;
      }

      const contentType =
        response.headers.get("content-type") || "application/octet-stream";
      const buffer = Buffer.from(await response.arrayBuffer());

      if (buffer.length === 0) {
        log(`    ⚠️  Tentativa ${tentativa}/${MAX_TENTATIVAS_DOWNLOAD}: Arquivo vazio`);
        if (tentativa < MAX_TENTATIVAS_DOWNLOAD) {
          await sleep(PAUSA_ENTRE_TENTATIVAS_MS);
          continue;
        }
        return null;
      }

      return { buffer, contentType };
    } catch (err: any) {
      clearTimeout(timeoutId);
      log(
        `    ⚠️  Tentativa ${tentativa}/${MAX_TENTATIVAS_DOWNLOAD}: ${err.message}`
      );
      if (tentativa < MAX_TENTATIVAS_DOWNLOAD) {
        await sleep(PAUSA_ENTRE_TENTATIVAS_MS);
      }
    }
  }
  return null;
}

// ============================================================
// FUNÇÃO PRINCIPAL: MIGRAR 1 ARQUIVO
// ============================================================

async function migrarArquivo(
  url: string,
  prefix: string,
  filename: string
): Promise<{ url: string; key: string } | null> {
  try {
    // 1) Baixa do UploadThing (com retry)
    const downloaded = await downloadComRetry(url);
    if (!downloaded) {
      log(`    ❌ Download falhou após ${MAX_TENTATIVAS_DOWNLOAD} tentativas`);
      return null;
    }

    const { buffer, contentType } = downloaded;
    log(`    📥 Baixado (${formatBytes(buffer.length)}, ${contentType})`);

    // 2) Sobe pro R2
    const safeName = sanitize(filename) || "arquivo";
    const key = `${prefix}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;

    if (DRY_RUN) {
      log(`    🧪 [dry-run] Subiria pra R2 em: ${key}`);
      return { url: `${R2_PUBLIC_URL}/${key}`, key };
    }

    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );

    const publicUrl = `${R2_PUBLIC_URL}/${key}`;
    log(`    ☁️  Subido pra R2: ${key}`);
    return { url: publicUrl, key };
  } catch (err: any) {
    log(`    ❌ Erro inesperado: ${err.message}`);
    return null;
  }
}

// ============================================================
// MIGRAR: AnexoRequerente
// ============================================================

async function migrarAnexoRequerente() {
  const registros = await prisma.anexoRequerente.findMany({
    where: {
      OR: [
        { urlArquivo: { contains: "utfs.io" } },
        { urlArquivo: { contains: "ufs.sh" } },
      ],
    },
  });

  log("");
  log("=".repeat(70));
  log(`AnexoRequerente: ${registros.length} arquivos`);
  log("=".repeat(70));

  let migrados = 0;
  let falhados = 0;

  for (let i = 0; i < registros.length; i++) {
    const reg = registros[i];
    log(
      `[${i + 1}/${registros.length}] AnexoRequerente#${reg.id} — ${reg.nomeArquivo}`
    );

    const result = await migrarArquivo(
      reg.urlArquivo,
      "migrados/anexos-requerente",
      reg.nomeArquivo
    );

    if (result) {
      if (DRY_RUN) {
        log(`    🧪 [dry-run] Atualizaria URL no banco`);
      } else {
        await prisma.anexoRequerente.update({
          where: { id: reg.id },
          data: { urlArquivo: result.url },
        });
        log(`    ✅ URL atualizada no banco`);
      }
      migrados++;
    } else {
      log(`    ⚠️  Pulado (continuando)`);
      falhados++;
    }

    await sleep(PAUSA_ENTRE_ARQUIVOS_MS);
  }

  log("");
  log(`AnexoRequerente: ✅ ${migrados} migrados | ⚠️  ${falhados} falhas`);
}

// ============================================================
// MIGRAR: Documento.arquivo_url
// ============================================================

async function migrarDocumento() {
  const registros = await prisma.documento.findMany({
    where: {
      OR: [
        { arquivo_url: { contains: "utfs.io" } },
        { arquivo_url: { contains: "ufs.sh" } },
      ],
    },
  });

  log("");
  log("=".repeat(70));
  log(`Documento.arquivo_url: ${registros.length} arquivos`);
  log("=".repeat(70));

  let migrados = 0;
  let falhados = 0;

  for (let i = 0; i < registros.length; i++) {
    const reg = registros[i];
    log(
      `[${i + 1}/${registros.length}] Documento#${reg.id} — ${reg.arquivo_nome || "(sem nome)"}`
    );

    if (!reg.arquivo_url) {
      log(`    ⚠️  Sem URL, pulado`);
      continue;
    }

    const result = await migrarArquivo(
      reg.arquivo_url,
      "migrados/documentos",
      reg.arquivo_nome || `doc-${reg.id}`
    );

    if (result) {
      if (DRY_RUN) {
        log(`    🧪 [dry-run] Atualizaria URL no banco`);
      } else {
        await prisma.documento.update({
          where: { id: reg.id },
          data: { arquivo_url: result.url },
        });
        log(`    ✅ URL atualizada no banco`);
      }
      migrados++;
    } else {
      log(`    ⚠️  Pulado (continuando)`);
      falhados++;
    }

    await sleep(PAUSA_ENTRE_ARQUIVOS_MS);
  }

  log("");
  log(`Documento.arquivo_url: ✅ ${migrados} migrados | ⚠️  ${falhados} falhas`);
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const inicio = Date.now();

  log("");
  log("=".repeat(70));
  log(`INÍCIO DA MIGRAÇÃO UploadThing → Cloudflare R2`);
  log(DRY_RUN ? "MODO: DRY-RUN (não vai migrar de verdade)" : "MODO: REAL");
  log(`Bucket: ${R2_BUCKET}`);
  log(`URL pública: ${R2_PUBLIC_URL}`);
  log(`Retry: ${MAX_TENTATIVAS_DOWNLOAD} tentativas | Timeout: ${TIMEOUT_DOWNLOAD_MS / 1000}s`);
  log("=".repeat(70));

  try {
    await migrarAnexoRequerente();
    await migrarDocumento();

    const duracaoMin = ((Date.now() - inicio) / 60000).toFixed(1);
    log("");
    log("=".repeat(70));
    log(`MIGRAÇÃO CONCLUÍDA em ${duracaoMin} minutos`);
    log("=".repeat(70));
    log("");
    log("Próximo passo: roda aquela query do Supabase de novo.");
    log("Todos os campos devem dar 0 (zero) agora.");
  } catch (err: any) {
    log("");
    log(`❌ ERRO FATAL: ${err.message}`);
    log(`Stack: ${err.stack}`);
    log("");
    log("Pode rodar o script de novo — ele vai continuar de onde parou.");
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();