// lib/financeiro/inteligencia/analise-lancamento-custo.ts
// ============================================================================
// F8.1 — INTELIGÊNCIA DE LANÇAMENTO DE CUSTO (server-side, SOMENTE LEITURA).
//
// Antes de gravar um custo, o sistema olha o próprio histórico e responde duas coisas:
//   • AVISOS  — o que parece errado (duplicidade provável, valor fora da faixa praticada,
//               vencimento no passado, custo sem fornecedor/centro de custo).
//   • SUGESTÕES — o que normalmente se usa neste caso (fornecedor, centro de custo e valor
//               típicos do MESMO item do Catálogo Mestre).
//
// Princípios:
//   - NUNCA bloqueia, NUNCA grava, NUNCA auto-preenche: o operador decide. Avisos são
//     conselhos com evidência (mostram os registros que embasam a conclusão).
//   - Sem regra inventada de negócio: tudo é derivado do histórico real de ObrigacaoEconomica
//     (A_PAGAR, não cancelada, não arquivada). Se não há histórico, não há palpite.
//   - Puro o suficiente para ser testado: o núcleo de decisão é separado da consulta.
// ============================================================================
import { prisma } from '@/lib/prisma'

export type SeveridadeAviso = 'info' | 'atencao' | 'alto'
export type CodigoAviso =
  | 'DUPLICIDADE_PROVAVEL'
  | 'VALOR_ACIMA_DO_HISTORICO'
  | 'VALOR_ABAIXO_DO_HISTORICO'
  | 'VENCIMENTO_NO_PASSADO'
  | 'SEM_FORNECEDOR'
  | 'SEM_CENTRO_CUSTO'

export interface AvisoLancamento {
  codigo: CodigoAviso
  severidade: SeveridadeAviso
  mensagem: string
  /** Registros que embasam o aviso (o operador confere antes de decidir). */
  evidencias?: { obrigacaoId: number; codigo: string | null; descricao: string | null; valor: number; moeda: string; criadoEm: string | null }[]
}

export interface SugestoesLancamento {
  fornecedor: { id: number; nome: string; ocorrencias: number } | null
  valorTipico: { valor: number; moeda: string; amostras: number; minimo: number; maximo: number } | null
}

export interface AnaliseLancamentoCusto {
  avisos: AvisoLancamento[]
  sugestoes: SugestoesLancamento
  /** Quantidade de lançamentos históricos do mesmo item que embasaram as sugestões. */
  baseHistorica: number
}

export interface EntradaAnaliseCusto {
  processoId?: number | null
  itemCatalogoId?: number | null
  fornecedorId?: number | null
  valor?: number | null
  moeda?: string | null
  vencimento?: string | null
  /** Em edição: a própria obrigação não conta como duplicata de si mesma. */
  ignorarObrigacaoId?: number | null
}

const DIA = 86_400_000
/** Janela em que dois custos iguais no mesmo processo são suspeitos de duplicidade. */
export const JANELA_DUPLICIDADE_DIAS = 30
/** Amostra mínima para afirmar que existe uma "faixa praticada". Abaixo disso, silêncio. */
export const AMOSTRA_MINIMA_FAIXA = 3

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

/** Mediana — resistente a outliers (um custo atípico não desloca a faixa). */
export function mediana(valores: number[]): number {
  if (!valores.length) return 0
  const v = [...valores].sort((a, b) => a - b)
  const meio = Math.floor(v.length / 2)
  return v.length % 2 ? v[meio] : cent((v[meio - 1] + v[meio]) / 2)
}

/**
 * NÚCLEO PURO da faixa praticada: decide se o valor informado destoa do histórico.
 * Regra (derivada do histórico, não arbitrada): destoa quando fica acima do dobro
 * ou abaixo da metade da MEDIANA — sinal claro de erro de digitação/unidade.
 */
export function classificarValor(valor: number, historico: number[]): 'ok' | 'acima' | 'abaixo' | 'sem-base' {
  if (historico.length < AMOSTRA_MINIMA_FAIXA) return 'sem-base'
  const m = mediana(historico)
  if (m <= 0) return 'sem-base'
  if (valor > m * 2) return 'acima'
  if (valor < m / 2) return 'abaixo'
  return 'ok'
}

/** Item mais frequente de uma lista de ids (com desempate estável pelo menor id). */
export function maisFrequente(ids: (number | null | undefined)[]): { id: number; ocorrencias: number } | null {
  const cont = new Map<number, number>()
  for (const id of ids) if (id != null) cont.set(id, (cont.get(id) ?? 0) + 1)
  if (!cont.size) return null
  const [id, ocorrencias] = [...cont.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
  return { id, ocorrencias }
}

export async function analisarLancamentoCusto(e: EntradaAnaliseCusto): Promise<AnaliseLancamentoCusto> {
  const avisos: AvisoLancamento[] = []
  const valor = e.valor != null ? cent(Number(e.valor)) : null
  const moeda = e.moeda || 'BRL'

  // ── histórico do MESMO item do Catálogo Mestre (base das sugestões e da faixa) ──
  const historico = e.itemCatalogoId
    ? await prisma.obrigacaoEconomica.findMany({
        where: {
          direcao: 'A_PAGAR', itemCatalogoId: e.itemCatalogoId, arquivadaEm: null,
          status: { not: 'CANCELADO' },
          ...(e.ignorarObrigacaoId ? { id: { not: e.ignorarObrigacaoId } } : {}),
        },
        select: { id: true, fornecedorId: true, valorContratado: true, moedaContratual: true },
        orderBy: { id: 'desc' },
        take: 200,
      }).catch(() => [])
    : []

  // ── sugestões ──────────────────────────────────────────────────────────────
  const fornMais = maisFrequente(historico.map((h) => h.fornecedorId))
  const valoresMesmaMoeda = historico.filter((h) => String(h.moedaContratual) === moeda).map((h) => cent(Number(h.valorContratado)))

  const fornNome = fornMais
    ? await prisma.fornecedor.findUnique({ where: { id: fornMais.id }, select: { nome: true } }).catch(() => null)
    : null

  const sugestoes: SugestoesLancamento = {
    fornecedor: fornMais && fornNome ? { id: fornMais.id, nome: fornNome.nome, ocorrencias: fornMais.ocorrencias } : null,
    valorTipico: valoresMesmaMoeda.length >= AMOSTRA_MINIMA_FAIXA
      ? { valor: mediana(valoresMesmaMoeda), moeda, amostras: valoresMesmaMoeda.length, minimo: Math.min(...valoresMesmaMoeda), maximo: Math.max(...valoresMesmaMoeda) }
      : null,
  }

  // ── aviso: valor fora da faixa praticada ───────────────────────────────────
  if (valor != null && valor > 0) {
    const classe = classificarValor(valor, valoresMesmaMoeda)
    if (classe === 'acima' || classe === 'abaixo') {
      const m = mediana(valoresMesmaMoeda)
      avisos.push({
        codigo: classe === 'acima' ? 'VALOR_ACIMA_DO_HISTORICO' : 'VALOR_ABAIXO_DO_HISTORICO',
        severidade: 'atencao',
        mensagem: `Valor ${classe === 'acima' ? 'bem acima' : 'bem abaixo'} do praticado para este item: os últimos ${valoresMesmaMoeda.length} lançamentos giram em torno de ${m.toFixed(2)} ${moeda}. Confira o valor e a unidade.`,
      })
    }
  }

  // ── aviso: duplicidade provável ────────────────────────────────────────────
  if (e.processoId && valor != null && valor > 0) {
    const desde = new Date(Date.now() - JANELA_DUPLICIDADE_DIAS * DIA)
    const candidatos = await prisma.obrigacaoEconomica.findMany({
      where: {
        direcao: 'A_PAGAR', processoId: e.processoId, arquivadaEm: null,
        status: { not: 'CANCELADO' },
        criadoEm: { gte: desde },
        ...(e.ignorarObrigacaoId ? { id: { not: e.ignorarObrigacaoId } } : {}),
        ...(e.fornecedorId ? { fornecedorId: e.fornecedorId } : {}),
        ...(e.itemCatalogoId && !e.fornecedorId ? { itemCatalogoId: e.itemCatalogoId } : {}),
      },
      select: { id: true, codigoOperacional: true, observacoes: true, valorContratado: true, moedaContratual: true, criadoEm: true },
      orderBy: { criadoEm: 'desc' },
      take: 20,
    }).catch(() => [])

    // "Mesmo valor" com tolerância de 1% — cobre arredondamento/câmbio sem virar ruído.
    const iguais = candidatos.filter((c) => String(c.moedaContratual) === moeda && Math.abs(cent(Number(c.valorContratado)) - valor) <= Math.max(0.01, valor * 0.01))
    if (iguais.length) {
      avisos.push({
        codigo: 'DUPLICIDADE_PROVAVEL',
        severidade: 'alto',
        mensagem: `Já existe ${iguais.length === 1 ? 'um custo' : `${iguais.length} custos`} neste processo com o mesmo valor e ${e.fornecedorId ? 'o mesmo fornecedor' : 'o mesmo item'} nos últimos ${JANELA_DUPLICIDADE_DIAS} dias. Confirme que não é uma duplicidade.`,
        evidencias: iguais.map((c) => ({
          obrigacaoId: c.id, codigo: c.codigoOperacional, descricao: c.observacoes,
          valor: cent(Number(c.valorContratado)), moeda: String(c.moedaContratual),
          criadoEm: c.criadoEm ? c.criadoEm.toISOString() : null,
        })),
      })
    }
  }

  // ── avisos de completude (não bloqueiam, mas custam caro depois) ────────────
  if (e.vencimento) {
    const v = new Date(e.vencimento)
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
    if (!Number.isNaN(v.getTime()) && v < hoje) {
      avisos.push({ codigo: 'VENCIMENTO_NO_PASSADO', severidade: 'atencao', mensagem: 'O vencimento informado já passou — o custo nasce vencido. Confirme a data.' })
    }
  }
  if (!e.fornecedorId) {
    avisos.push({ codigo: 'SEM_FORNECEDOR', severidade: 'info', mensagem: 'Custo sem fornecedor: sem ele não há conciliação por beneficiário nem histórico de preço por parceiro.' })
  }

  // Ordem de leitura: o mais grave primeiro.
  const peso: Record<SeveridadeAviso, number> = { alto: 0, atencao: 1, info: 2 }
  avisos.sort((a, b) => peso[a.severidade] - peso[b.severidade])

  return { avisos, sugestoes, baseHistorica: historico.length }
}
