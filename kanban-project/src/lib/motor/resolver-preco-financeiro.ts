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

// ── Tipos de dados (espelham TabelaValor de hoje, mas desacoplados do Prisma) ──

/** Uma linha de preço candidata (subset de TabelaValor relevante à resolução). */
export interface LinhaPreco {
  id: number
  valor: number
  moeda: Moeda
  modoCalculo?: string | null // "fixed" (default) | "per_unit"/"unit"/"por_unidade"
  natureza: NaturezaPreco | null
  arquivado?: boolean
  // dimensões de precedência (hoje texto/int soltos; viram FK em M2/M3)
  processoId?: number | null
  processoTipoId?: string | null // tipo de processo / nacionalidade
  regiao?: string | null // país/região/localidade
  fornecedorId?: number | null
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

export type NivelPreco =
  | 'processo'
  | 'tipoProcesso'
  | 'regiao'
  | 'fornecedor'
  | 'global'
  | 'fallback_padrao'

export type MotivoDescarte =
  | 'valor_zero_ou_negativo'
  | 'fora_de_vigencia'
  | 'natureza_diferente'
  | 'arquivada'
  | 'perdeu_precedencia'
  | 'nao_casa_contexto'

export type MotivoFalha =
  | 'NENHUMA_LINHA'
  | 'SEM_PRECO_VALIDO' // havia linhas, mas todas zero/inválidas/fora de vigência/contexto
  | 'ITEM_INVALIDO'

export interface AlternativaDescartada {
  tabelaValorId: number
  nivel: NivelPreco | 'indefinido'
  motivo: MotivoDescarte
  valor: number
}

/** Preços VÁLIDOS concorrentes no MESMO nível (mesma especificidade) que divergem
 *  em valor/moeda da linha escolhida — ambiguidade a revisar (Fase 7: transparência). */
export interface ConflitoPreco {
  nivel: NivelPreco
  competidores: { tabelaValorId: number; valor: number; moeda: Moeda }[]
  nota: string
}

export interface ResultadoPrecoOK {
  ok: true
  valor: number // já aplicado modoCalculo/quantidade
  valorUnitario: number
  moeda: Moeda
  nivel: NivelPreco // "regra utilizada"
  prioridade: number // 1 = mais específico … 6 = fallback
  especificidade: number // nº de dimensões de contexto que a linha casou
  tabelaValorId: number | null // null quando veio do fallback_padrao
  razao: string
  moedaDivergente: boolean // true se ctx.moeda != moeda resolvida (sem câmbio aqui)
  conflito?: ConflitoPreco // presente quando há ambiguidade no nível escolhido
  alternativasDescartadas: AlternativaDescartada[]
}

export interface ResultadoPrecoFalha {
  ok: false
  motivo: MotivoFalha
  razao: string
  alternativasDescartadas: AlternativaDescartada[]
}

export type ResultadoPreco = ResultadoPrecoOK | ResultadoPrecoFalha

// Prioridade numérica por nível (1 = mais específico).
const PRIORIDADE: Record<NivelPreco, number> = {
  processo: 1,
  tipoProcesso: 2,
  regiao: 3,
  fornecedor: 4,
  global: 5,
  fallback_padrao: 6,
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// hoje === null → sem restrição de data (não filtra vigência). Evita usar um
// sentinela enganoso (ex.: 1970) que rejeitaria tudo. O wrapper com banco
// sempre injeta a data corrente; o core exige data explícita p/ ser puro.
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

// desempate determinístico DENTRO de um nível (nunca "o primeiro da query"):
// vigência mais recente primeiro (vigenciaInicio desc), depois id desc (mais novo).
function ordenarPorEspecificidade(rows: LinhaPreco[]): LinhaPreco[] {
  return [...rows].sort((a, b) => {
    const va = a.vigenciaInicio ?? ''
    const vb = b.vigenciaInicio ?? ''
    if (va !== vb) return va < vb ? 1 : -1
    return b.id - a.id
  })
}

function ehPerUnit(modo?: string | null): boolean {
  if (!modo) return false
  const m = modo.toLowerCase()
  return m === 'per_unit' || m === 'unit' || m === 'por_unidade' || m === 'quantidade'
}

/**
 * Núcleo PURO da resolução — sem Prisma, sem I/O. Recebe as linhas candidatas
 * já carregadas e devolve o resultado com auditoria completa. Testável offline.
 */
export function resolverPrecoCore(
  linhas: LinhaPreco[],
  ctx: ContextoPrecoFinanceiro,
): ResultadoPreco {
  const descartadas: AlternativaDescartada[] = []
  const quantidade = ctx.quantidade == null || ctx.quantidade <= 0 ? 1 : ctx.quantidade
  const tipoProcessoStr = ctx.tipoProcessoId == null ? null : String(ctx.tipoProcessoId)
  const hoje = ctx.dataEvento ? ymd(ctx.dataEvento) : null // null = sem restrição de vigência (core puro)

  // 1) Filtra por natureza + arquivamento + vigência, registrando descartes.
  const candidatas: LinhaPreco[] = []
  for (const r of linhas) {
    if (ctx.natureza != null && r.natureza !== ctx.natureza) {
      descartadas.push({ tabelaValorId: r.id, nivel: 'indefinido', motivo: 'natureza_diferente', valor: r.valor })
      continue
    }
    if (r.arquivado) {
      descartadas.push({ tabelaValorId: r.id, nivel: 'indefinido', motivo: 'arquivada', valor: r.valor })
      continue
    }
    if (!dentroDaVigencia(r, hoje)) {
      descartadas.push({ tabelaValorId: r.id, nivel: 'indefinido', motivo: 'fora_de_vigencia', valor: r.valor })
      continue
    }
    candidatas.push(r)
  }

  // 2) Precedência: do mais específico ao global. Cada nível encontra a 1ª linha
  //    que casa AQUELA dimensão; valor<=0 é descartado (B2) e o nível segue
  //    procurando a próxima linha válida.
  const niveis: { nome: NivelPreco; casa: (r: LinhaPreco) => boolean; especificidade: (r: LinhaPreco) => number }[] = [
    {
      nome: 'processo',
      casa: (r) => ctx.processoId != null && r.processoId === ctx.processoId,
      especificidade: () => 4,
    },
    {
      nome: 'tipoProcesso',
      casa: (r) => tipoProcessoStr != null && r.processoTipoId === tipoProcessoStr,
      especificidade: () => 3,
    },
    {
      nome: 'regiao',
      casa: (r) => ctx.regiao != null && r.regiao === ctx.regiao,
      especificidade: () => 2,
    },
    {
      nome: 'fornecedor',
      casa: (r) => ctx.fornecedorId != null && r.fornecedorId === ctx.fornecedorId,
      especificidade: () => 1,
    },
    {
      nome: 'global',
      casa: (r) => r.processoId == null && r.processoTipoId == null && r.regiao == null && r.fornecedorId == null,
      especificidade: () => 0,
    },
  ]

  for (const nivel of niveis) {
    const doNivel = ordenarPorEspecificidade(candidatas.filter(nivel.casa))
    let escolhida: LinhaPreco | null = null
    for (const r of doNivel) {
      if (!precoValido(r.valor)) {
        descartadas.push({ tabelaValorId: r.id, nivel: nivel.nome, motivo: 'valor_zero_ou_negativo', valor: r.valor })
        continue
      }
      escolhida = r
      break
    }
    if (escolhida) {
      // conflito = preços VÁLIDOS no MESMO nível que divergem em valor/moeda.
      const competidores = doNivel.filter(
        (r) => r.id !== escolhida!.id && precoValido(r.valor) && (r.valor !== escolhida!.valor || r.moeda !== escolhida!.moeda),
      )
      const conflito: ConflitoPreco | undefined = competidores.length
        ? {
            nivel: nivel.nome,
            competidores: competidores.map((r) => ({ tabelaValorId: r.id, valor: r.valor, moeda: r.moeda })),
            nota: `${competidores.length} preço(s) concorrente(s) no nível "${nivel.nome}"; escolha determinística (vigência recente, depois id) — revisar ambiguidade`,
          }
        : undefined
      // marca as demais candidatas válidas de níveis inferiores como "perdeu precedência"
      registrarPerdaDePrecedencia(candidatas, escolhida, descartadas)
      const perUnit = ehPerUnit(escolhida.modoCalculo)
      const valorFinal = perUnit ? escolhida.valor * quantidade : escolhida.valor
      const moedaDivergente = ctx.moeda != null && ctx.moeda !== escolhida.moeda
      return {
        ok: true,
        valor: valorFinal,
        valorUnitario: escolhida.valor,
        moeda: escolhida.moeda,
        nivel: nivel.nome,
        prioridade: PRIORIDADE[nivel.nome],
        especificidade: nivel.especificidade(escolhida),
        tabelaValorId: escolhida.id,
        razao: `Preço de ${ctx.natureza} resolvido no nível "${nivel.nome}" (prioridade ${PRIORIDADE[nivel.nome]})`
          + (perUnit ? `, modo per_unit × ${quantidade}` : '')
          + (conflito ? `; ⚠ ${conflito.competidores.length} concorrente(s) no mesmo nível` : '')
          + (moedaDivergente ? `; ATENÇÃO: moeda desejada ${ctx.moeda} ≠ ${escolhida.moeda} (sem conversão aqui)` : ''),
        moedaDivergente,
        conflito,
        alternativasDescartadas: descartadas,
      }
    }
  }

  // 3) Fallback EXPLÍCITO (nível 5 da spec) — só se finito e > 0.
  if (ctx.fallbackValorPadrao != null && precoValido(ctx.fallbackValorPadrao)) {
    const perUnitN = false // fallback é sempre valor cheio
    void perUnitN
    return {
      ok: true,
      valor: ctx.fallbackValorPadrao,
      valorUnitario: ctx.fallbackValorPadrao,
      moeda: ctx.fallbackMoeda ?? ctx.moeda ?? Moeda.BRL,
      nivel: 'fallback_padrao',
      prioridade: PRIORIDADE.fallback_padrao,
      especificidade: 0,
      tabelaValorId: null,
      razao: 'Nenhuma linha de TabelaValor casou; usando fallback explícito (valorPadrao da configuração)',
      moedaDivergente: false,
      alternativasDescartadas: descartadas,
    }
  }

  // 4) Falha CLARA (Fase 7, item 6) — nunca zero silencioso.
  const houveZeros = descartadas.some((d) => d.motivo === 'valor_zero_ou_negativo')
  return finalizarFalha(houveZeros ? 'SEM_PRECO_VALIDO' : 'NENHUMA_LINHA', descartadas, ctx)
}

function registrarPerdaDePrecedencia(
  candidatas: LinhaPreco[],
  escolhida: LinhaPreco,
  descartadas: AlternativaDescartada[],
): void {
  for (const r of candidatas) {
    if (r.id === escolhida.id) continue
    if (!precoValido(r.valor)) continue // já vira/virou descarte por zero em outro ponto
    if (descartadas.some((d) => d.tabelaValorId === r.id)) continue
    descartadas.push({ tabelaValorId: r.id, nivel: 'indefinido', motivo: 'perdeu_precedencia', valor: r.valor })
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
