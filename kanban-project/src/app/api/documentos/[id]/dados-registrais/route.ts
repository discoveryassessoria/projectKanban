// GET   /api/documentos/:id/dados-registrais → o contexto da edição (valores de hoje, se o "Localizar registro" já foi concluído, quando o requerimento ao cartório saiu).
// PATCH /api/documentos/:id/dados-registrais { valores, motivo?, confirmouRequerimentoEnviado? } → corrige os Dados Registrais em QUALQUER fase (permissão `processos.editar`).
// Não reabre o passo, não muda a fase, não cancela nada, não reenvia ao cartório.
import { type NextRequest, NextResponse } from "next/server"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { decisoesDoCorpo } from "@/src/services/genealogia/confirmacao-arvore"
import { contextoDeEdicao, editarDadosRegistrais } from "@/src/services/genealogia/editar-dados-registrais"

const idDe = async (params: Promise<{ id: string }>) => { const n = Number.parseInt((await params).id); return Number.isInteger(n) && n > 0 ? n : null }

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const semPermissao = await verificarPermissao(request, "processos.editar")
  if (semPermissao) return semPermissao
  const id = await idDe(params)
  if (id == null) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  const ctx = await contextoDeEdicao(id)
  return ctx ? NextResponse.json(ctx) : NextResponse.json({ error: "Documento não encontrado" }, { status: 404 })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const semPermissao = await verificarPermissao(request, "processos.editar")
  if (semPermissao) return semPermissao
  const id = await idDe(params)
  if (id == null) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  const corpo = await request.json().catch(() => ({} as Record<string, unknown>))
  const usuario = await extrairUsuarioComPermissoes(request)
  const r = await editarDadosRegistrais({
    documentoId: id, autorId: usuario?.userId ?? null,
    valores: (typeof corpo.valores === "object" && corpo.valores ? corpo.valores : {}) as Record<string, string | null>,
    motivo: typeof corpo.motivo === "string" ? corpo.motivo : null,
    confirmouRequerimentoEnviado: corpo.confirmouRequerimentoEnviado === true,
    decisoes: decisoesDoCorpo(corpo),
  })
  if (r.ok) return NextResponse.json({ ok: true, mudancas: r.mudancas, sincronizados: r.sincronizacao.aplicados, aviso: r.aviso })
  if (r.codigo === "CONFIRMACAO_ARVORE") return NextResponse.json({ ok: false, codigo: r.codigo, error: r.mensagem, divergencias: r.divergencias }, { status: 409 })
  const status = r.codigo === "NAO_ENCONTRADO" ? 404 : r.codigo === "SEM_MUDANCA" ? 200 : r.codigo === "REQUERIMENTO_JA_ENVIADO" ? 409 : 422
  return NextResponse.json({ ok: false, codigo: r.codigo, error: r.mensagem, aviso: r.aviso ?? null }, { status })
}
