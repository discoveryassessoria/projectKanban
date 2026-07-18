// src/app/api/gerenciamento/produtos/[id]/route.ts
// PUT    - Atualizar produto financeiro
// DELETE - Excluir produto financeiro
//
// ✅ Next 15: params é Promise → await params.
// DELETE: hard-delete quando a config não tem NENHUMA referência (preço, regra
// econômica, automação de fase, vínculo de serviço); caso contrário arquiva (R19).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const MOEDAS = ['BRL', 'EUR', 'USD']
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
function parseDecimal(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// PUT - Atualizar
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idParam } = await params
    const id = Number(idParam)
    if (!id || Number.isNaN(id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const atual = await prisma.produtoFinanceiro.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 })
    }

    const b = await request.json()

    if (b.moedaPadrao !== undefined && b.moedaPadrao && !MOEDAS.includes(b.moedaPadrao)) {
      return NextResponse.json({ error: 'Moeda inválida' }, { status: 400 })
    }

    // Nome e código de negócio pertencem ao MESTRE — a config nunca os edita.
    // Mantém os campos técnicos internos como estão (identidade estável); a exibição
    // resolve nome/código do mestre por relação. Cliente não pode reescrevê-los.
    const codigo = atual.codigo
    const nome = atual.nome
    // R20 — a entidade mestre é IMUTÁVEL na edição: rejeita troca silenciosa de
    // Documento↔Serviço↔Processo↔Honorário (trocar origem = novo registro).
    // (Papel não é mais atributo da config: custo/receita são valores editáveis abaixo.)
    const trocaMestre =
      (b.tipoDocumentoId !== undefined && (b.tipoDocumentoId ? Number(b.tipoDocumentoId) : null) !== atual.tipoDocumentoId) ||
      (b.honorarioId !== undefined && (b.honorarioId ? Number(b.honorarioId) : null) !== atual.honorarioId) ||
      (b.tipoProcessoId !== undefined && (b.tipoProcessoId ? Number(b.tipoProcessoId) : null) !== atual.tipoProcessoId) ||
      (b.itemCatalogoId !== undefined && (b.itemCatalogoId ? Number(b.itemCatalogoId) : null) !== atual.itemCatalogoId)
    if (trocaMestre) {
      return NextResponse.json({ error: 'Não é permitido trocar a entidade mestre de uma configuração existente. Crie uma nova configuração e inative esta.' }, { status: 400 })
    }
    // PREÇO-FONTE-ÚNICA — Natureza Financeira é a fonte estrutural do "o QUE o item
    // gera". Quando enviada, deriva possuiCusto/possuiReceita. Valores (preço) NÃO
    // são mais editados aqui: se o corpo os omitir, os campos legado são preservados.
    const natFinReq = typeof b.naturezaFin === 'string' && ['SOMENTE_CUSTO', 'SOMENTE_RECEITA', 'CUSTO_E_RECEITA'].includes(b.naturezaFin) ? b.naturezaFin : undefined
    const possuiCustoFinal = natFinReq ? natFinReq !== 'SOMENTE_RECEITA' : (b.possuiCusto !== undefined ? !!b.possuiCusto : atual.possuiCusto)
    const possuiReceitaFinal = natFinReq ? natFinReq !== 'SOMENTE_CUSTO' : (b.possuiReceita !== undefined ? !!b.possuiReceita : atual.possuiReceita)
    const produto = await prisma.$transaction(async (tx) => {
      // Nome/código do mestre NÃO são editados aqui (pertencem ao cadastro mestre).
      // O ItemCatalogo é rotulado pela tela do próprio mestre (Serviços/Documentos).
      return tx.produtoFinanceiro.update({
        where: { id },
        data: {
          codigo,
          nome,
          especie: b.especie !== undefined ? s(b.especie) : atual.especie,
          tipoFinanceiro: b.tipoFinanceiro !== undefined ? s(b.tipoFinanceiro) : atual.tipoFinanceiro,
          categoriaId: b.categoriaId !== undefined ? (b.categoriaId ? Number(b.categoriaId) : null) : atual.categoriaId,
          planoContaId: b.planoContaId !== undefined ? (b.planoContaId ? Number(b.planoContaId) : null) : atual.planoContaId,
          moedaPadrao: b.moedaPadrao !== undefined ? (b.moedaPadrao || 'BRL') : atual.moedaPadrao,
          valorPadrao: b.valorPadrao !== undefined ? parseDecimal(b.valorPadrao) : atual.valorPadrao,
          aplicaA: b.aplicaA !== undefined ? s(b.aplicaA) : atual.aplicaA,
          cobravelDoCliente: b.cobravelDoCliente !== undefined ? !!b.cobravelDoCliente : atual.cobravelDoCliente,
          ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
          naturezaFinanceira: b.naturezaFinanceira !== undefined ? (b.naturezaFinanceira || 'revenue') : atual.naturezaFinanceira,
          custoInterno: b.custoInterno !== undefined ? !!b.custoInterno : atual.custoInterno,
          repasse: b.repasse !== undefined ? !!b.repasse : atual.repasse,
          reembolsavel: b.reembolsavel !== undefined ? !!b.reembolsavel : atual.reembolsavel,
          // PREÇO-FONTE-ÚNICA — natureza estrutural; flags derivam dela quando enviada.
          naturezaFin: natFinReq !== undefined ? (natFinReq as never) : atual.naturezaFin,
          possuiCusto: possuiCustoFinal,
          possuiReceita: possuiReceitaFinal,
          // Valores (preço) viraram LEGADO → Tabela de Preços. Preservados se omitidos.
          valorCustoPadrao: b.valorCustoPadrao !== undefined ? parseDecimal(b.valorCustoPadrao) : atual.valorCustoPadrao,
          valorReceitaPadrao: b.valorReceitaPadrao !== undefined ? parseDecimal(b.valorReceitaPadrao) : atual.valorReceitaPadrao,
          // itemCatalogoId (pivô/mestre) NÃO é alterado na edição — R20.
        },
      })
    })

    return NextResponse.json({ produto })
  } catch (error) {
    console.error('Erro ao atualizar produto:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE - Excluir
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idParam } = await params
    const id = Number(idParam)
    if (!id || Number.isNaN(id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    // Conta TODAS as referências reais à config antes de decidir apagar.
    const atual = await prisma.produtoFinanceiro.findUnique({
      where: { id },
      select: {
        id: true,
        _count: {
          select: {
            precosConfig: true,      // TabelaValor (preços) — @relation("PrecoConfig")
            econRulesCusto: true,    // PhaseEconomicRule (custo) — @relation("EconCustoConfig")
            econRulesReceita: true,  // PhaseEconomicRule (receita) — @relation("EconReceitaConfig")
            triggerRules: true,      // PhaseTriggerRule — @relation("TriggerConfig")
            servicos: true,          // ServicoProduto (m2n) — @relation("ServicoProdutoItens")
          },
        },
      },
    })
    if (!atual) {
      return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 })
    }

    const c = atual._count
    const vinculos: string[] = []
    if (c.precosConfig > 0) vinculos.push(`${c.precosConfig} preço(s)`)
    if (c.econRulesCusto + c.econRulesReceita > 0) vinculos.push(`${c.econRulesCusto + c.econRulesReceita} regra(s) de aplicabilidade econômica`)
    if (c.triggerRules > 0) vinculos.push(`${c.triggerRules} regra(s) de automação de fase`)
    if (c.servicos > 0) vinculos.push(`${c.servicos} vínculo(s) de serviço`)

    // Sem NENHUM uso/histórico → exclusão física de verdade.
    if (vinculos.length === 0) {
      await prisma.produtoFinanceiro.delete({ where: { id } })
      return NextResponse.json({ ok: true, excluido: true })
    }

    // R19 — com uso/histórico: arquiva (não apaga) pra preservar histórico e evitar
    // órfãos por SetNull. Informa o que precisa ser desvinculado para excluir de vez.
    await prisma.produtoFinanceiro.update({ where: { id }, data: { ativo: false } })
    return NextResponse.json({
      ok: true,
      inativado: true,
      motivo: `Esta configuração tem ${vinculos.join(', ')} vinculado(s), então foi inativada (não excluída) para preservar histórico. Remova esses vínculos para excluí-la definitivamente.`,
    })
  } catch (error) {
    console.error('Erro ao excluir produto:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}