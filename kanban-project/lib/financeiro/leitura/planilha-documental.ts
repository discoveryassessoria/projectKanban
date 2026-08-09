// lib/financeiro/leitura/planilha-documental.ts
// ============================================================================
// PLANILHA DOCUMENTAL — projeção econômico-documental. Nunca fonte.
//
// A LINHA é um documento de uma pessoa; a COLUNA é um item do cadastro canônico
// escolhido em Configuração da Planilha; a CÉLULA é o custo daquele serviço
// naquele documento. Ela não guarda nada e não decide nada:
//
//   quem aparece   → Árvore (pessoas ATIVAS) e Documento
//   o que aplica   → resolverElegibilidadeDocumental (Matriz + Regra Econômica)
//   quanto custa   → resolverPrecoPorConfigDB (Tabela de Preços)
//   o que virou fato → ObrigacaoEconomica (preço CONGELADO no lançamento)
//
// ─── O DEFEITO QUE ESTA VERSÃO CORRIGE ──────────────────────────────────────
// A anterior só sabia somar obrigação JÁ LANÇADA. Documento sem lançamento dava
// R$ 0,00 — e R$ 0,00 é um preço válido, então a planilha dizia "custa zero"
// quando queria dizer "ainda não sei". Não havia previsão: para ver o custo era
// preciso ir ao Financeiro criar o lançamento à mão.
//
// Agora cada célula tem ESTADO, e o número só aparece quando significa algo:
//
//   NAO_APLICAVEL  —            a regra não manda este serviço para este documento
//   SEM_PRECO      Sem valor    aplicável, mas a Tabela de Preços não resolve
//   PREVISTO       R$ x         aplicável, preço vigente resolvido (projeção)
//   REALIZADO      R$ x         virou obrigação — valor CONGELADO, não recalcula
//
// ─── PREVISTO RECALCULA, REALIZADO NÃO ──────────────────────────────────────
// Enquanto é projeção, a célula lê a tabela vigente e acompanha qualquer
// mudança de preço. Quando vira fato, o valor exibido passa a ser o da
// obrigação — congelado no instante do lançamento. Mudar a tabela amanhã não
// reescreve o que foi cobrado ontem.
//
// ─── DESEMPENHO ─────────────────────────────────────────────────────────────
// O preço é resolvido UMA VEZ POR COLUNA, não por célula: um processo com 100
// pessoas, 300 documentos e 8 colunas faz 8 resoluções de preço, não 2.400.
// ============================================================================

import { prisma } from '@/lib/prisma'
import { NaturezaPreco } from '@prisma/client'
import { listarObrigacoes, type ObrigacaoLista } from './consultas'
import { ehAutomatico } from '../dominio/origem-lancamento'
import { listarColunasConfiguradas, type ColunaConfigurada } from './planilha-colunas'
import { resolverElegibilidadeDocumental } from '@/src/lib/motor/elegibilidade-documental'
import { resolverPrecoPorConfigDB } from '@/src/lib/motor/resolver-preco-financeiro.prisma'
import { pessoasAtivasDaArvore } from '@/src/lib/genealogia/vinculo-ativo'

// ── DINHEIRO EM CENTAVOS ────────────────────────────────────────────────────
// Soma de dinheiro não se faz em float: 146.24 + 7.64 + 151.05 já erra o
// centavo em binário. Acumula-se em inteiro e converte-se na saída.
const paraCentavos = (v: unknown): number => Math.round(Number(v ?? 0) * 100)
const paraReais = (centavos: number): number => Math.round(centavos) / 100

export type EstadoCelula = 'NAO_APLICAVEL' | 'SEM_PRECO' | 'PREVISTO' | 'REALIZADO'

/** Por que esta célula mostra este número — a resposta do Explain Engine. */
export interface ExplicacaoCelula {
  servico: string
  origem: 'Tabela de Preços' | 'Lançamento realizado (valor congelado)' | null
  tabelaValorId: number | null
  regra: string | null
  moeda: string | null
  /** ids das obrigações que compõem a célula, quando REALIZADO */
  obrigacoes: number[]
  /** motivo textual quando não há valor a mostrar */
  motivo: string | null
}

export interface CelulaPlanilha {
  colunaId: number
  /** mantido para compatibilidade da resposta legada */
  tipoServicoId: number
  estado: EstadoCelula
  /** valor na moeda do preço/contrato; null quando não há valor */
  valor: number | null
  /** valor em BRL; null quando não há valor */
  valorBrl: number | null
  moeda: string | null
  naoConvertido: number
  automatico: boolean
  obrigacoes: number[]
  explicacao: ExplicacaoCelula
}

export interface LinhaPlanilha {
  documentoId: number
  pessoaId: number | null
  tipoDocumentoId: number | null
  tipoDocumentoNome: string | null
  tipoRegistro: string | null
  dataRegistro: string | null
  local: string | null
  cartorio: string | null
  livro: string | null
  folha: string | null
  termo: string | null
  numeroRegistro: string | null
  observacao: string | null
  localizado: boolean
  celulas: CelulaPlanilha[]
  totalBrl: number
  naoConvertido: number
}

export interface BlocoPessoa {
  pessoaId: number | null
  nome: string
  numeroLinhagem: number | null
  conjuges: string[]
  paiNome: string | null
  maeNome: string | null
  linhas: LinhaPlanilha[]
  totalBrl: number
  naoConvertido: number
}

export interface ColunaPlanilha {
  colunaId: number
  tipoServicoId: number
  nome: string
  ordem: number
  origem: string
}

export interface PlanilhaDocumental {
  processoId: number
  colunas: ColunaPlanilha[]
  pessoas: BlocoPessoa[]
  totaisPorServico: Record<number, number>
  totalGeralBrl: number
  totalPrevistoBrl: number
  totalRealizadoBrl: number
  naoConvertido: number
  custosSemVinculo: number
  /** por que algo não entrou — nunca silêncio (vem do resolvedor de elegibilidade) */
  pendencias: Array<{ motivo: string; detalhe?: string }>
}

const num = (v: unknown): number => (v == null ? 0 : Number(v))
const nomeCompleto = (p: { nome: string; sobrenome: string | null }) =>
  [p.nome, p.sobrenome].filter(Boolean).join(' ').trim()

/** Localizado pela MESMA régua do gate de conclusão: cartório + livro/folha/termo. */
const preenchido = (v: string | null) => !!(v && String(v).trim())
const estaLocalizado = (d: { cartorio: string | null; livro: string | null; folha: string | null; termo: string | null }) =>
  preenchido(d.cartorio) && (preenchido(d.livro) || preenchido(d.folha) || preenchido(d.termo))

/** Preço resolvido de uma coluna, uma vez só. */
interface PrecoDaColuna {
  ok: boolean
  valor: number
  moeda: string | null
  tabelaValorId: number | null
  razao: string
  motivo: string | null
}

export async function montarPlanilhaDocumental(processoId: number): Promise<PlanilhaDocumental> {
  const pendencias: Array<{ motivo: string; detalhe?: string }> = []

  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, arvoreId: true, tipoProcessoMotorId: true },
  })

  // ── 1. COLUNAS — configuração, por ID, nunca por nome ─────────────────────
  const configuradas = await listarColunasConfiguradas({ apenasAtivas: true })
  const colunas: ColunaPlanilha[] = configuradas.map((c, i) => ({
    colunaId: c.id,
    // Compatibilidade da resposta legada: quem consome `tipoServicoId` continua
    // recebendo um número estável por coluna.
    tipoServicoId: c.configId ?? c.tipoDocumentoId ?? c.id,
    nome: c.rotulo,
    ordem: c.posicao || i + 1,
    origem: c.origem,
  }))

  // ── 2. APLICABILIDADE — resolvedor OFICIAL, por fase ──────────────────────
  // Uma coluna existir significa "SE aplicável, mostre aqui". Quem decide se
  // aplica é a Matriz Documental + Regra Econômica, não a configuração da tela.
  const aplicavel = new Map<string, { componente: string }>()
  if (processo?.tipoProcessoMotorId) {
    const fases = await prisma.matrizDocumental.findMany({
      where: { tipoProcessoId: processo.tipoProcessoMotorId, arquivado: false, status: 'PUBLICADA' },
      select: { phaseKey: true }, distinct: ['phaseKey'],
    })
    // SEM REGRA PUBLICADA A PLANILHA NÃO ADIVINHA — e também não fica muda. Toda
    // célula viria "—" e o operador não teria como saber se o serviço não se
    // aplica ou se o cadastro é que está incompleto.
    if (fases.length === 0) {
      pendencias.push({
        motivo: 'nenhuma Regra Documental PUBLICADA para este tipo de processo',
        detalhe: 'sem regra publicada nada é aplicável — publique em Gerenciamento › Regras Documentais',
      })
    }
    for (const { phaseKey } of fases) {
      if (!phaseKey) continue
      const eleg = await resolverElegibilidadeDocumental(processoId, processo.tipoProcessoMotorId, phaseKey, 1)
      pendencias.push(...eleg.pulados)
      for (const item of eleg.itens) {
        if (!item.criaCusto || item.custoConfigId == null) continue
        aplicavel.set(`${item.documentoId}::${item.custoConfigId}`, { componente: item.componente })
      }
    }
  } else {
    pendencias.push({ motivo: 'processo sem Tipo de Processo do motor — nenhuma regra documental se aplica' })
  }

  // ── 3. PREÇO — uma resolução POR COLUNA (não por célula) ──────────────────
  const precoPorConfig = new Map<number, PrecoDaColuna>()
  for (const c of configuradas) {
    if (c.configId == null) continue
    const r = await resolverPrecoPorConfigDB(c.configId, {
      processoId,
      tipoProcessoId: processo?.tipoProcessoMotorId != null ? String(processo.tipoProcessoMotorId) : '',
      natureza: NaturezaPreco.CUSTO, // PLANILHA DE CUSTOS: nunca preço de venda.
    })
    precoPorConfig.set(c.configId, r.ok && !r.conflito
      ? { ok: true, valor: r.valor, moeda: String(r.moeda), tabelaValorId: r.tabelaValorId, razao: r.razao, motivo: null }
      : { ok: false, valor: 0, moeda: null, tabelaValorId: null, razao: '', motivo: r.ok ? (r.conflito?.nota ?? 'conflito de preço') : r.razao })
  }

  // ── 4. REALIZADO — obrigações já lançadas (valor congelado) ───────────────
  const obrigacoes = await listarObrigacoes({ processoId, natureza: 'CUSTO' })
  const comVinculo = obrigacoes.filter((o) => o.documentoId != null && o.configFinanceiraId != null)
  const custosSemVinculo = obrigacoes.length - comVinculo.length
  const realizadoPorCelula = new Map<string, ObrigacaoLista[]>()
  for (const o of comVinculo) {
    const k = `${o.documentoId}::${o.configFinanceiraId}`
    realizadoPorCelula.set(k, [...(realizadoPorCelula.get(k) ?? []), o])
  }

  // ── 5. LINHAS — documentos que o cadastro declara como da planilha ────────
  const tiposDaPlanilha = await prisma.tipoDocumentoCadastro.findMany({
    where: { participaPlanilha: true },
    select: { id: true, name: true, legacyEnumKey: true },
  })
  const idsTipo = tiposDaPlanilha.map((t) => t.id)
  const enumsTipo = tiposDaPlanilha.map((t) => t.legacyEnumKey).filter((v): v is string => !!v)
  const nomeDoTipo = new Map(tiposDaPlanilha.map((t) => [t.id, t.name]))
  const tipoPorEnum = new Map(tiposDaPlanilha.filter((t) => t.legacyEnumKey).map((t) => [t.legacyEnumKey as string, t]))

  // PESSOAS ATIVAS da árvore — recorte canônico. Quem saiu não deixa bloco órfão,
  // e quem é requerente do processo mas nunca entrou na árvore não aparece aqui.
  const pessoas = processo?.arvoreId
    ? await prisma.pessoa.findMany({
        where: pessoasAtivasDaArvore(processo.arvoreId),
        orderBy: [{ numeroLinhagem: 'asc' }, { ordemCusto: 'asc' }, { id: 'asc' }],
        select: {
          id: true, nome: true, sobrenome: true, numeroLinhagem: true,
          pai: { select: { nome: true, sobrenome: true } },
          mae: { select: { nome: true, sobrenome: true } },
          unioesComoPessoa1: { select: { pessoa2: { select: { nome: true, sobrenome: true } } } },
          unioesComoPessoa2: { select: { pessoa1: { select: { nome: true, sobrenome: true } } } },
          documentos: {
            where: {
              status: { notIn: ['CANCELADO', 'INVALIDO'] },
              ...(idsTipo.length || enumsTipo.length
                ? { OR: [
                    ...(idsTipo.length ? [{ documentTypeId: { in: idsTipo } }] : []),
                    ...(enumsTipo.length ? [{ tipo: { in: enumsTipo as never } }] : []),
                  ] }
                : { id: -1 }),
            },
            orderBy: { id: 'asc' },
            select: {
              id: true, tipo: true, documentTypeId: true, observacoes: true,
              cartorio: true, livro: true, folha: true, termo: true, numero_registro: true,
              data_registro: true, cidade_registro: true, estado_registro: true,
            },
          },
        },
      })
    : []

  // ── 6. GRADE ──────────────────────────────────────────────────────────────
  const totaisPorServicoCent: Record<number, number> = {}
  for (const c of colunas) totaisPorServicoCent[c.tipoServicoId] = 0
  let totalGeralCent = 0, previstoCent = 0, realizadoCent = 0, naoConvertidoGeral = 0

  const blocos: BlocoPessoa[] = pessoas.map((p) => {
    const linhas: LinhaPlanilha[] = p.documentos.map((d) => {
      let totalLinhaCent = 0
      let naoConvLinha = 0

      const celulas: CelulaPlanilha[] = configuradas.map((cfg, i) => {
        const col = colunas[i]
        const chave = `${d.id}::${cfg.configId}`
        const obrs = cfg.configId != null ? realizadoPorCelula.get(chave) ?? [] : []
        const aplica = cfg.configId != null && aplicavel.has(chave)
        const preco = cfg.configId != null ? precoPorConfig.get(cfg.configId) : undefined

        const base = { colunaId: cfg.id, tipoServicoId: col.tipoServicoId, naoConvertido: 0, obrigacoes: [] as number[] }

        // REALIZADO tem precedência sobre tudo: o fato manda, inclusive quando a
        // regra deixou de aplicar depois. Esconder um custo lançado seria mentir.
        if (obrs.length > 0) {
          const valorBrlCent = obrs.reduce((s, o) => s + paraCentavos(o.contratadoBrl), 0)
          const naoConv = obrs.reduce((s, o) => s + num(o.naoConvertido), 0)
          const moedas = [...new Set(obrs.map((o) => o.moeda))]
          totaisPorServicoCent[col.tipoServicoId] += valorBrlCent
          totalLinhaCent += valorBrlCent
          realizadoCent += valorBrlCent
          naoConvLinha += naoConv
          return {
            ...base,
            estado: 'REALIZADO' as const,
            valor: paraReais(obrs.reduce((s, o) => s + paraCentavos(o.valorContratado), 0)),
            valorBrl: paraReais(valorBrlCent),
            moeda: moedas.length === 1 ? moedas[0] : null,
            naoConvertido: naoConv,
            automatico: obrs.every((o) => ehAutomatico(o.origemLancamento)),
            obrigacoes: obrs.map((o) => o.obrigacaoId),
            explicacao: {
              servico: cfg.rotuloCanonico,
              origem: 'Lançamento realizado (valor congelado)' as const,
              tabelaValorId: null, regra: null,
              moeda: moedas.length === 1 ? moedas[0] : null,
              obrigacoes: obrs.map((o) => o.obrigacaoId),
              motivo: null,
            },
          }
        }

        if (!aplica) {
          return {
            ...base, estado: 'NAO_APLICAVEL' as const, valor: null, valorBrl: null, moeda: null, automatico: false,
            explicacao: {
              servico: cfg.rotuloCanonico, origem: null, tabelaValorId: null, regra: null, moeda: null, obrigacoes: [],
              motivo: 'A Matriz Documental não aplica este serviço a este documento.',
            },
          }
        }

        if (!preco?.ok) {
          return {
            ...base, estado: 'SEM_PRECO' as const, valor: null, valorBrl: null, moeda: null, automatico: false,
            explicacao: {
              servico: cfg.rotuloCanonico, origem: 'Tabela de Preços' as const, tabelaValorId: null, regra: null,
              moeda: null, obrigacoes: [],
              motivo: preco?.motivo ?? 'Sem preço de custo vigente na Tabela de Preços.',
            },
          }
        }

        // PREVISTO — projeção pela tabela VIGENTE. Muda quando a tabela muda.
        // A conversão para BRL de moeda estrangeira é do domínio de câmbio; aqui
        // o previsto só soma ao total quando já está em BRL, e o que não converte
        // é declarado em `naoConvertido` em vez de virar um número inventado.
        const emBrl = preco.moeda === 'BRL'
        const valorCent = paraCentavos(preco.valor)
        if (emBrl) {
          totaisPorServicoCent[col.tipoServicoId] += valorCent
          totalLinhaCent += valorCent
          previstoCent += valorCent
        } else {
          naoConvLinha += preco.valor
        }
        return {
          ...base,
          estado: 'PREVISTO' as const,
          valor: paraReais(valorCent),
          valorBrl: emBrl ? paraReais(valorCent) : null,
          moeda: preco.moeda,
          naoConvertido: emBrl ? 0 : preco.valor,
          automatico: true,
          explicacao: {
            servico: cfg.rotuloCanonico,
            origem: 'Tabela de Preços' as const,
            tabelaValorId: preco.tabelaValorId,
            regra: preco.razao || null,
            moeda: preco.moeda,
            obrigacoes: [],
            motivo: null,
          },
        }
      })

      totalGeralCent += totalLinhaCent
      naoConvertidoGeral += naoConvLinha
      const tipoCad = d.documentTypeId != null
        ? { id: d.documentTypeId, name: nomeDoTipo.get(d.documentTypeId) ?? null }
        : (d.tipo ? tipoPorEnum.get(String(d.tipo)) ?? null : null)

      return {
        documentoId: d.id,
        pessoaId: p.id,
        tipoDocumentoId: tipoCad?.id ?? null,
        tipoDocumentoNome: tipoCad?.name ?? null,
        tipoRegistro: tipoCad?.name ?? (d.tipo ? String(d.tipo) : null),
        dataRegistro: d.data_registro ? new Date(d.data_registro).toISOString() : null,
        local: [d.cidade_registro, d.estado_registro].filter(Boolean).join(' - ') || null,
        cartorio: d.cartorio, livro: d.livro, folha: d.folha, termo: d.termo,
        numeroRegistro: d.numero_registro,
        observacao: d.observacoes,
        localizado: estaLocalizado(d),
        celulas,
        totalBrl: paraReais(totalLinhaCent),
        naoConvertido: naoConvLinha,
      }
    })

    return {
      pessoaId: p.id,
      nome: nomeCompleto(p),
      numeroLinhagem: p.numeroLinhagem ?? null,
      conjuges: [
        ...p.unioesComoPessoa1.map((u) => (u.pessoa2 ? nomeCompleto(u.pessoa2) : '')),
        ...p.unioesComoPessoa2.map((u) => (u.pessoa1 ? nomeCompleto(u.pessoa1) : '')),
      ].filter(Boolean),
      paiNome: p.pai ? nomeCompleto(p.pai) : null,
      maeNome: p.mae ? nomeCompleto(p.mae) : null,
      linhas,
      totalBrl: paraReais(linhas.reduce((s, l) => s + paraCentavos(l.totalBrl), 0)),
      naoConvertido: linhas.reduce((s, l) => s + l.naoConvertido, 0),
    }
  })

  return {
    processoId,
    colunas,
    pessoas: blocos,
    totaisPorServico: Object.fromEntries(
      Object.entries(totaisPorServicoCent).map(([k, v]) => [k, paraReais(v)]),
    ),
    totalGeralBrl: paraReais(totalGeralCent),
    totalPrevistoBrl: paraReais(previstoCent),
    totalRealizadoBrl: paraReais(realizadoCent),
    naoConvertido: naoConvertidoGeral,
    custosSemVinculo,
    pendencias,
  }
}
