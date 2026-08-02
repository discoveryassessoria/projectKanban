// lib/saude/verificacoes/tesouraria.ts
//
// TESOURARIA, CÂMBIO, CONTAS A PAGAR/RECEBER, AUTOMAÇÕES E EVENTOS DE AGENDA.

import { prisma } from '@/lib/prisma'
import { registrar } from '../catalogo'
import type { Achado, ResultadoVerificacao } from '../tipos'

const ROTA_CONTAS = '/administrator?screen=accounts'
const ROTA_CAMBIO = '/cambio'
const ROTA_AUTO = '/administrator?screen=autofin'

registrar({
  id: 'saude.tesouraria.sem-conta-ativa',
  codigo: 'TES-001',
  nome: 'Existe conta bancária ativa',
  descricao: 'Sem conta bancária ativa não há onde registrar recebimento nem pagamento.',
  dominio: 'TESOURARIA',
  modulo: 'Tesouraria',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 10_000,
  orientacao: 'Cadastre ao menos uma conta bancária ativa em Financeiro › Tesouraria.',
  rotaCorrecao: ROTA_CONTAS,
  responsavel: 'Financeiro',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const ativas = await prisma.contaBancaria.count({ where: { ativo: true } })
    if (ativas > 0) return { achados: [], metricas: { contasAtivas: ativas }, resumo: `${ativas} conta(s) bancária(s) ativa(s).` }
    return {
      achados: [{
        chave: 'sem-conta-bancaria-ativa',
        severidade: 'ERRO',
        titulo: 'Nenhuma conta bancária ativa',
        descricao: 'Não há conta bancária ativa cadastrada.',
        explicacao: 'Todo recebimento e pagamento precisa de uma conta de destino/origem.',
        impacto: 'O registro de pagamento e recebimento fica sem onde ser lançado.',
        entidade: 'ContaBancaria',
        quantidade: 0,
        link: ROTA_CONTAS,
        recomendacao: 'Cadastre a conta bancária operacional.',
        evidencia: { contasAtivas: 0 },
      }],
      metricas: { contasAtivas: 0 },
    }
  },
})

registrar({
  id: 'saude.cambio.cotacao-vigente',
  codigo: 'FX-001',
  nome: 'Câmbio com cotação recente',
  descricao: 'Cotação desatualizada faz o valor em BRL sair errado — e ninguém percebe na hora.',
  dominio: 'CAMBIO',
  modulo: 'Moedas e Câmbio',
  severidadePadrao: 'ALERTA',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 15_000,
  orientacao: 'Verifique o job diário de câmbio; se a fonte está indisponível, registre cotação manual.',
  rotaCorrecao: ROTA_CAMBIO,
  responsavel: 'Financeiro',
  ativo: true,
  executar: async ({ agora }): Promise<ResultadoVerificacao> => {
    const ultima = await prisma.cotacaoCambio.findFirst({
      where: { ativo: true },
      orderBy: [{ dataReferencia: 'desc' }, { data: 'desc' }],
      select: { dataReferencia: true, data: true, statusIntegracao: true, origem: true },
    })
    if (!ultima) {
      return {
        achados: [{
          chave: 'cambio-sem-cotacao',
          severidade: 'ERRO',
          titulo: 'Nenhuma cotação de câmbio cadastrada',
          descricao: 'Não existe cotação ativa para converter moeda estrangeira.',
          explicacao: 'Receitas e custos em EUR/USD dependem da cotação para virar BRL.',
          impacto: 'Conversões ficam sem base e o valor em BRL não pode ser calculado.',
          entidade: 'CotacaoCambio',
          quantidade: 0,
          link: ROTA_CAMBIO,
          recomendacao: 'Rode o job de câmbio ou registre a cotação manualmente.',
          evidencia: { cotacoes: 0 },
        }],
        metricas: { diasDesdeCotacao: -1 },
      }
    }
    const ref = ultima.dataReferencia ?? ultima.data
    const dias = ref ? Math.floor((agora.getTime() - ref.getTime()) / 86_400_000) : 999
    const achados: Achado[] = []
    if (dias > 3) {
      achados.push({
        chave: 'cambio-desatualizado',
        severidade: dias > 10 ? 'ERRO' : 'ALERTA',
        titulo: `Cotação de câmbio com ${dias} dias`,
        descricao: `A cotação mais recente é de ${dias} dias atrás (status: ${ultima.statusIntegracao ?? '—'}).`,
        explicacao: 'A conversão usa a cotação vigente; quanto mais velha, maior o desvio do valor real.',
        impacto: 'Valores em BRL saem defasados em cobranças e relatórios.',
        entidade: 'CotacaoCambio',
        quantidade: 1,
        link: ROTA_CAMBIO,
        recomendacao: 'Verifique a integração de câmbio ou registre cotação manual.',
        evidencia: { diasDesdeCotacao: dias, status: ultima.statusIntegracao, origem: ultima.origem },
      })
    }
    return { achados, metricas: { diasDesdeCotacao: dias }, resumo: `Cotação de ${dias} dia(s) atrás.` }
  },
})

registrar({
  id: 'saude.contas.pagar-vencidas',
  codigo: 'CAP-001',
  nome: 'Contas a pagar sem vencimento estourado',
  descricao: 'Conta vencida e não paga é obrigação em atraso — com risco de multa e de bloqueio junto ao fornecedor.',
  dominio: 'CONTAS_PAGAR',
  modulo: 'Financeiro / Contas a pagar',
  severidadePadrao: 'ALERTA',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 15_000,
  orientacao: 'Pague, renegocie ou cancele as contas vencidas.',
  rotaCorrecao: '/financas/contas-pagar',
  responsavel: 'Financeiro',
  ativo: true,
  executar: async ({ agora }): Promise<ResultadoVerificacao> => {
    const vencidas = await prisma.contaPagar.count({
      where: { status: { in: ['PENDENTE', 'VENCIDO', 'AGENDADO'] }, dataVencimento: { lt: agora } },
    })
    if (!vencidas) return { achados: [], metricas: { vencidas: 0 }, resumo: 'Nenhuma conta a pagar vencida em aberto.' }
    return {
      achados: [{
        chave: 'contas-pagar-vencidas',
        severidade: vencidas >= 10 ? 'ERRO' : 'ALERTA',
        titulo: `${vencidas} conta(s) a pagar vencida(s)`,
        descricao: `${vencidas} obrigação(ões) passaram do vencimento e continuam em aberto.`,
        explicacao: 'Conta vencida gera encargo e pode interromper o serviço do fornecedor.',
        impacto: 'Custo adicional e risco de parada de fornecimento (cartório, tradutor, courier).',
        entidade: 'ContaPagar',
        quantidade: vencidas,
        link: '/financas/contas-pagar',
        recomendacao: 'Regularize as contas vencidas.',
        evidencia: { vencidas },
      }],
      metricas: { vencidas },
    }
  },
})

registrar({
  id: 'saude.contas.receber-vencidas',
  codigo: 'CAR-001',
  nome: 'Recebíveis sem atraso relevante',
  descricao: 'Parcela vencida e não recebida é inadimplência que precisa de ação.',
  dominio: 'CONTAS_RECEBER',
  modulo: 'Financeiro / Contas a receber',
  severidadePadrao: 'ALERTA',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 20_000,
  orientacao: 'Acione a cobrança das parcelas vencidas.',
  rotaCorrecao: '/financeiro',
  responsavel: 'Financeiro',
  ativo: true,
  executar: async ({ agora }): Promise<ResultadoVerificacao> => {
    const r = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM "ParcelaFinanceira" p
        WHERE p."receitaId" IS NOT NULL AND p.status = 'PENDENTE' AND p.vencimento < $1`,
      agora,
    )
    const n = r?.[0]?.n ?? 0
    if (!n) return { achados: [], metricas: { vencidas: 0 }, resumo: 'Nenhuma parcela vencida em aberto.' }
    return {
      achados: [{
        chave: 'parcelas-vencidas',
        severidade: n >= 20 ? 'ERRO' : 'ALERTA',
        titulo: `${n} parcela(s) vencida(s) em aberto`,
        descricao: `${n} parcela(s) de receita passaram do vencimento sem recebimento.`,
        explicacao: 'Parcela vencida em aberto é inadimplência efetiva.',
        impacto: 'Fluxo de caixa comprometido; o processo pode seguir sem contrapartida financeira.',
        entidade: 'ParcelaFinanceira',
        quantidade: n,
        link: '/financeiro',
        recomendacao: 'Acione a régua de cobrança.',
        evidencia: { vencidas: n },
      }],
      metricas: { vencidas: n },
    }
  },
})

registrar({
  id: 'saude.automacoes.regra-invalida',
  codigo: 'AUT-001',
  nome: 'Automação financeira apontando para configuração existente',
  descricao: 'Automação ativa apontando para configuração removida falha silenciosamente quando dispara.',
  dominio: 'AUTOMACOES',
  modulo: 'Automações Financeiras',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 20_000,
  orientacao: 'Reaponte a automação para uma Configuração Financeira válida ou desative a regra.',
  rotaCorrecao: ROTA_AUTO,
  responsavel: 'Financeiro',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const r = await prisma.$queryRawUnsafe<{ n: number }[]>(
      // A regra aponta para até DUAS configurações (custo e receita) — qualquer uma
      // quebrada impede o lançamento correspondente.
      `SELECT COUNT(*)::int AS n FROM "PhaseEconomicRule" e
        WHERE e.ativo = true
          AND ((e."custoConfigId" IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM "ProdutoFinanceiro" p WHERE p.id = e."custoConfigId"))
            OR (e."receitaConfigId" IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM "ProdutoFinanceiro" p WHERE p.id = e."receitaConfigId")))`,
    )
    const n = r?.[0]?.n ?? 0
    if (!n) return { achados: [], metricas: { regrasQuebradas: 0 }, resumo: 'Toda automação financeira aponta para configuração existente.' }
    return {
      achados: [{
        chave: 'automacao-config-inexistente',
        severidade: 'ERRO',
        titulo: `${n} automação(ões) apontando para configuração inexistente`,
        descricao: `${n} regra(s) econômica(s) ativa(s) referenciam uma Configuração Financeira que não existe mais.`,
        explicacao: 'A automação resolve o preço pela configuração; sem ela, o disparo não produz lançamento.',
        impacto: 'A fase avança sem gerar a receita ou o custo previsto — perda silenciosa.',
        entidade: 'PhaseEconomicRule',
        quantidade: n,
        link: ROTA_AUTO,
        recomendacao: 'Reaponte ou desative a regra.',
        evidencia: { regrasQuebradas: n },
      }],
      metricas: { regrasQuebradas: n },
    }
  },
})

registrar({
  id: 'saude.eventos.agenda-orfa',
  codigo: 'EVT-001',
  nome: 'Evento de agenda com processo existente',
  descricao: 'Evento apontando para processo removido polui a agenda e a Timeline.',
  dominio: 'EVENTOS',
  modulo: 'Eventos',
  severidadePadrao: 'ALERTA',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 15_000,
  orientacao: 'Remova ou reaponte os eventos órfãos.',
  rotaCorrecao: '/events',
  responsavel: 'Operação',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const r = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM "Evento" e
        WHERE e."processoId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "Processo" p WHERE p.id = e."processoId")`,
    )
    const n = r?.[0]?.n ?? 0
    if (!n) return { achados: [], metricas: { orfaos: 0 }, resumo: 'Todo evento com processo aponta para processo existente.' }
    return {
      achados: [{
        chave: 'evento-agenda-orfao',
        severidade: 'ALERTA',
        titulo: `${n} evento(s) de agenda sem processo`,
        descricao: `${n} evento(s) referenciam processo inexistente.`,
        explicacao: 'A agenda do processo é montada por este vínculo.',
        impacto: 'Compromissos aparecem soltos e a Timeline do processo fica incompleta.',
        entidade: 'Evento',
        quantidade: n,
        link: '/events',
        recomendacao: 'Reaponte ou remova os eventos órfãos.',
        evidencia: { orfaos: n },
      }],
      metricas: { orfaos: n },
    }
  },
})
