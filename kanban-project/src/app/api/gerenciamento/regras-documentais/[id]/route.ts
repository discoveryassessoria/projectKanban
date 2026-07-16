// src/app/api/gerenciamento/regras-documentais/[id]/route.ts
//
// Item + ações de uma regra documental. Versionamento explícito: uma regra
// PUBLICADA não é sobrescrita — edições exigem NOVA VERSÃO. Publicar é restrito.

import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { matrizParaRegra, regraInputParaData } from "@/src/lib/documentos/regras-documentais/mapear"
import {
  validarRegraInput, normalizarInput, auditar, usuarioIdDe, novoCodigoRegra,
} from "@/src/lib/documentos/regras-documentais/persistencia"

async function achar(id: number) {
  return prisma.matrizDocumental.findUnique({ where: { id } })
}

// JsonValue (pode ser null) → InputJsonValue | undefined (Prisma não aceita null cru)
const j = (v: unknown): Prisma.InputJsonValue | undefined => (v === null || v === undefined ? undefined : (v as Prisma.InputJsonValue))

// GET — regra + suas versões (siblings por codigo)
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const { id } = await params
    const row = await achar(Number(id))
    if (!row) return NextResponse.json({ error: "Regra não encontrada." }, { status: 404 })
    const versoesRows = row.codigo
      ? await prisma.matrizDocumental.findMany({ where: { codigo: row.codigo }, orderBy: { versao: "desc" } })
      : [row]
    return NextResponse.json({ regra: matrizParaRegra(row), versoes: versoesRows.map(matrizParaRegra) })
  } catch (e) {
    console.error("GET regras-documentais/[id]", e)
    return NextResponse.json({ error: "Erro ao carregar a regra." }, { status: 500 })
  }
}

// PUT — edita RASCUNHO. Regra PUBLICADA não é sobrescrita (use nova versão).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const { id } = await params
    const atual = await achar(Number(id))
    if (!atual) return NextResponse.json({ error: "Regra não encontrada." }, { status: 404 })
    // Edição SEMPRE no lugar (mesma linha, mesmo id) — não duplica nem inativa.
    // Vale para rascunho, inativa e publicada. Arquivada é somente leitura.
    if (atual.status === "ARQUIVADA") {
      return NextResponse.json({ error: "Regra arquivada é somente leitura. Reabra para editar.", code: "ARQUIVADA_IMUTAVEL" }, { status: 409 })
    }
    const b = await request.json()
    const input = normalizarInput(b)
    const erros = validarRegraInput(input, false)
    if (erros.length) return NextResponse.json({ error: erros[0].mensagem, erros }, { status: 400 })

    const usuarioId = await usuarioIdDe(request)
    const data = regraInputParaData(input)
    const row = await prisma.matrizDocumental.update({ where: { id: atual.id }, data: { ...(data as object), atualizadoPor: usuarioId ?? undefined } })
    await auditar(prisma, { acao: "REGRA_EDITADA", entidadeId: row.id, descricao: `Regra editada no lugar: ${row.nome ?? row.documentTypeCode} (v${row.versao}, ${row.status})`, detalhes: { antes: matrizParaRegra(atual), depois: matrizParaRegra(row) }, usuarioId })
    return NextResponse.json({ regra: row })
  } catch (e) {
    console.error("PUT regras-documentais/[id]", e)
    return NextResponse.json({ error: "Erro ao salvar a regra." }, { status: 500 })
  }
}

// DELETE — só regra NUNCA utilizada e sem referências.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const { id } = await params
    const atual = await achar(Number(id))
    if (!atual) return NextResponse.json({ error: "Regra não encontrada." }, { status: 404 })
    if ((atual.usedByCount || 0) > 0) return NextResponse.json({ error: "Regra já utilizada; arquive em vez de excluir.", blocked: true }, { status: 409 })
    const usuarioId = await usuarioIdDe(request)
    await prisma.matrizDocumental.delete({ where: { id: atual.id } })
    await auditar(prisma, { acao: "REGRA_EXCLUIDA", entidadeId: atual.id, descricao: `Regra excluída (nunca utilizada): ${atual.nome ?? atual.documentTypeCode}`, detalhes: { regra: matrizParaRegra(atual) }, usuarioId })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("DELETE regras-documentais/[id]", e)
    return NextResponse.json({ error: "Erro ao excluir a regra." }, { status: 500 })
  }
}

// POST — ações: duplicar | publicar | inativar | arquivar | nova_versao
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const atual = await achar(Number(id))
    if (!atual) return NextResponse.json({ error: "Regra não encontrada." }, { status: 404 })
    const b = await request.json().catch(() => ({}))
    const acao = String(b?.acao || "")
    const usuarioId = await usuarioIdDe(request)

    // publicar é a única ação com permissão RESTRITA
    const permKey = acao === "publicar" ? "regras_documentais.publicar" : "usuarios.gerenciar"
    const erro = await verificarPermissao(request, permKey as never)
    if (erro) return erro

    switch (acao) {
      case "duplicar": {
        const codigo = novoCodigoRegra(atual.tipoProcessoId, atual.documentTypeCode)
        const { id: _i, criadoEm: _c, atualizadoEm: _a, publicadoEm: _pe, publicadoPor: _pp, condicoes: _cond, tipoProcessoIds: _tpi, documentosAceitos: _da, publicosAlvo: _pa, ...resto } = atual
        void _i; void _c; void _a; void _pe; void _pp
        const row = await prisma.matrizDocumental.create({
          data: { ...resto, condicoes: j(_cond), tipoProcessoIds: j(_tpi), documentosAceitos: j(_da), publicosAlvo: j(_pa), codigo, versao: 1, status: "RASCUNHO", arquivado: false, usedByCount: 0, nome: `${atual.nome ?? atual.documentTypeCode} (cópia)`, criadoPor: usuarioId ?? undefined, atualizadoPor: usuarioId ?? undefined },
        })
        await auditar(prisma, { acao: "REGRA_DUPLICADA", entidadeId: row.id, descricao: `Regra duplicada de #${atual.id}`, detalhes: { origem: atual.id, codigo }, usuarioId })
        return NextResponse.json({ regra: row }, { status: 201 })
      }
      case "nova_versao": {
        const maxV = atual.codigo
          ? (await prisma.matrizDocumental.aggregate({ where: { codigo: atual.codigo }, _max: { versao: true } }))._max.versao ?? atual.versao
          : atual.versao
        const { id: _i, criadoEm: _c, atualizadoEm: _a, publicadoEm: _pe, publicadoPor: _pp, condicoes: _cond, tipoProcessoIds: _tpi, documentosAceitos: _da, publicosAlvo: _pa, ...resto } = atual
        void _i; void _c; void _a; void _pe; void _pp
        const row = await prisma.matrizDocumental.create({
          data: { ...resto, condicoes: j(_cond), tipoProcessoIds: j(_tpi), documentosAceitos: j(_da), publicosAlvo: j(_pa), versao: maxV + 1, status: "RASCUNHO", arquivado: false, criadoPor: usuarioId ?? undefined, atualizadoPor: usuarioId ?? undefined },
        })
        await auditar(prisma, { acao: "REGRA_NOVA_VERSAO", entidadeId: row.id, descricao: `Nova versão v${row.versao} de ${atual.nome ?? atual.documentTypeCode}`, detalhes: { origem: atual.id, codigo: atual.codigo, versao: row.versao }, usuarioId })
        return NextResponse.json({ regra: row }, { status: 201 })
      }
      case "publicar": {
        if (!atual.nome || !atual.documentTypeCode) return NextResponse.json({ error: "Regra incompleta: defina nome e documento antes de publicar." }, { status: 400 })
        const row = await prisma.$transaction(async (tx) => {
          // versão anterior publicada do mesmo código passa a INATIVA (histórico consultável)
          if (atual.codigo) {
            await tx.matrizDocumental.updateMany({ where: { codigo: atual.codigo, status: "PUBLICADA", id: { not: atual.id } }, data: { status: "INATIVA" } })
          }
          const r = await tx.matrizDocumental.update({ where: { id: atual.id }, data: { status: "PUBLICADA", arquivado: false, publicadoEm: new Date(), publicadoPor: usuarioId ?? undefined } })
          await auditar(tx, { acao: "REGRA_PUBLICADA", entidadeId: r.id, descricao: `Regra publicada: ${r.nome} (v${r.versao})`, detalhes: { codigo: r.codigo, versao: r.versao }, usuarioId })
          return r
        })
        return NextResponse.json({ regra: row })
      }
      case "inativar": {
        const row = await prisma.matrizDocumental.update({ where: { id: atual.id }, data: { status: "INATIVA" } })
        await auditar(prisma, { acao: "REGRA_INATIVADA", entidadeId: row.id, descricao: `Regra inativada: ${row.nome ?? row.documentTypeCode}`, usuarioId })
        return NextResponse.json({ regra: row })
      }
      case "arquivar": {
        const row = await prisma.matrizDocumental.update({ where: { id: atual.id }, data: { status: "ARQUIVADA", arquivado: true } })
        await auditar(prisma, { acao: "REGRA_ARQUIVADA", entidadeId: row.id, descricao: `Regra arquivada: ${row.nome ?? row.documentTypeCode}`, usuarioId })
        return NextResponse.json({ regra: row })
      }
      case "reativar": {
        const row = await prisma.matrizDocumental.update({ where: { id: atual.id }, data: { status: "RASCUNHO", arquivado: false } })
        await auditar(prisma, { acao: "REGRA_REATIVADA", entidadeId: row.id, descricao: `Regra reaberta como rascunho: ${row.nome ?? row.documentTypeCode}`, usuarioId })
        return NextResponse.json({ regra: row })
      }
      default:
        return NextResponse.json({ error: `Ação desconhecida: "${acao}".` }, { status: 400 })
    }
  } catch (e) {
    console.error("POST regras-documentais/[id]", e)
    return NextResponse.json({ error: "Erro ao processar a ação." }, { status: 500 })
  }
}
