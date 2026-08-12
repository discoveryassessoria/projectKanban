// src/app/api/gerenciamento/catalogo-mestre/[id]/route.ts
// LOTE D — Catálogo Mestre: PUT (editar) e DELETE (inativa; hard delete só no motor canônico).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao, exigirPermissao } from '@/src/lib/verificar-permissao'
import { deactivateItemCatalogo } from '@/src/services/exclusao-definitiva'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'
import { NaturezaItem, UnidadeItem } from '@prisma/client'
import { NATUREZAS_ITEM_OFICIAIS } from '@/lib/financeiro/catalogo-oficial'
import { resolverCategoriaServico } from '@/src/services/categoria-servico-ref'

function toStrOrNull(v: any): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim(); return s === '' ? null : s
}
// Só naturezas OFICIAIS podem ser gravadas — as eliminadas (PRODUTO/HONORARIO)
// sobrevivem apenas nos itens históricos já existentes.
const NATUREZAS = NATUREZAS_ITEM_OFICIAIS.map((n) => NaturezaItem[n])
const UNIDADES = Object.values(UnidadeItem)

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    const { id } = await params
    const b = await request.json()
    const data: any = {}
    if (b.code !== undefined) data.code = toStrOrNull(b.code)
    if (b.name !== undefined) data.name = toStrOrNull(b.name)
    if (b.descricao !== undefined) data.descricao = toStrOrNull(b.descricao)
    const categoria = await resolverCategoriaServico(b)
    if (categoria.erros.length) {
      return NextResponse.json({ error: categoria.erros[0].mensagem, erros: categoria.erros }, { status: 400 })
    }
    if (categoria.declarado) data.categoriaId = categoria.categoriaId
    if (b.natureza !== undefined && b.natureza !== null) {
      if (!NATUREZAS.includes(b.natureza)) {
        return NextResponse.json({ error: `Natureza "${b.natureza}" não existe mais no Cadastro Mestre. Use uma das oficiais: ${NATUREZAS.join(', ')}.` }, { status: 400 })
      }
      // Virar SERVIÇO por aqui produziria um serviço sem portador de SRV-n (o
      // código vive em ServicoProduto.publicCode). Item que JÁ é o espelho de um
      // serviço passa — nesse caso a natureza só está sendo reafirmada.
      if (b.natureza === NaturezaItem.SERVICO) {
        const temServico = await prisma.servicoProduto.count({ where: { itemCatalogoId: parseInt(id) } })
        if (temServico === 0) {
          return NextResponse.json({
            error: 'Um item do mestre não vira serviço por edição — o serviço nasce no Catálogo de Serviços, que gera o código SRV-n.',
          }, { status: 400 })
        }
      }
      data.natureza = b.natureza
    }
    if (b.unidade !== undefined && UNIDADES.includes(b.unidade)) data.unidade = b.unidade
    if (b.ativo !== undefined) data.ativo = !!b.ativo
    const item = await prisma.itemCatalogo.update({ where: { id: parseInt(id) }, data })
    await registrarAuditoria(request, { acao: 'EDITAR', entidade: 'ItemCatalogo', entidadeId: item.id, descricao: `Item mestre editado: ${item.name}`, detalhes: data as Record<string, unknown> })
    return NextResponse.json(item)
  } catch (error) {
    console.error('Erro ao editar item do catálogo:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE - INATIVAÇÃO do item mestre. A exclusão física vive SÓ no motor canônico, atrás de
// sistema.exclusaoDefinitiva (/catalogo-mestre/[id]/exclusao-definitiva). Contar vínculo de
// CONFIGURAÇÃO como impedimento era exatamente o defeito que travava a exclusão.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { usuario, erro } = await exigirPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    const { id } = await params
    const itemId = parseInt(id)
    const existe = await prisma.itemCatalogo.findUnique({ where: { id: itemId }, select: { id: true } })
    if (!existe) return NextResponse.json({ error: 'Item não encontrado.' }, { status: 404 })

    const body = await request.json().catch(() => ({} as Record<string, unknown>))
    // A auditoria da inativação é gravada pelo próprio motor canônico (com correlationId).
    const r = await deactivateItemCatalogo(itemId, { usuarioId: usuario.userId, motivo: typeof body?.motivo === 'string' ? body.motivo : null })
    return NextResponse.json({
      ok: true,
      ...r,
      motivo: 'O item foi inativado; nada do histórico foi apagado. A exclusão definitiva é restrita a administradores.',
    })
  } catch (error) {
    console.error('Erro ao inativar item do catálogo:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}