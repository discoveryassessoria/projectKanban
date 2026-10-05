import { NextRequest, NextResponse } from "next/server";
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao";
import { autorizarAcessoAoAlvo } from "@/src/lib/anexos/porta";
import { ehDominioDeAnexo } from "@/src/lib/anexos/chave";
import { prepararEnvioDeAnexo, BucketPrivadoNaoConfigurado } from "@/src/lib/anexos/storage";

// ============================================================================
// ENVIO DE ANEXO — gera a URL assinada para o navegador subir DIRETO no bucket PRIVADO (`discovery-privado`), em
// `privado/anexos/<domínio>/<id>/…`. O que volta em `publicUrl` é a CHAVE (nome mantido por compatibilidade com quem já lê esse campo):
// o banco guarda só a chave, nunca um endereço público. Para ABRIR o anexo: `POST /api/anexos/abrir` (login + permissão + URL de 5 min).
// Corpo: { filename, contentType, size, alvo: { dominio, id } } — `alvo` diz de quem é o anexo (processo, protocolo, contratante, …).
// ============================================================================

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

export async function POST(req: NextRequest) {
  // Login E permissão do módulo dono do anexo (antes bastava estar logado).
  const usuario = await extrairUsuarioComPermissoes(req);
  if (!usuario) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: { filename?: string; contentType?: string; size?: number; alvo?: { dominio?: string; id?: number } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { filename, contentType, size, alvo } = body;

  if (!filename || !contentType || typeof size !== "number") {
    return NextResponse.json(
      { error: "filename, contentType e size são obrigatórios" },
      { status: 400 }
    );
  }
  if (!alvo || !ehDominioDeAnexo(alvo.dominio) || typeof alvo.id !== "number" || !Number.isInteger(alvo.id) || alvo.id < 0) {
    return NextResponse.json({ error: "alvo { dominio, id } é obrigatório (de quem é este anexo)" }, { status: 400 });
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

  // Rascunho (cliente ainda não salvo): o id é SEMPRE o do próprio usuário — nunca o que o navegador mandar.
  const alvoFinal = { dominio: alvo.dominio, id: alvo.dominio === "rascunho" ? usuario.userId : alvo.id };
  const decisao = autorizarAcessoAoAlvo({ userId: usuario.userId, tipo: usuario.tipo, permissoes: usuario.permissoes as Record<string, boolean> }, alvoFinal);
  if (!decisao.ok) return NextResponse.json({ error: decisao.erro }, { status: decisao.status });

  try {
    const { chave, uploadUrl } = await prepararEnvioDeAnexo({ alvo: alvoFinal, nome: filename, tipo: contentType, tamanho: size });
    return NextResponse.json({ uploadUrl, publicUrl: chave, key: chave });
  } catch (err) {
    if (err instanceof BucketPrivadoNaoConfigurado) {
      console.error("[/api/storage/presign]", err.message);
      return NextResponse.json({ error: "Armazenamento privado indisponível. Tente novamente mais tarde." }, { status: 503 });
    }
    console.error("[/api/storage/presign] erro:", err);
    return NextResponse.json(
      { error: "Erro ao gerar URL de upload" },
      { status: 500 }
    );
  }
}
