// src/services/parametrizacao/simulacao-parametrizacao.ts
// ============================================================================
// SIMULAÇÃO DA PARAMETRIZAÇÃO — o motor real, sem escrever.
//
// A simulação responde "o que aconteceria se eu publicasse isto?" e a única
// resposta confiável é a que vem dos MESMOS resolvedores que o runtime usa:
// `resolverElegibilidadeDocumental` decide quem e o quê, e
// `resolverPrecoPorConfigDB` decide quanto. Reimplementar qualquer um dos dois
// aqui — mesmo "só para prever" — criaria um segundo motor que divergiria do
// primeiro exatamente quando importasse: na véspera da publicação.
//
// Por isso a simulação NÃO tem cálculo próprio. Ela orquestra os resolvedores
// sobre um processo REAL escolhido pelo administrador (ou sobre nenhum, e então
// relata que não há amostra) e formata o resultado.
//
// Nada é escrito: nem TipoServico, nem MotorArtefato, nem obrigação.
// ============================================================================

import { prisma } from "@/lib/prisma"
import { resolverElegibilidadeDocumental } from "@/src/lib/motor/elegibilidade-documental"
import { resolverPrecoPorConfigDB } from "@/src/lib/motor/resolver-preco-financeiro.prisma"
import { NaturezaPreco } from "@prisma/client"

export interface LinhaSimulada {
  pessoaId: number
  pessoaNome: string
  documentoId: number
  componente: string
  phaseKey: string
  /** regra da Matriz responsável — a rastreabilidade que o programa exige */
  regraId: number
  custo: { valor: number; moeda: string } | null
  custoImpedimento: string | null
  receita: { valor: number; moeda: string } | null
  receitaImpedimento: string | null
}

export interface ResultadoSimulacao {
  processoId: number | null
  processoCodigo: string | null
  tipoProcessoId: number
  fases: string[]
  linhas: LinhaSimulada[]
  /** por que nada foi produzido, quando for o caso — nomeado, nunca silêncio */
  motivos: { motivo: string; detalhe?: string }[]
  totalCustoPrevisto: number
  totalReceitaPrevista: number
  margemPrevista: number
  /** moedas encontradas; > 1 significa que os totais não são somáveis direto */
  moedas: string[]
  escreveu: false
}

/**
 * Simula sobre um processo real do tipo escolhido. Sem processo do tipo, a
 * simulação diz isso em vez de inventar uma árvore — uma árvore fabricada
 * produziria documentos que não existem e números que ninguém poderia conferir.
 */
export async function simularParametrizacao(args: {
  tipoProcessoId: number
  phaseKey?: string | null
  processoId?: number | null
}): Promise<ResultadoSimulacao> {
  const motivos: { motivo: string; detalhe?: string }[] = []

  const processo = args.processoId
    ? await prisma.processo.findUnique({ where: { id: args.processoId }, select: { id: true, codigo: true, tipoProcessoMotorId: true } })
    : await prisma.processo.findFirst({
        where: { tipoProcessoMotorId: args.tipoProcessoId, arvoreId: { not: null } },
        select: { id: true, codigo: true, tipoProcessoMotorId: true }, orderBy: { id: "desc" },
      })

  const macro = await prisma.macroWorkflow.findUnique({
    where: { tipoProcessoId: args.tipoProcessoId },
    select: { fases: { select: { phaseKey: true }, orderBy: { ordem: "asc" } } },
  })
  const fases = (macro?.fases ?? []).map((f) => f.phaseKey).filter((f) => (args.phaseKey ? f === args.phaseKey : true))

  const vazio: ResultadoSimulacao = {
    processoId: processo?.id ?? null, processoCodigo: processo?.codigo ?? null,
    tipoProcessoId: args.tipoProcessoId, fases, linhas: [], motivos,
    totalCustoPrevisto: 0, totalReceitaPrevista: 0, margemPrevista: 0, moedas: [], escreveu: false,
  }

  if (!processo) {
    motivos.push({
      motivo: "sem processo real deste tipo para simular",
      detalhe: "a simulação roda sobre uma árvore existente; sem processo, os documentos e as pessoas seriam fabricados",
    })
    return vazio
  }

  const linhas: LinhaSimulada[] = []
  for (const phaseKey of fases) {
    // MESMA resolução do runtime — incluindo a trava de "só regra publicada".
    const eleg = await resolverElegibilidadeDocumental(processo.id, args.tipoProcessoId, phaseKey, 1)
    for (const p of eleg.pulados) motivos.push({ motivo: `${phaseKey}: ${p.motivo}`, detalhe: p.detalhe })

    for (const el of eleg.itens) {
      const linha: LinhaSimulada = {
        pessoaId: el.pessoaId, pessoaNome: el.pessoaNome, documentoId: el.documentoId,
        componente: el.componente, phaseKey, regraId: el.regraId,
        custo: null, custoImpedimento: null, receita: null, receitaImpedimento: null,
      }
      if (el.criaCusto) {
        if (!el.custoConfigId) linha.custoImpedimento = "sem Configuração Financeira de custo"
        else {
          const r = await resolverPrecoPorConfigDB(el.custoConfigId, {
            processoId: processo.id, tipoProcessoId: String(args.tipoProcessoId), natureza: NaturezaPreco.CUSTO,
          })
          if (r.ok && !r.conflito) linha.custo = { valor: r.valor, moeda: String(r.moeda) }
          else linha.custoImpedimento = r.ok ? (r.conflito?.nota ?? "conflito de preço") : `${r.motivo} — ${r.razao}`
        }
      }
      if (el.criaReceita) {
        if (!el.receitaConfigId) linha.receitaImpedimento = "sem Configuração Financeira de receita"
        else {
          const r = await resolverPrecoPorConfigDB(el.receitaConfigId, {
            processoId: processo.id, tipoProcessoId: String(args.tipoProcessoId), natureza: NaturezaPreco.VENDA,
          })
          if (r.ok && !r.conflito) linha.receita = { valor: r.valor, moeda: String(r.moeda) }
          else linha.receitaImpedimento = r.ok ? (r.conflito?.nota ?? "conflito de preço") : `${r.motivo} — ${r.razao}`
        }
      }
      linhas.push(linha)
    }
  }

  const moedas = [...new Set(linhas.flatMap((l) => [l.custo?.moeda, l.receita?.moeda]).filter((m): m is string => !!m))]
  const totalCusto = linhas.reduce((s, l) => s + (l.custo?.valor ?? 0), 0)
  const totalReceita = linhas.reduce((s, l) => s + (l.receita?.valor ?? 0), 0)
  if (moedas.length > 1) {
    motivos.push({
      motivo: "moedas diferentes na mesma simulação",
      detalhe: `${moedas.join(", ")} — os totais abaixo são somas por moeda, não convertidos`,
    })
  }

  return {
    ...vazio, linhas,
    totalCustoPrevisto: totalCusto, totalReceitaPrevista: totalReceita,
    margemPrevista: totalReceita - totalCusto, moedas,
  }
}
