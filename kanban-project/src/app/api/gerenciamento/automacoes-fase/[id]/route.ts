import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { aplicacaoValida, aplicacaoPermitida } from '@/lib/financeiro/aplicacao-financeira'

// PUT — edita a regra (campos do editor) / toggle active / arquivar
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const { id: idStr } = await params
    const id = Number(idStr)
    const body = await request.json()

    const atual = await prisma.phaseAutomationRule.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Automação não encontrada.' }, { status: 404 })

    // ARQUITETURA NOVA — automação não avança fase NEM cria trabalho obrigatório.
    // Bloqueado: kind phase_advance/phase_transition (avanço = PhaseAdvanceService)
    // e task/document (tarefa/documento obrigatório = Workflow Interno).
    // (1) não pode mudar o kind para nenhum desses;
    // (2) regra legada desses kinds é somente-leitura/arquivável: só se permite
    //     arquivar/desativar, nunca reativar como executável.
    const MSG_AVANCO = 'Automações não avançam fase. O avanço é exclusivo do PhaseAdvanceService (Workflow Interno + Workflow Macro). Regras legadas permanecem apenas para histórico.'
    const MSG_TRABALHO = 'Automações não criam tarefas/documentos obrigatórios da fase — isso é exclusivo do Workflow Interno. Regras legadas permanecem apenas para histórico.'
    const kindProibido = (k?: string) => k === 'phase_advance' || k === 'phase_transition' || k === 'task' || k === 'document'
    const msgDe = (k?: string) => (k === 'task' || k === 'document' ? MSG_TRABALHO : MSG_AVANCO)
    const novoKind = body.kind !== undefined ? String(body.kind) : atual.kind
    if (kindProibido(novoKind)) {
      return NextResponse.json({ error: msgDe(novoKind), code: 'AUTOMACAO_PROIBIDA' }, { status: 422 })
    }
    if (kindProibido(atual.kind)) {
      // Só se permite arquivar/desativar uma regra legada desses kinds.
      const querReativar = body.active === true || body.arquivado === false
      if (querReativar) {
        return NextResponse.json({ error: msgDe(atual.kind), code: 'AUTOMACAO_LEGADA' }, { status: 422 })
      }
    }

    // FLUXO NOVO/MIGRAÇÃO — vínculo estrutural à Configuração Financeira + direção.
    // Regra financeira NUNCA aceita valor/moeda/item/tipo (vêm da Tabela de Preços).
    const ehFinanceira = novoKind === 'financial'
    const querVinculo = body.configItemId !== undefined || body.aplicacaoFinanceira !== undefined
    const pBody = (body.params ?? {}) as Record<string, unknown>
    const temMoedaValorLegado = pBody.amount != null || !!pBody.currency || !!pBody.financialItemCode || !!body.financialType
    if (ehFinanceira && temMoedaValorLegado) {
      return NextResponse.json({ error: 'Regra financeira não aceita valor, moeda, item por código ou tipo financeiro — vêm da Configuração Financeira e da Tabela de Preços.' }, { status: 400 })
    }
    let vinculoData: { configItemId?: number; aplicacaoFinanceira?: string; params?: Prisma.InputJsonValue; financialType?: null } | null = null
    // Toda regra financeira (nova, editada OU que VIRE financeira) precisa validar
    // config + aplicação + PREÇO na Tabela. Sem isto, um PUT trocando kind→financial
    // sem configItemId passava batido (bypass da trava SEM_PRECO).
    if (ehFinanceira) {
      const configItemId = body.configItemId ? Number(body.configItemId) : (atual.configItemId ?? null)
      const aplicacao = body.aplicacaoFinanceira ? String(body.aplicacaoFinanceira).toUpperCase() : atual.aplicacaoFinanceira
      if (!configItemId) return NextResponse.json({ error: 'Selecione a Configuração Financeira.' }, { status: 400 })
      if (!aplicacaoValida(aplicacao)) return NextResponse.json({ error: 'Selecione a Aplicação financeira (Receita, Custo ou Ambos).' }, { status: 400 })
      const cfg = await prisma.produtoFinanceiro.findUnique({ where: { id: configItemId }, select: { possuiCusto: true, possuiReceita: true } })
      if (!cfg) return NextResponse.json({ error: 'Configuração Financeira não encontrada.' }, { status: 404 })
      if (!aplicacaoPermitida(aplicacao, cfg)) return NextResponse.json({ error: `A Configuração Financeira não permite "${aplicacao}".` }, { status: 400 })
      // VÍNCULO = TABELA DE PREÇOS: sem preço cadastrado, não deixa salvar.
      const precos = await prisma.tabelaValor.findMany({ where: { configuracaoFinanceiraItemId: configItemId, arquivado: false, legadoPendente: false }, select: { natureza: true } })
      const temVenda = precos.some((x) => x.natureza === 'VENDA' || x.natureza === 'RECEITA')
      const temCusto = precos.some((x) => x.natureza === 'CUSTO')
      if ((aplicacao === 'RECEITA' || aplicacao === 'AMBOS') && !temVenda) return NextResponse.json({ error: 'A Configuração Financeira não tem preço de VENDA na Tabela de Preços. Cadastre o preço antes.', code: 'SEM_PRECO' }, { status: 400 })
      if ((aplicacao === 'CUSTO' || aplicacao === 'AMBOS') && !temCusto) return NextResponse.json({ error: 'A Configuração Financeira não tem preço de CUSTO na Tabela de Preços. Cadastre o preço antes.', code: 'SEM_PRECO' }, { status: 400 })
      vinculoData = { configItemId, aplicacaoFinanceira: aplicacao, params: {}, financialType: null }
    }

    const data: Prisma.PhaseAutomationRuleUpdateInput = {}
    // FINANCEIRO: identidade estruturada — name/description NÃO são editáveis nem persistidos
    // (título/descrição derivados). Regras antigas mantêm o texto legado só p/ auditoria.
    if (!ehFinanceira) {
      if (body.name !== undefined) data.name = String(body.name)
      if (body.description !== undefined) data.description = body.description ? String(body.description) : null
    }
    if (body.kind !== undefined) data.kind = String(body.kind)
    if (body.scope !== undefined) data.scope = String(body.scope)
    if (body.trigger !== undefined) data.trigger = String(body.trigger)
    if (body.action !== undefined) data.action = body.action ? String(body.action) : null
    if (body.conditions !== undefined) data.conditions = (body.conditions ?? undefined) as Prisma.InputJsonValue
    if (body.params !== undefined) data.params = (body.params ?? {}) as Prisma.InputJsonValue
    if (body.financialType !== undefined) data.financialType = body.financialType ? String(body.financialType) : null
    if (body.idempotent !== undefined) data.idempotent = !!body.idempotent
    if (body.active !== undefined) data.active = !!body.active
    if (body.arquivado !== undefined) data.arquivado = !!body.arquivado
    // Vínculo estrutural (fluxo novo) sobrescreve params/financialType legados.
    if (vinculoData) { data.configItemId = vinculoData.configItemId; data.aplicacaoFinanceira = vinculoData.aplicacaoFinanceira; data.params = vinculoData.params; data.financialType = null }

    const rule = await prisma.phaseAutomationRule.update({ where: { id }, data })
    return NextResponse.json({ rule })
  } catch (e) {
    console.error('PUT automacoes-fase/[id]', e)
    return NextResponse.json({ error: 'Erro ao salvar a automação.' }, { status: 500 })
  }
}

// DELETE — guarda: se já foi executada (runCount>0) não exclui; oriente arquivar
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const { id: idStr } = await params
    const id = Number(idStr)

    const atual = await prisma.phaseAutomationRule.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Automação não encontrada.' }, { status: 404 })

    if ((atual.runCount || 0) > 0) {
      return NextResponse.json({ error: 'Esta automação já foi executada. Use Arquivar em vez de excluir.', blocked: true }, { status: 409 })
    }

    await prisma.phaseAutomationRule.delete({ where: { id } })

    // devolve o contador de uso ao modelo 2C (se veio de um)
    if (atual.templateId) {
      const modelo = await prisma.modeloAutomacao.findUnique({ where: { id: atual.templateId } })
      if (modelo && modelo.usedByCount > 0) {
        await prisma.modeloAutomacao.update({ where: { id: atual.templateId }, data: { usedByCount: { decrement: 1 } } })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE automacoes-fase/[id]', e)
    return NextResponse.json({ error: 'Erro ao excluir a automação.' }, { status: 500 })
  }
}