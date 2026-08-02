// lib/saude/verificacoes/financeiro.ts
//
// FINANCEIRO — item comercializável tem que ser cobrável de verdade.
//
// A regra do Discovery: a Configuração Financeira do cadastro mestre diz O QUE
// o item é; a Tabela de Valores diz QUANTO custa. Item ativo sem uma das duas
// pontas não fecha o ciclo — e o operador só descobre na hora de cobrar.

import { prisma } from '@/lib/prisma'
import { registrar } from '../catalogo'
import type { Achado, ResultadoVerificacao } from '../tipos'

const ROTA_CONFIG = '/administrator?screen=catalog'
const ROTA_PRECOS = '/administrator?screen=pricingtable'

registrar({
  id: 'saude.financeiro.config-sem-preco',
  codigo: 'FIN-001',
  nome: 'Configuração financeira ativa com preço vigente',
  descricao: 'Configuração ativa que gera receita precisa ter preço na Tabela de Valores — senão o item não pode ser cobrado.',
  dominio: 'FINANCEIRO',
  modulo: 'Configurações Financeiras',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 20_000,
  orientacao: 'Cadastre o preço na Tabela de Valores para a natureza correspondente (VENDA para receita, CUSTO para custo).',
  rotaCorrecao: ROTA_PRECOS,
  responsavel: 'Financeiro',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const configs = await prisma.produtoFinanceiro.findMany({
      where: { ativo: true },
      select: {
        id: true, nome: true, publicCode: true, naturezaFin: true, possuiCusto: true, possuiReceita: true,
        itemCatalogoId: true,
        precosConfig: { where: { arquivado: false, legadoPendente: false }, select: { natureza: true } },
      },
    })
    const achados: Achado[] = []
    const semReceita: { id: number; nome: string }[] = []
    const semCusto: { id: number; nome: string }[] = []

    for (const c of configs) {
      const geraReceita = c.naturezaFin ? c.naturezaFin !== 'SOMENTE_CUSTO' : c.possuiReceita
      const geraCusto = c.naturezaFin ? c.naturezaFin !== 'SOMENTE_RECEITA' : c.possuiCusto
      const naturezas = new Set(c.precosConfig.map((p) => String(p.natureza)))
      if (geraReceita && !naturezas.has('VENDA') && !naturezas.has('RECEITA')) semReceita.push({ id: c.id, nome: c.nome })
      if (geraCusto && !naturezas.has('CUSTO')) semCusto.push({ id: c.id, nome: c.nome })
    }

    if (semReceita.length) {
      achados.push({
        chave: 'config-sem-preco-venda',
        severidade: 'ERRO',
        titulo: `${semReceita.length} configuração(ões) de receita sem preço de venda`,
        descricao: `${semReceita.length} configuração(ões) financeira(s) ativa(s) geram receita mas não têm preço de VENDA vigente na Tabela de Valores.`,
        explicacao: 'O motor financeiro busca o preço exclusivamente na Tabela de Valores. Sem preço, o lançamento vira pendência.',
        impacto: 'O item não pode ser cobrado: a automação financeira falha e a receita não é gerada.',
        entidade: 'ProdutoFinanceiro',
        registroId: String(semReceita[0].id),
        registroNome: semReceita[0].nome,
        quantidade: semReceita.length,
        link: ROTA_PRECOS,
        recomendacao: 'Cadastre o preço de venda vigente para cada configuração listada.',
        evidencia: { total: semReceita.length, amostra: semReceita.slice(0, 8) },
      })
    }
    if (semCusto.length) {
      achados.push({
        chave: 'config-sem-preco-custo',
        severidade: 'ALERTA',
        titulo: `${semCusto.length} configuração(ões) de custo sem preço de custo`,
        descricao: `${semCusto.length} configuração(ões) ativa(s) geram custo mas não têm preço de CUSTO vigente.`,
        explicacao: 'Sem preço de custo, o lançamento de custo do processo fica sem valor de referência.',
        impacto: 'Custos precisam ser digitados manualmente, e a margem do processo deixa de ser confiável.',
        entidade: 'ProdutoFinanceiro',
        registroId: String(semCusto[0].id),
        registroNome: semCusto[0].nome,
        quantidade: semCusto.length,
        link: ROTA_PRECOS,
        recomendacao: 'Cadastre o preço de custo vigente para cada configuração listada.',
        evidencia: { total: semCusto.length, amostra: semCusto.slice(0, 8) },
      })
    }

    return {
      achados,
      metricas: { configsAtivas: configs.length, semPrecoVenda: semReceita.length, semPrecoCusto: semCusto.length },
      resumo: `${configs.length} configuração(ões) ativa(s), todas com preço vigente.`,
    }
  },
})

registrar({
  id: 'saude.financeiro.config-sem-natureza',
  codigo: 'FIN-002',
  nome: 'Configuração financeira com natureza definida',
  descricao: 'Sem natureza financeira o motor não sabe se o item gera receita, custo ou ambos.',
  dominio: 'FINANCEIRO',
  modulo: 'Configurações Financeiras',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 15_000,
  orientacao: 'Defina a Natureza Financeira (somente custo, somente receita ou custo e receita) na configuração.',
  rotaCorrecao: ROTA_CONFIG,
  responsavel: 'Financeiro',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const semNatureza = await prisma.produtoFinanceiro.findMany({
      where: { ativo: true, naturezaFin: null, possuiCusto: false, possuiReceita: false },
      select: { id: true, nome: true }, take: 100,
    })
    if (!semNatureza.length) return { achados: [], metricas: { semNatureza: 0 }, resumo: 'Toda configuração ativa declara a natureza financeira.' }
    return {
      achados: [{
        chave: 'config-sem-natureza',
        severidade: 'ERRO',
        titulo: `${semNatureza.length} configuração(ões) sem natureza financeira`,
        descricao: `${semNatureza.length} configuração(ões) ativa(s) não dizem se o item gera receita, custo ou ambos.`,
        explicacao: 'A natureza financeira é o que determina quais lançamentos o item pode originar.',
        impacto: 'O item é inelegível a lançamento: não vira receita nem custo.',
        entidade: 'ProdutoFinanceiro',
        registroId: String(semNatureza[0].id),
        registroNome: semNatureza[0].nome,
        quantidade: semNatureza.length,
        link: ROTA_CONFIG,
        recomendacao: 'Defina a natureza em cada configuração listada.',
        evidencia: { total: semNatureza.length, amostra: semNatureza.slice(0, 8) },
      }],
      metricas: { semNatureza: semNatureza.length },
    }
  },
})

registrar({
  id: 'saude.financeiro.preco-invalido',
  codigo: 'FIN-003',
  nome: 'Preço vigente com valor e moeda válidos',
  descricao: 'Preço zerado, negativo ou sem moeda é preço que não pode ser cobrado.',
  dominio: 'TABELA_VALORES',
  modulo: 'Tabela de Valores',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 20_000,
  orientacao: 'Corrija o valor na Tabela de Valores ou arquive a linha se ela não vale mais.',
  rotaCorrecao: ROTA_PRECOS,
  responsavel: 'Financeiro',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const negativos = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM "TabelaValor"
        WHERE arquivado = false AND "legadoPendente" = false
          AND (valor < 0 OR ("valorBase" IS NOT NULL AND "valorBase" < 0) OR ("valorAdicional" IS NOT NULL AND "valorAdicional" < 0))`,
    )
    const zerados = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM "TabelaValor"
        WHERE arquivado = false AND "legadoPendente" = false
          AND valor = 0 AND COALESCE("valorBase", 0) = 0`,
    )
    const achados: Achado[] = []
    const nNeg = negativos?.[0]?.n ?? 0
    const nZero = zerados?.[0]?.n ?? 0

    if (nNeg) {
      achados.push({
        chave: 'preco-negativo',
        severidade: 'ERRO',
        titulo: `${nNeg} preço(s) com valor negativo`,
        descricao: `${nNeg} linha(s) vigente(s) da Tabela de Valores têm valor negativo.`,
        explicacao: 'Valor negativo em tabela de preço inverte o sinal do lançamento gerado.',
        impacto: 'Cobrança ou custo lançado com sinal trocado — o financeiro do processo fica incorreto.',
        entidade: 'TabelaValor',
        quantidade: nNeg,
        link: ROTA_PRECOS,
        recomendacao: 'Corrija os valores; desconto se modela como regra, não como preço negativo.',
        evidencia: { negativos: nNeg },
      })
    }
    if (nZero) {
      achados.push({
        chave: 'preco-zerado',
        severidade: 'ALERTA',
        titulo: `${nZero} preço(s) vigente(s) zerado(s)`,
        descricao: `${nZero} linha(s) vigente(s) estão com valor zero.`,
        explicacao: 'Preço zero pode ser intencional (cortesia) ou cadastro incompleto — o sistema não tem como distinguir.',
        impacto: 'Se não for intencional, o item é entregue sem cobrança.',
        entidade: 'TabelaValor',
        quantidade: nZero,
        link: ROTA_PRECOS,
        recomendacao: 'Confirme se a gratuidade é intencional; caso contrário, informe o valor.',
        evidencia: { zerados: nZero },
      })
    }
    return { achados, metricas: { negativos: nNeg, zerados: nZero }, resumo: 'Preços vigentes com valores válidos.' }
  },
})

registrar({
  id: 'saude.financeiro.item-ativo-sem-config',
  codigo: 'FIN-004',
  nome: 'Item comercializável com configuração financeira',
  descricao: 'Item do Catálogo Mestre ativo sem Configuração Financeira não pode ser lançado.',
  dominio: 'SERVICOS',
  modulo: 'Catálogo de Serviços',
  severidadePadrao: 'ALERTA',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 20_000,
  orientacao: 'Crie a Configuração Financeira do item ou inative o item enquanto ele não for comercializável.',
  rotaCorrecao: ROTA_CONFIG,
  responsavel: 'Financeiro',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<{ id: number; name: string }[]>(
      `SELECT i.id, i.name FROM "ItemCatalogo" i
        WHERE i.ativo = true
          AND NOT EXISTS (SELECT 1 FROM "ProdutoFinanceiro" p WHERE p."itemCatalogoId" = i.id)
        LIMIT 200`,
    )
    if (!linhas.length) return { achados: [], metricas: { semConfig: 0 }, resumo: 'Todo item ativo do catálogo tem configuração financeira.' }
    return {
      achados: [{
        chave: 'item-sem-config-financeira',
        severidade: 'ALERTA',
        titulo: `${linhas.length} item(ns) do catálogo sem configuração financeira`,
        descricao: `${linhas.length} item(ns) ativo(s) do Catálogo Mestre não têm Configuração Financeira.`,
        explicacao: 'A elegibilidade a lançamento exige item ativo + configuração + preço vigente.',
        impacto: 'O item não aparece como opção ao lançar receita ou custo no processo.',
        entidade: 'ItemCatalogo',
        registroId: String(linhas[0].id),
        registroNome: linhas[0].name,
        quantidade: linhas.length,
        link: ROTA_CONFIG,
        recomendacao: 'Crie a configuração ou inative os itens que não são comercializáveis.',
        evidencia: { total: linhas.length, amostra: linhas.slice(0, 8) },
      }],
      metricas: { semConfig: linhas.length },
    }
  },
})

registrar({
  id: 'saude.financeiro.parcelas-divergentes',
  codigo: 'FIN-005',
  nome: 'Soma das parcelas confere com o total da receita',
  descricao: 'Parcelas que não somam o total da receita indicam cobrança inconsistente.',
  dominio: 'COBRANCAS',
  modulo: 'Financeiro / Receitas',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 25_000,
  orientacao: 'Reabra a receita e refaça o parcelamento; nunca ajuste parcela isolada sem revisar o total.',
  rotaCorrecao: '/financeiro',
  responsavel: 'Financeiro',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<{ id: number; total: string; soma: string }[]>(
      `SELECT r.id, r.valor::text AS total, COALESCE(SUM(p.valor), 0)::text AS soma
         FROM "Receita" r
         JOIN "ParcelaFinanceira" p ON p."receitaId" = r.id
        WHERE r.cancelada = false
        GROUP BY r.id, r.valor
       HAVING ABS(COALESCE(SUM(p.valor), 0) - r.valor) > 0.01
        LIMIT 100`,
    )
    if (!linhas.length) return { achados: [], metricas: { divergentes: 0 }, resumo: 'Toda receita ativa tem parcelas que somam o total.' }
    return {
      achados: [{
        chave: 'parcelas-divergentes',
        severidade: 'CRITICO',
        titulo: `${linhas.length} receita(s) com parcelas divergentes do total`,
        descricao: `Em ${linhas.length} receita(s), a soma das parcelas não bate com o valor contratado.`,
        explicacao: 'O parcelamento é uma partição exata do total. Divergência significa parcela editada isoladamente ou perdida.',
        impacto: 'O cliente é cobrado a mais ou a menos, e a posição financeira do processo fica errada.',
        entidade: 'Receita',
        registroId: String(linhas[0].id),
        quantidade: linhas.length,
        link: '/financeiro',
        recomendacao: 'Revise cada receita listada e refaça o parcelamento a partir do total contratado.',
        evidencia: { total: linhas.length, amostra: linhas.slice(0, 8) },
      }],
      metricas: { divergentes: linhas.length },
    }
  },
})
