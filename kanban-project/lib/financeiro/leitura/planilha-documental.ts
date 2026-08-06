// lib/financeiro/leitura/planilha-documental.ts
// ============================================================================
// PLANILHA DOCUMENTAL — a antiga planilha do Excel, como PROJEÇÃO.
//
// O QUE ELA É
// -----------
// Uma leitura. Uma grade em que a LINHA é um documento de uma pessoa e a COLUNA
// é um serviço documental; a célula é a soma dos custos daquele documento
// naquele serviço. Ela não guarda nada, não decide nada e não é fonte de nada:
// pessoa e dados registrais vêm da árvore/documento, dinheiro vem da obrigação
// (cujo saldo, por sua vez, vem do Ledger).
//
// AS COLUNAS NÃO SÃO FIXAS
// ------------------------
// A versão anterior criava seis TipoServico com nomes escritos no código
// ("Certidão Inteiro Teor", "Apostilamento Certidão"…) — e os criava dentro de
// um GET, ou seja, ler a planilha escrevia no banco. As colunas agora são
// DERIVADAS: os componentes que o cadastro declara como participantes da
// planilha (PhaseEconomicRule.participaPlanilha) mais qualquer serviço que já
// tenha custo lançado neste processo. Assim nenhuma coluna é inventada e nenhum
// custo existente fica escondido por não estar numa lista.
//
// AS LINHAS TAMBÉM NÃO SÃO
// ------------------------
// Quais tipos de documento entram na planilha é cadastro
// (TipoDocumentoCadastro.participaPlanilha), lido tanto pelo vínculo canônico
// (documentTypeId) quanto pela ponte legada (legacyEnumKey) — documento de tipo
// novo deixa de sumir da grade.
// ============================================================================

import { prisma } from '@/lib/prisma'
import { listarObrigacoes, type ObrigacaoLista } from './consultas'
import { ehAutomatico } from '../dominio/origem-lancamento'

export interface ColunaPlanilha {
  tipoServicoId: number
  nome: string
  ordem: number
}

export interface CelulaPlanilha {
  tipoServicoId: number
  /** soma na moeda de contrato quando todas as obrigações da célula compartilham moeda */
  valor: number
  /** soma convertida em BRL (fonte única: computeCambioAging) */
  valorBrl: number
  moeda: string | null
  /** montante sem cotação disponível — > 0 significa que valorBrl não o representa */
  naoConvertido: number
  automatico: boolean
  obrigacoes: number[]
}

export interface LinhaPlanilha {
  documentoId: number
  pessoaId: number | null
  tipoDocumentoId: number | null
  tipoDocumentoNome: string | null
  /** rótulo do registro (nascimento/casamento/óbito/…) vindo do cadastro do tipo */
  tipoRegistro: string | null
  dataRegistro: string | null
  local: string | null
  cartorio: string | null
  livro: string | null
  folha: string | null
  termo: string | null
  numeroRegistro: string | null
  observacao: string | null
  /** o registro foi localizado pela régua oficial (cartório + livro/folha/termo) */
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

export interface PlanilhaDocumental {
  processoId: number
  colunas: ColunaPlanilha[]
  pessoas: BlocoPessoa[]
  totaisPorServico: Record<number, number>
  totalGeralBrl: number
  naoConvertido: number
  /** custos com vínculo documental ausente — aparecem na lista, não na grade */
  custosSemVinculo: number
}

const num = (v: unknown): number => (v == null ? 0 : Number(v))
const nomeCompleto = (p: { nome: string; sobrenome: string | null }) =>
  [p.nome, p.sobrenome].filter(Boolean).join(' ').trim()

/** Localizado pela MESMA régua do gate de conclusão: cartório + livro/folha/termo. */
const preenchido = (v: string | null) => !!(v && String(v).trim())
const estaLocalizado = (d: { cartorio: string | null; livro: string | null; folha: string | null; termo: string | null }) =>
  preenchido(d.cartorio) && (preenchido(d.livro) || preenchido(d.folha) || preenchido(d.termo))

/**
 * Monta a planilha do processo. Somente leitura — nenhuma escrita, nem de
 * conveniência: ler a planilha nunca cria serviço, coluna ou lançamento.
 */
export async function montarPlanilhaDocumental(processoId: number): Promise<PlanilhaDocumental> {
  // ── 1. custos do processo (fonte única de dinheiro) ───────────────────────
  const obrigacoes = await listarObrigacoes({ processoId, natureza: 'CUSTO' })
  const comVinculo = obrigacoes.filter((o) => o.documentoId != null && o.tipoServicoId != null)
  const custosSemVinculo = obrigacoes.length - comVinculo.length

  // ── 2. colunas: cadastro declara + o que já tem lançamento ────────────────
  const regras = await prisma.phaseEconomicRule.findMany({
    where: { ativo: true, participaPlanilha: true },
    select: { componentName: true, ordem: true },
    orderBy: { ordem: 'asc' },
  })
  const servicosUsados = [...new Set(comVinculo.map((o) => o.tipoServicoId as number))]
  const servicos = await prisma.tipoServico.findMany({
    where: {
      processoId,
      OR: [
        ...(regras.length ? [{ nome: { in: regras.map((r) => r.componentName) } }] : []),
        ...(servicosUsados.length ? [{ id: { in: servicosUsados } }] : []),
      ],
    },
    select: { id: true, nome: true, ordem: true },
  })
  const ordemDaRegra = new Map(regras.map((r, i) => [r.componentName, r.ordem ?? i]))
  const colunas: ColunaPlanilha[] = servicos
    .map((s) => ({ tipoServicoId: s.id, nome: s.nome, ordem: ordemDaRegra.get(s.nome) ?? s.ordem ?? 999 }))
    .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome))

  // ── 3. linhas: documentos que o cadastro declara como da planilha ─────────
  const tiposDaPlanilha = await prisma.tipoDocumentoCadastro.findMany({
    where: { participaPlanilha: true },
    select: { id: true, name: true, legacyEnumKey: true },
  })
  const idsTipo = tiposDaPlanilha.map((t) => t.id)
  const enumsTipo = tiposDaPlanilha.map((t) => t.legacyEnumKey).filter((v): v is string => !!v)
  const nomeDoTipo = new Map(tiposDaPlanilha.map((t) => [t.id, t.name]))
  const tipoPorEnum = new Map(tiposDaPlanilha.filter((t) => t.legacyEnumKey).map((t) => [t.legacyEnumKey as string, t]))

  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: {
      arvore: {
        select: {
          pessoas: {
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
                    ? {
                        OR: [
                          ...(idsTipo.length ? [{ documentTypeId: { in: idsTipo } }] : []),
                          // ponte legada: documento antigo só tem o enum `tipo`
                          ...(enumsTipo.length ? [{ tipo: { in: enumsTipo as never } }] : []),
                        ],
                      }
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
          },
        },
      },
    },
  })

  // ── 4. grade: célula = (documento, serviço) ──────────────────────────────
  const porCelula = new Map<string, ObrigacaoLista[]>()
  for (const o of comVinculo) {
    const k = `${o.documentoId}-${o.tipoServicoId}`
    porCelula.set(k, [...(porCelula.get(k) ?? []), o])
  }

  const totaisPorServico: Record<number, number> = {}
  for (const c of colunas) totaisPorServico[c.tipoServicoId] = 0
  let totalGeralBrl = 0
  let naoConvertidoGeral = 0

  const pessoas: BlocoPessoa[] = (processo?.arvore?.pessoas ?? []).map((p) => {
    const linhas: LinhaPlanilha[] = p.documentos.map((d) => {
      const celulas: CelulaPlanilha[] = colunas.map((c) => {
        const obrs = porCelula.get(`${d.id}-${c.tipoServicoId}`) ?? []
        const moedas = [...new Set(obrs.map((o) => o.moeda))]
        const valorBrl = obrs.reduce((s, o) => s + num(o.contratadoBrl), 0)
        const cel: CelulaPlanilha = {
          tipoServicoId: c.tipoServicoId,
          valor: obrs.reduce((s, o) => s + num(o.valorContratado), 0),
          valorBrl,
          moeda: moedas.length === 1 ? moedas[0] : null,
          naoConvertido: obrs.reduce((s, o) => s + num(o.naoConvertido), 0),
          automatico: obrs.length > 0 && obrs.every((o) => ehAutomatico(o.origemLancamento)),
          obrigacoes: obrs.map((o) => o.obrigacaoId),
        }
        totaisPorServico[c.tipoServicoId] += valorBrl
        return cel
      })
      const totalLinha = celulas.reduce((s, c) => s + c.valorBrl, 0)
      const naoConvLinha = celulas.reduce((s, c) => s + c.naoConvertido, 0)
      totalGeralBrl += totalLinha
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
        totalBrl: totalLinha,
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
      totalBrl: linhas.reduce((s, l) => s + l.totalBrl, 0),
      naoConvertido: linhas.reduce((s, l) => s + l.naoConvertido, 0),
    }
  })

  return {
    processoId,
    colunas,
    pessoas,
    totaisPorServico,
    totalGeralBrl,
    naoConvertido: naoConvertidoGeral,
    custosSemVinculo,
  }
}
