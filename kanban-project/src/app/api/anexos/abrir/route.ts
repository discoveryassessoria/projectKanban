// src/app/api/anexos/abrir/route.ts
// ============================================================================
// A PORTA ÚNICA DE ABRIR ANEXO.   POST /api/anexos/abrir   { chave, nome?, mime?, auditar?, baixar? }  →  { url, expiraEmSegundos }
//
// 1) confere o LOGIN (401) e a PERMISSÃO do módulo dono do anexo (403) — o domínio está na própria chave (ver `src/lib/anexos/chave.ts`);
// 2) só então assina: URL de leitura com validade de 5 minutos. Nenhum endereço fixo; cada abertura gera uma URL nova.
// Endereço antigo (público ou externo) NÃO passa por aqui: a tela o usa como está.
// ============================================================================
import { NextRequest, NextResponse } from "next/server"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { autorizarAbertura } from "@/src/lib/anexos/porta"
import { urlAssinadaDoAnexo } from "@/src/lib/anexos/storage"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const usuario = await extrairUsuarioComPermissoes(req)
  const body = (await req.json().catch(() => ({}))) as { chave?: unknown; nome?: unknown; mime?: unknown; auditar?: unknown; baixar?: unknown }
  const decisao = autorizarAbertura(usuario ? { userId: usuario.userId, tipo: usuario.tipo, permissoes: usuario.permissoes as Record<string, boolean> } : null, body.chave)
  if (!decisao.ok) return NextResponse.json({ error: decisao.erro }, { status: decisao.status })

  const chave = body.chave as string
  const nome = typeof body.nome === "string" && body.nome.trim() ? body.nome.trim() : chave.split("/").pop() ?? "arquivo"
  const mime = typeof body.mime === "string" && body.mime.trim() ? body.mime.trim() : "application/octet-stream"
  try {
    const r = await urlAssinadaDoAnexo(chave, nome, mime, body.baixar === true)
    // Quem ABRIU (clique) o quê, sem o endereço assinado (que é a credencial): só a chave e o domínio. Miniatura/pré-visualização não audita
    // (seriam dezenas de linhas por tela).
    if (body.auditar === true) await prisma.logAuditoria.create({
      data: { acao: "ANEXO_ABERTO", entidade: "Anexo", entidadeId: decisao.alvo.id, usuarioId: usuario!.userId, descricao: `Anexo (${decisao.alvo.dominio} ${decisao.alvo.id}) aberto por URL assinada de ${r.expiraEmSegundos}s`, detalhes: { chave, dominio: decisao.alvo.dominio } },
    }).catch(() => undefined)
    return NextResponse.json({ url: r.url, expiraEmSegundos: r.expiraEmSegundos }, { headers: { "Cache-Control": "no-store" } })
  } catch (e) {
    console.error("[/api/anexos/abrir] erro:", e)
    return NextResponse.json({ error: "Não foi possível gerar o endereço de abertura" }, { status: 500 })
  }
}
