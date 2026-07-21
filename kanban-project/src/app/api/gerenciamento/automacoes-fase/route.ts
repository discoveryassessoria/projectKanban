import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { aplicacaoValida, aplicacaoPermitida } from '@/lib/financeiro/aplicacao-financeira'

function amtTypeToKind(t?: string) { return t === 'phase_transition' ? 'phase_advance' : (t || 'task') }

// VÍNCULO = TABELA DE PREÇOS. Só é selecionável a Configuração Financeira que TEM preço
// cadastrado (VENDA e/ou CUSTO). Sem preço → não pode virar automação. temVenda/temCusto
// indicam quais Aplicações são possíveis; configs sem nenhum preço saem da lista.
async function listarConfigsFinanceiras() {
  const [cfgs, precos] = await Promise.all([
    prisma.produtoFinanceiro.findMany({
      where: { ativo: true },
      select: {
        id: true, codigo: true, possuiCusto: true, possuiReceita: true,
        tipoDocumento: { select: { name: true } }, honorario: { select: { name: true } },
        tipoProcesso: { select: { name: true } }, itemCatalogo: { select: { name: true, natureza: true } },
      },
      orderBy: { id: 'asc' },
    }),
    prisma.tabelaValor.findMany({ where: { arquivado: false, legadoPendente: false, configuracaoFinanceiraItemId: { not: null } }, select: { configuracaoFinanceiraItemId: true, natureza: true } }),
  ])
  const venda = new Set<number>(), custo = new Set<number>()
  for (const p of precos) {
    if (p.configuracaoFinanceiraItemId == null) continue
    if (p.natureza === 'VENDA' || p.natureza === 'RECEITA') venda.add(p.configuracaoFinanceiraItemId)
    else if (p.natureza === 'CUSTO') custo.add(p.configuracaoFinanceiraItemId)
  }
  return cfgs.map((c) => {
    const origem = c.tipoDocumento ? 'documento' : c.honorario ? 'honorario' : c.tipoProcesso ? 'processo' : (c.itemCatalogo?.natureza === 'SERVICO' ? 'servico' : 'item')
    const mestre = c.tipoDocumento?.name ?? c.honorario?.name ?? c.tipoProcesso?.name ?? c.itemCatalogo?.name ?? '—'
    return { id: c.id, codigo: c.codigo, origem, mestre, label: mestre, possuiCusto: c.possuiCusto, possuiReceita: c.possuiReceita, temVenda: venda.has(c.id), temCusto: custo.has(c.id) }
  }).filter((c) => c.temVenda || c.temCusto) // só configs COM preço na Tabela de Preços
}

// Valida que a Config tem preço para a Aplicação escolhida (RECEITA→VENDA, CUSTO→CUSTO,
// AMBOS→ambos). Retorna a mensagem de erro, ou null quando ok.
async function faltaPrecoParaAplicacao(configId: number, aplicacao: string): Promise<string | null> {
  const precos = await prisma.tabelaValor.findMany({ where: { configuracaoFinanceiraItemId: configId, arquivado: false, legadoPendente: false }, select: { natureza: true } })
  const temVenda = precos.some((p) => p.natureza === 'VENDA' || p.natureza === 'RECEITA')
  const temCusto = precos.some((p) => p.natureza === 'CUSTO')
  const precisaVenda = aplicacao === 'RECEITA' || aplicacao === 'AMBOS'
  const precisaCusto = aplicacao === 'CUSTO' || aplicacao === 'AMBOS'
  if (precisaVenda && !temVenda) return 'A Configuração Financeira não tem preço de VENDA na Tabela de Preços. Cadastre o preço antes de criar a automação de Receita.'
  if (precisaCusto && !temCusto) return 'A Configuração Financeira não tem preço de CUSTO na Tabela de Preços. Cadastre o preço antes de criar a automação de Custo.'
  return null
}

// ARQUITETURA NOVA — automações só descrevem EFEITOS ADICIONAIS. PROIBIDO:
//  - 'phase_advance'/'phase_transition' → avanço é exclusivo do PhaseAdvanceService;
//  - 'task'/'document' → trabalho OBRIGATÓRIO da fase (criar tarefa/documento) é
//    exclusivo do Workflow Interno de cada Fase Macro.
// Permitidos = efeitos adicionais (financeiro, evento, protocolo, notificação).
// Registros legados permanecem legíveis, mas não podem ser criados/reativados.
const KINDS_EFEITO_PERMITIDOS = new Set(['financial', 'event', 'protocol', 'alert'])
const MSG_PHASE_ADVANCE_PROIBIDO =
  'Automações não avançam fase. O avanço é controlado pelo Workflow Interno (conclusão) + Workflow Macro (ordem) via PhaseAdvanceService.'
const MSG_TRABALHO_OBRIGATORIO_PROIBIDO =
  'Automações não criam tarefas nem documentos obrigatórios da fase. Isso é responsabilidade exclusiva do Workflow Interno da Fase Macro. Automações só configuram efeitos adicionais (financeiro, evento, protocolo, notificação).'
function kindDeAvanco(kind?: string) { return kind === 'phase_advance' || kind === 'phase_transition' }
function kindDeTrabalhoObrigatorio(kind?: string) { return kind === 'task' || kind === 'document' }
function msgProibido(kind?: string) { return kindDeTrabalhoObrigatorio(kind) ? MSG_TRABALHO_OBRIGATORIO_PROIBIDO : MSG_PHASE_ADVANCE_PROIBIDO }

// GET — dados da tela: processos+fases, regras aplicadas, biblioteca 2C
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const [tipos, regras, configs] = await Promise.all([
      prisma.tipoProcessoNacionalidade.findMany({
        where: { arquivado: false },
        include: { macroWorkflow: { include: { fases: { orderBy: { ordem: 'asc' } } } } },
        orderBy: { name: 'asc' },
      }),
      prisma.phaseAutomationRule.findMany({
        orderBy: { criadoEm: 'asc' },
      }),
      listarConfigsFinanceiras(),
    ])

    const tiposProcesso = tipos.map((t) => ({
      id: t.id,
      name: t.name,
      fases: (t.macroWorkflow?.fases || []).map((f) => ({
        phaseKey: f.phaseKey, label: f.label, order: f.ordem,
      })),
    }))

    return NextResponse.json({ tiposProcesso, regras, configsFinanceiras: configs })
  } catch (e) {
    console.error('GET automacoes-fase', e)
    return NextResponse.json({ error: 'Erro ao carregar automações das fases.' }, { status: 500 })
  }
}

// POST — criar regra de automação ad-hoc (editor). Aplicação de MODELO (biblioteca) removida.
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const body = await request.json()


    // ---------- CRIAR REGRA AD-HOC (editor) ----------
    const tipoProcessoId = Number(body.tipoProcessoId)
    const phaseKey = String(body.phaseKey || '')
    const kind = String(body.kind || 'task')
    // FINANCEIRO: identidade 100% ESTRUTURADA — name/description NÃO são aceitos nem
    // persistidos (título/descrição derivados da regra). Demais tipos ainda usam nome.
    const ehFinanceira = kind === 'financial'
    const name = ehFinanceira ? null : String(body.name || '').trim()
    if (!tipoProcessoId || !phaseKey) return NextResponse.json({ error: 'Selecione o processo e a fase.' }, { status: 400 })
    if (!ehFinanceira && !name) return NextResponse.json({ error: 'Dê um nome à automação.' }, { status: 400 })
    if (kindDeAvanco(kind) || kindDeTrabalhoObrigatorio(kind) || !KINDS_EFEITO_PERMITIDOS.has(kind)) {
      return NextResponse.json({ error: msgProibido(kind), code: 'AUTOMACAO_PROIBIDA' }, { status: 422 })
    }

    // FLUXO NOVO OBRIGATÓRIO para regras financeiras: vínculo estrutural + direção.
    // A automação NÃO guarda preço/moeda/item — vem da Config Financeira + Tabela de Preços.
    let configItemId: number | null = null
    let aplicacaoFinanceira: string | null = null
    if (kind === 'financial') {
      configItemId = body.configItemId ? Number(body.configItemId) : null
      aplicacaoFinanceira = body.aplicacaoFinanceira ? String(body.aplicacaoFinanceira).toUpperCase() : null
      if (!configItemId) return NextResponse.json({ error: 'Selecione a Configuração Financeira (Categoria + Item).' }, { status: 400 })
      if (!aplicacaoValida(aplicacaoFinanceira)) return NextResponse.json({ error: 'Selecione a Aplicação financeira (Receita, Custo ou Ambos).' }, { status: 400 })
      const p = (body.params ?? {}) as Record<string, unknown>
      if (p.amount != null || p.currency || p.financialItemCode || body.financialType) {
        return NextResponse.json({ error: 'Regra financeira nova não aceita valor, moeda, item por código ou tipo financeiro — esses dados vêm da Configuração Financeira e da Tabela de Preços.' }, { status: 400 })
      }
      const cfg = await prisma.produtoFinanceiro.findUnique({ where: { id: configItemId }, select: { possuiCusto: true, possuiReceita: true } })
      if (!cfg) return NextResponse.json({ error: 'Configuração Financeira não encontrada.' }, { status: 404 })
      if (!aplicacaoPermitida(aplicacaoFinanceira as 'RECEITA' | 'CUSTO' | 'AMBOS', cfg)) {
        return NextResponse.json({ error: `A Configuração Financeira selecionada não permite "${aplicacaoFinanceira}".` }, { status: 400 })
      }
      // VÍNCULO = TABELA DE PREÇOS: sem preço cadastrado, NÃO deixa criar a automação.
      const semPreco = await faltaPrecoParaAplicacao(configItemId, aplicacaoFinanceira!)
      if (semPreco) return NextResponse.json({ error: semPreco, code: 'SEM_PRECO' }, { status: 400 })
    }

    const rule = await prisma.phaseAutomationRule.create({
      data: {
        tipoProcessoId, phaseKey, kind, name,
        // Financeiro: descrição também é derivada — nunca persistida.
        description: ehFinanceira ? null : (body.description ? String(body.description) : null),
        scope: body.scope || 'phase',
        trigger: body.trigger || 'phase_entered',
        action: body.action ? String(body.action) : null,
        conditions: (body.conditions ?? undefined) as Prisma.InputJsonValue | undefined,
        // Regra financeira nova: params/financialType ficam VAZIOS (sem valor/moeda/código).
        params: (kind === 'financial' ? {} : (body.params ?? {})) as Prisma.InputJsonValue,
        financialType: null,
        configItemId,
        aplicacaoFinanceira,
        idempotent: body.idempotent !== false,
        active: body.active !== false,
      },
    })
    return NextResponse.json({ rule }, { status: 201 })
  } catch (e) {
    console.error('POST automacoes-fase', e)
    return NextResponse.json({ error: 'Erro ao processar a ação.' }, { status: 500 })
  }
}