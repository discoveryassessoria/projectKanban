// src/lib/motor/resolver-preco-financeiro.ts
// ============================================================================
// FASE 7 — RESOLUÇÃO DE PREÇO (serviço canônico ÚNICO), versão endurecida.
// ----------------------------------------------------------------------------
// Reaproveita a precedência do `pricing-resolver.ts` existente, mas corrige os
// bugs de arquitetura achados na auditoria (docs/auditoria-refatoracao-financeiro.md):
//
//   B2 — ZERO SILENCIOSO: uma linha de preço com `valor <= 0` (ex.: seeds
//        "[AJUSTAR]") NÃO é um preço válido. O resolver antigo devolvia {valor:0}
//        e contabilizava um lançamento de 0,00. Aqui, valor<=0 é descartado com
//        motivo explícito e NUNCA vira preço.
//   B1 — o vínculo PRINCIPAL do item é sempre por FK (itemCatalogoId). As demais
//        dimensões de contexto (tipoProcesso/região) ainda são texto no schema de
//        hoje; quando os lotes M2/M3 aplicarem as FKs, só troca o comparador.
//
// Garantias da Fase 7:
//   • nunca retorna zero silenciosamente;
//   • nunca usa "o primeiro registro" sem precedência;
//   • nunca casa por nome; o item é sempre por id (FK);
//   • resultado informa: preço, moeda, regra usada, prioridade, especificidade,
//     razão da escolha e alternativas descartadas.
//
// Este arquivo é ADITIVO: não altera schema, não escreve no banco, não substitui
// `pricing-resolver.ts` (a troca dos callers é um lote posterior, coordenado).
// O núcleo (`resolverPrecoCore`) é PURO e testável sem banco (ver
// scripts/resolver-preco-financeiro.test.ts).
// ============================================================================

import { Moeda, NaturezaPreco } from '@prisma/client'
import { canonicalNaturezaPreco } from '@/lib/financeiro/natureza-financeira'

// ── Tipos de dados (espelham TabelaValor de hoje, mas desacoplados do Prisma) ──

/** Uma linha de preço candidata (subset de TabelaValor relevante à resolução). */
export interface LinhaPreco {
  id: number
  valor: number
  moeda: Moeda
  modoCalculo?: string | null // "fixed" (default) | "per_unit"/"unit"/"por_unidade"
  natureza: NaturezaPreco | null
  arquivado?: boolean
  prioridade?: number | null // desempate EXPLÍCITO (só após especificidade)
  // dimensões de contexto (§2 — cada uma preenchida+compatível soma especificidade)
  processoId?: number | null
  processoTipoId?: string | null // tipo de processo
  modalidadeId?: number | null // modalidade
  regiao?: string | null // nacionalidade / país / região / localidade
  fornecedorId?: number | null
  quantidadeMinima?: number | null
  quantidadeMaxima?: number | null
  vigenciaInicio?: string | null // 'YYYY-MM-DD'
  vigenciaFim?: string | null // 'YYYY-MM-DD'
}

/** Contexto de resolução (Fase 7 — entrada estruturada). */
export interface ContextoPrecoFinanceiro {
  itemCatalogoId: number // FK — vínculo do item (ou o configId, ao resolver por Configuração Financeira)
  natureza?: NaturezaPreco | null // opcional: ao resolver por config, o papel já é o da config (não filtra)
  processoId?: number | null
  tipoProcessoId?: string | number | null // aceita id numérico ou key; normalizado p/ string
  modalidadeId?: string | number | null // reservado (vira dimensão quando houver FK)
  fornecedorId?: number | null
  regiao?: string | null // localidade/país/região
  moeda?: Moeda | null // moeda desejada (validação; NÃO faz câmbio aqui)
  quantidade?: number // default 1 (usado se modoCalculo = per_unit)
  dataEvento?: Date // p/ vigência (default: passado pelo caller — sem Date.now no core)
  fase?: string | null // contexto (não é dimensão de preço; vai p/ auditoria)
  passo?: string | null // idem
  /**
   * Fallback EXPLÍCITO (Fase 7, nível 5): ex.: ProdutoFinanceiro.valorPadrao.
   * Só é usado se > 0. Se ausente/<=0 e nada casar, o resultado é ok:false
   * (erro claro), nunca um zero silencioso.
   */
  fallbackValorPadrao?: number | null
  fallbackMoeda?: Moeda | null
}

export type MotivoDescarte =
  | 'valor_zero_ou_negativo'
  | 'fora_de_vigencia'
  | 'natureza_diferente'
  | 'arquivada'
  | 'incompativel_contexto' // linha exige uma dimensão que o contexto não satisfaz
  | 'menor_especificidade' // compatível, mas perdeu para uma linha mais específica/prioritária

export type MotivoFalha =
  | 'NENHUMA_LINHA'
  | 'SEM_PRECO_VALIDO' // havia linhas, mas todas zero/inválidas/fora de vigência/contexto
  | 'ITEM_INVALIDO'

export interface AlternativaDescartada {
  tabelaValorId: number
  nivel: string
  motivo: MotivoDescarte
  valor: number
}

/** Preços VÁLIDOS empatados (mesma especificidade E prioridade) que divergem em
 *  valor/moeda — AMBIGUIDADE que BLOQUEIA a geração (§2). */
export interface ConflitoPreco {
  nivel: string // "especificidade N · prioridade P"
  competidores: { tabelaValorId: number; valor: number; moeda: Moeda }[]
  nota: string
}

export interface ResultadoPrecoOK {
  ok: true
  valor: number // já aplicado modoCalculo/quantidade
  valorUnitario: number
  quantidade: number // quantidade usada no cálculo (1 quando fixo)
  modoCalculo: string // modo de cálculo aplicado (congelado no lançamento)
  moeda: Moeda
  nivel: string // descrição da regra escolhida (especificidade/prioridade)
  prioridade: number // prioridade EXPLÍCITA da linha escolhida (desempate final)
  especificidade: number // nº de dimensões de contexto PREENCHIDAS+compatíveis
  tabelaValorId: number | null
  razao: string
  moedaDivergente: boolean // true se ctx.moeda != moeda resolvida (sem câmbio aqui)
  conflito?: ConflitoPreco // presente quando há AMBIGUIDADE (empate) → motor bloqueia
  alternativasDescartadas: AlternativaDescartada[]
}

export interface ResultadoPrecoFalha {
  ok: false
  motivo: MotivoFalha
  razao: string
  alternativasDescartadas: AlternativaDescartada[]
}

export type ResultadoPreco = ResultadoPrecoOK | ResultadoPrecoFalha

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function dentroDaVigencia(r: LinhaPreco, hoje: string | null): boolean {
  if (hoje == null) return true
  if (r.vigenciaInicio && hoje < r.vigenciaInicio) return false
  if (r.vigenciaFim && hoje > r.vigenciaFim) return false
  return true
}

// preço válido = número finito estritamente positivo (pega NaN/Infinity/<=0).
function precoValido(v: number): boolean {
  return Number.isFinite(v) && v > 0
}

function ehPerUnit(modo?: string | null): boolean {
  if (!modo) return false
  const m = modo.toLowerCase()
  return m === 'per_unit' || m === 'unit' || m === 'por_unidade' || m === 'quantidade'
}

// ── §2 DIMENSÕES DE CONTEXTO ─────────────────────────────────────────────────
// Cada dimensão é: "a linha RESTRINGE esta dimensão?" (preenchida) e "a linha é
// COMPATÍVEL com o contexto nesta dimensão?" (compativel). Uma linha só concorre se
// é compatível em TODAS. A especificidade = nº de dimensões preenchidas (todas já
// compatíveis ⇒ casaram um valor real do contexto). Sem escada fixa: quem tem MAIS
// critérios reais casados vence; prioridade explícita só desempata; empate = conflito.
interface DimCtx {
  processoId?: number | null
  tipoProcesso?: string | null
  modalidadeId?: number | null
  regiao?: string | null
  fornecedorId?: number | null
  quantidade: number
}
interface Dimensao {
  nome: string
  preenchida: (r: LinhaPreco) => boolean
  compativel: (r: LinhaPreco, c: DimCtx) => boolean
}
const DIMENSOES: Dimensao[] = [
  { nome: 'processo', preenchida: (r) => r.processoId != null, compativel: (r, c) => r.processoId == null || (c.processoId != null && r.processoId === c.processoId) },
  { nome: 'tipoProcesso', preenchida: (r) => r.processoTipoId != null, compativel: (r, c) => r.processoTipoId == null || (c.tipoProcesso != null && r.processoTipoId === c.tipoProcesso) },
  { nome: 'modalidade', preenchida: (r) => r.modalidadeId != null, compativel: (r, c) => r.modalidadeId == null || (c.modalidadeId != null && r.modalidadeId === c.modalidadeId) },
  { nome: 'regiao', preenchida: (r) => r.regiao != null, compativel: (r, c) => r.regiao == null || (c.regiao != null && r.regiao === c.regiao) },
  { nome: 'fornecedor', preenchida: (r) => r.fornecedorId != null, compativel: (r, c) => r.fornecedorId == null || (c.fornecedorId != null && r.fornecedorId === c.fornecedorId) },
  {
    nome: 'quantidade',
    preenchida: (r) => r.quantidadeMinima != null || r.quantidadeMaxima != null,
    compativel: (r, c) => {
      const lo = r.quantidadeMinima == null ? -Infinity : r.quantidadeMinima
      const hi = r.quantidadeMaxima == null ? Infinity : r.quantidadeMaxima
      return c.quantidade >= lo && c.quantidade <= hi
    },
  },
]

function especificidadeDe(r: LinhaPreco): number {
  return DIMENSOES.reduce((n, d) => n + (d.preenchida(r) ? 1 : 0), 0)
}

/**
 * Núcleo PURO da resolução por ESPECIFICIDADE (§2). Sem Prisma, sem I/O.
 * Ordem: 1) compatibilidade com o contexto real; 2) maior especificidade;
 * 3) maior prioridade explícita; 4) empate residual ⇒ AMBIGUIDADE (bloqueia).
 * Nunca zero silencioso; nunca fallback de campo legado.
 */
export function resolverPrecoCore(
  linhas: LinhaPreco[],
  ctx: ContextoPrecoFinanceiro,
): ResultadoPreco {
  const descartadas: AlternativaDescartada[] = []
  const quantidade = ctx.quantidade == null || ctx.quantidade <= 0 ? 1 : ctx.quantidade
  const dimCtx: DimCtx = {
    processoId: ctx.processoId ?? null,
    tipoProcesso: ctx.tipoProcessoId == null ? null : String(ctx.tipoProcessoId),
    modalidadeId: ctx.modalidadeId == null ? null : Number(ctx.modalidadeId),
    regiao: ctx.regiao ?? null,
    fornecedorId: ctx.fornecedorId ?? null,
    quantidade,
  }
  const hoje = ctx.dataEvento ? ymd(ctx.dataEvento) : null

  // 1) Filtro base: natureza (canônica de PREÇO) + arquivamento + vigência + valor>0
  //    + compatibilidade de contexto em TODAS as dimensões.
  const natCtx = ctx.natureza == null ? null : canonicalNaturezaPreco(ctx.natureza)
  const aplicaveis: { r: LinhaPreco; especificidade: number }[] = []
  for (const r of linhas) {
    if (natCtx != null && canonicalNaturezaPreco(r.natureza) !== natCtx) { descartadas.push({ tabelaValorId: r.id, nivel: '—', motivo: 'natureza_diferente', valor: r.valor }); continue }
    if (r.arquivado) { descartadas.push({ tabelaValorId: r.id, nivel: '—', motivo: 'arquivada', valor: r.valor }); continue }
    if (!dentroDaVigencia(r, hoje)) { descartadas.push({ tabelaValorId: r.id, nivel: '—', motivo: 'fora_de_vigencia', valor: r.valor }); continue }
    if (!precoValido(r.valor)) { descartadas.push({ tabelaValorId: r.id, nivel: '—', motivo: 'valor_zero_ou_negativo', valor: r.valor }); continue }
    const incompat = DIMENSOES.find((d) => !d.compativel(r, dimCtx))
    if (incompat) { descartadas.push({ tabelaValorId: r.id, nivel: incompat.nome, motivo: 'incompativel_contexto', valor: r.valor }); continue }
    aplicaveis.push({ r, especificidade: especificidadeDe(r) })
  }

  if (aplicaveis.length === 0) {
    const houveZeros = descartadas.some((d) => d.motivo === 'valor_zero_ou_negativo')
    return finalizarFalha(houveZeros ? 'SEM_PRECO_VALIDO' : 'NENHUMA_LINHA', descartadas, ctx)
  }

  // 2) Maior especificidade → 3) maior prioridade explícita.
  const maxEspec = Math.max(...aplicaveis.map((a) => a.especificidade))
  const naEspec = aplicaveis.filter((a) => a.especificidade === maxEspec)
  const maxPrio = Math.max(...naEspec.map((a) => a.r.prioridade ?? 0))
  const topo = naEspec.filter((a) => (a.r.prioridade ?? 0) === maxPrio)

  // marca todo o resto como descartado por menor especificidade/prioridade
  for (const a of aplicaveis) if (!topo.includes(a)) descartadas.push({ tabelaValorId: a.r.id, nivel: `espec ${a.especificidade}`, motivo: 'menor_especificidade', valor: a.r.valor })

  // desempate determinístico dentro do topo (vigência recente, depois id)
  const ordenado = [...topo].sort((x, y) => {
    const vx = x.r.vigenciaInicio ?? '', vy = y.r.vigenciaInicio ?? ''
    if (vx !== vy) return vx < vy ? 1 : -1
    return y.r.id - x.r.id
  })
  const escolhida = ordenado[0].r

  // 4) AMBIGUIDADE: ≥2 no topo que DIVERGEM em valor/moeda → conflito (bloqueia).
  const competidores = topo.filter((a) => a.r.id !== escolhida.id && (a.r.valor !== escolhida.valor || a.r.moeda !== escolhida.moeda))
  const conflito: ConflitoPreco | undefined = competidores.length
    ? {
        nivel: `especificidade ${maxEspec} · prioridade ${maxPrio}`,
        competidores: competidores.map((a) => ({ tabelaValorId: a.r.id, valor: a.r.valor, moeda: a.r.moeda })),
        nota: `AMBIGUIDADE: ${competidores.length + 1} preços com mesma especificidade (${maxEspec}) e prioridade (${maxPrio}) divergem em valor/moeda — resolva antes de gerar. Regras: [${[escolhida.id, ...competidores.map((a) => a.r.id)].join(', ')}]`,
      }
    : undefined

  const perUnit = ehPerUnit(escolhida.modoCalculo)
  const valorFinal = perUnit ? escolhida.valor * quantidade : escolhida.valor
  const moedaDivergente = ctx.moeda != null && ctx.moeda !== escolhida.moeda
  return {
    ok: true,
    valor: valorFinal,
    valorUnitario: escolhida.valor,
    quantidade: perUnit ? quantidade : 1,
    modoCalculo: escolhida.modoCalculo ?? 'fixed',
    moeda: escolhida.moeda,
    nivel: `especificidade ${maxEspec} · prioridade ${maxPrio}`,
    prioridade: escolhida.prioridade ?? 0,
    especificidade: maxEspec,
    tabelaValorId: escolhida.id,
    razao: `Preço resolvido por especificidade ${maxEspec} (prioridade ${maxPrio})`
      + (perUnit ? `, modo per_unit × ${quantidade}` : '')
      + (conflito ? '; ⚠ AMBIGUIDADE (empate) — bloquear' : '')
      + (moedaDivergente ? `; ATENÇÃO: moeda desejada ${ctx.moeda} ≠ ${escolhida.moeda} (sem conversão aqui)` : ''),
    moedaDivergente,
    conflito,
    alternativasDescartadas: descartadas,
  }
}

function finalizarFalha(
  motivo: MotivoFalha,
  descartadas: AlternativaDescartada[],
  ctx: ContextoPrecoFinanceiro,
): ResultadoPrecoFalha {
  const razaoBase =
    motivo === 'NENHUMA_LINHA'
      ? `Sem preço configurado para item ${ctx.itemCatalogoId} / ${ctx.natureza}`
      : `Existem linhas para item ${ctx.itemCatalogoId} / ${ctx.natureza}, mas nenhuma é um preço válido (>0, vigente e compatível)`
  return {
    ok: false,
    motivo,
    razao: `${razaoBase}. NÃO foi contabilizado zero (Fase 7).`,
    alternativasDescartadas: descartadas,
  }
}

// ── Wrapper com banco (thin) ─────────────────────────────────────────────────
// Mantém o core puro. Injeção de dependência p/ testes: aceita um loader.

export interface CarregadorLinhasPreco {
  (itemCatalogoId: number, natureza: NaturezaPreco | null | undefined): Promise<LinhaPreco[]>
}

/**
 * Serviço canônico de resolução de preço (Fase 7). Carrega as linhas via
 * `carregar` (por padrão, Prisma) e delega ao núcleo puro.
 *
 * NOTA: `dataEvento` deve ser fornecido pelo caller (o core não chama Date.now).
 */
export async function resolverPrecoFinanceiro(
  ctx: ContextoPrecoFinanceiro,
  carregar: CarregadorLinhasPreco,
): Promise<ResultadoPreco> {
  if (!Number.isInteger(ctx.itemCatalogoId) || ctx.itemCatalogoId <= 0) {
    return { ok: false, motivo: 'ITEM_INVALIDO', razao: 'itemCatalogoId ausente ou inválido', alternativasDescartadas: [] }
  }
  const linhas = await carregar(ctx.itemCatalogoId, ctx.natureza)
  // fronteira impura: se o caller não deu data, usa a corrente (o core é puro).
  const ctxComData: ContextoPrecoFinanceiro = { ...ctx, dataEvento: ctx.dataEvento ?? new Date() }
  return resolverPrecoCore(linhas, ctxComData)
}

// ── Adaptador de compatibilidade (drop-in do resolverPreco legado) ───────────
// Mesmo shape do `pricing-resolver.ts` antigo ({valor,moeda,nivel,tabelaValorId}
// ou null). Permite trocar o caller sem mudar comportamento — EXCETO o fix B2
// (linha com valor<=0 agora vira null/skip em vez de {valor:0}). O fallback
// explícito NÃO é exposto aqui (retorna null) p/ preservar a lógica de
// valorPadrao que o caller legado já aplica.
export interface PrecoResolvidoCompat {
  valor: number
  moeda: Moeda
  nivel: string
  tabelaValorId: number
}

export function paraCompat(res: ResultadoPreco): PrecoResolvidoCompat | null {
  if (!res.ok) return null
  if (res.tabelaValorId == null) return null // veio do fallback: caller legado trata valorPadrao
  return { valor: res.valor, moeda: res.moeda, nivel: res.nivel, tabelaValorId: res.tabelaValorId }
}

/**
 * Conveniência: resolve CUSTO e RECEITA juntos (independentes), como o
 * `resolverCustoEReceita` legado — mas com o comportamento endurecido.
 */
export async function resolverCustoEReceitaFinanceiro(
  base: Omit<ContextoPrecoFinanceiro, 'natureza'>,
  carregar: CarregadorLinhasPreco,
): Promise<{ custo: ResultadoPreco; receita: ResultadoPreco }> {
  const [custo, receita] = await Promise.all([
    resolverPrecoFinanceiro({ ...base, natureza: NaturezaPreco.CUSTO }, carregar),
    resolverPrecoFinanceiro({ ...base, natureza: NaturezaPreco.RECEITA }, carregar),
  ])
  return { custo, receita }
}
