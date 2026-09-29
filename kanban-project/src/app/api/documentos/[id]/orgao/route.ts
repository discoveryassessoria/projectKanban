// POST /api/documentos/:id/orgao — vincula (ou cadastra e vincula) o órgão emissor
// do documento SEM sair do painel. Escreve Documento.orgaoId + Tarefa.orgaoId
// numa transação (vincularOrgaoAoDocumento).
//   { orgaoId }                      → vincula existente (OrgaoProtocolo)
//   { cartorioId }                   → promove da base nacional (Cartorio) e vincula
//   { novo: {name,tipo,city,state?,paisId?,email?,telefone?} }
//                                    → cadastra (409 DUPLICADO com o existente) e vincula
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import {
  vincularOrgaoAoDocumento, cadastrarOrgaoRapido, promoverCartorioParaOrgao, OrgaoInexistenteError, DocumentoInexistenteError,
} from "@/src/services/orgao-vinculo-documento"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "arvore.editar_documento")
  if (erro) return erro
  const documentoId = Number((await params).id)
  if (!Number.isInteger(documentoId) || documentoId <= 0) return NextResponse.json({ ok: false, code: "DOCUMENTO_INVALIDO" }, { status: 400 })
  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const usuario = await extrairUsuarioComPermissoes(request)

  try {
    let orgaoId = Number(body.orgaoId)
    let criado = false
    if (Number.isInteger(body.cartorioId) && Number(body.cartorioId) > 0) {
      const r = await promoverCartorioParaOrgao(prisma, Number(body.cartorioId), usuario?.userId ?? null)
      orgaoId = r.orgaoId; criado = r.criado
    } else if (body.novo && typeof body.novo === "object") {
      const n = body.novo as Record<string, unknown>
      const r = await cadastrarOrgaoRapido(prisma, {
        name: String(n.name ?? ""), tipo: String(n.tipo ?? ""), city: String(n.city ?? ""),
        state: typeof n.state === "string" ? n.state : null,
        paisId: n.paisId != null ? Number(n.paisId) : null,
        email: typeof n.email === "string" ? n.email : null,
        telefone: typeof n.telefone === "string" ? n.telefone : null,
      }, usuario?.userId ?? null)
      if (!r.ok) return NextResponse.json(r, { status: r.code === "DUPLICADO" ? 409 : 400 })
      orgaoId = r.orgaoId; criado = true
    }
    if (!Number.isInteger(orgaoId) || orgaoId <= 0) return NextResponse.json({ ok: false, code: "ORGAO_INVALIDO" }, { status: 400 })
    const v = await vincularOrgaoAoDocumento(prisma, documentoId, orgaoId)
    return NextResponse.json({ ok: true, criado, orgao: v.orgao, tarefasVinculadas: v.tarefasVinculadas })
  } catch (e) {
    if (e instanceof OrgaoInexistenteError) return NextResponse.json({ ok: false, code: "ORGAO_INEXISTENTE", mensagem: e.message }, { status: 404 })
    if (e instanceof DocumentoInexistenteError) return NextResponse.json({ ok: false, code: "DOCUMENTO_INEXISTENTE", mensagem: e.message }, { status: 404 })
    console.error("POST documentos/[id]/orgao", e)
    return NextResponse.json({ ok: false, code: "ERRO", mensagem: "Erro ao vincular órgão." }, { status: 500 })
  }
}
