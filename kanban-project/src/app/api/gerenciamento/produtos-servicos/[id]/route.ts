import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { sincronizarItemDeServico } from '@/src/services/catalogo-sync'
import { garantirConfigFinanceiraDeItem, refletirEstadoNaConfigDeServico } from '@/src/services/config-financeira-auto'
import { resolverAplicacaoTerritorial, gravarAplicacaoTerritorial, selecaoDoRegistro } from '@/src/services/aplicacao-territorial-servico'
import { resolverCategoriaServico } from '@/src/services/categoria-servico-ref'

function toStrOrNull(v: any): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
// PUT - Atualizar serviço
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.servicoProduto.findUnique({
      where: { id },
      include: {
        paises: { select: { paisId: true }, orderBy: { criadoEm: 'asc' } },
        itemCatalogo: { select: { categoriaId: true } },
      },
    })
    if (!atual) return NextResponse.json({ error: 'Serviço não encontrado' }, { status: 404 })

    const b = await request.json()

    // CATEGORIA — só id oficial. PUT que não declara categoria preserva a atual.
    const categoria = await resolverCategoriaServico(b)
    if (categoria.erros.length) {
      return NextResponse.json({ error: categoria.erros[0].mensagem, erros: categoria.erros }, { status: 400 })
    }
    const categoriaId = categoria.declarado ? categoria.categoriaId : (atual.itemCatalogo?.categoriaId ?? null)

    // APLICAÇÃO TERRITORIAL — PUT PARCIAL: body que não declara território não
    // mexe nos vínculos (editar o nome jamais apaga a seleção de países).
    const territorio = await resolverAplicacaoTerritorial(b)
    if (territorio.erros.length) {
      return NextResponse.json({ error: territorio.erros[0].mensagem, erros: territorio.erros }, { status: 400 })
    }
    const selecao = territorio.declarado ? territorio.selecao : selecaoDoRegistro(atual)

    const data: any = {
      // Chave técnica interna é IMUTÁVEL e nunca vem do cliente: sempre preserva a atual.
      code: atual.code,
      name: b.name !== undefined ? String(b.name).trim() : atual.name,
      descricao: b.descricao !== undefined ? toStrOrNull(b.descricao) : atual.descricao,
      unidadePadrao: b.unidadePadrao !== undefined ? (b.unidadePadrao || null) : atual.unidadePadrao,
      aplicacaoGlobal: selecao.global,
      ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
    }

    // dual-write: re-sincroniza o ItemCatalogo (mestre) com os valores efetivos.
    // Renomeia o item JÁ vinculado no lugar (preserva itemCatalogoId dos consumidores,
    // ex.: Configuração Financeira) — editar o CÓDIGO do serviço não quebra o vínculo.
    const servico = await prisma.$transaction(async (tx) => {
      const itemCatalogoId = await sincronizarItemDeServico(tx, { code: data.code, name: data.name, categoriaId }, atual.itemCatalogoId)
      const s = await tx.servicoProduto.update({
        where: { id },
        data: { ...data, itemCatalogoId },
      })
      await gravarAplicacaoTerritorial(tx, id, selecao)
      // Renomear NÃO cria nova config (mesmo itemCatalogoId → mesmo vínculo). Self-heal:
      // garante a config se faltar (legado); reflete nome/ativo sem apagar preços/histórico.
      await garantirConfigFinanceiraDeItem(tx, { itemCatalogoId, nome: data.name })
      await refletirEstadoNaConfigDeServico(tx, { itemCatalogoId, nome: data.name, ativo: data.ativo })
      return s
    })

    return NextResponse.json({ servico })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'Já existe um serviço com esse código.' }, { status: 409 })
    }
    console.error('Erro ao atualizar produto/serviço:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE - Excluir serviço (os vínculos M2M somem junto)
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    const svc = await prisma.servicoProduto.findUnique({ where: { id }, select: { itemCatalogoId: true } })
    if (!svc) return NextResponse.json({ error: 'Serviço não encontrado' }, { status: 404 })

    // NÃO apaga se houver Config Financeira / preços / automações ligados ao item (órfãos +
    // perda de histórico financeiro). Preserva: inativa o serviço e sua config.
    if (svc.itemCatalogoId != null) {
      const config = await prisma.produtoFinanceiro.findUnique({ where: { itemCatalogoId: svc.itemCatalogoId }, select: { id: true } })
      const [precos, autos] = await Promise.all([
        prisma.tabelaValor.count({ where: { itemCatalogoId: svc.itemCatalogoId, arquivado: false } }),
        config ? prisma.phaseAutomationRule.count({ where: { arquivado: false, configItemId: config.id } }) : Promise.resolve(0),
      ])
      if (config || precos > 0 || autos > 0) {
        await prisma.$transaction([
          prisma.servicoProduto.update({ where: { id }, data: { ativo: false } }),
          ...(config ? [prisma.produtoFinanceiro.update({ where: { id: config.id }, data: { ativo: false } })] : []),
        ])
        return NextResponse.json({ ok: true, inativado: true, motivo: 'Serviço tem Configuração Financeira/preços/automações — foi inativado (não excluído) para preservar o histórico financeiro.' })
      }
    }
    await prisma.servicoProduto.delete({ where: { id } })

    return NextResponse.json({ ok: true, excluido: true })
  } catch (error) {
    console.error('Erro ao excluir produto/serviço:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}