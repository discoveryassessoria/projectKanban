// lib/operacional/ordem-certidoes.ts
// ============================================================================
// REGRA FIXA DE ORDEM DAS CERTIDÕES (06/10/2026) — a ÚNICA ordem possível dentro de uma família, para TODA lista e exportação do sistema
// (Torre: Tarefas, Processos, Minha operação, Radar, Relatório de controle, Histórico; Operação; página do processo; aba Documentos; CSV/Excel/PDF).
//
// Dentro de uma mesma FAMÍLIA:
//   1. GERAÇÃO: G1 primeiro, depois G2, G3… — a geração DE VERDADE, calculada pela filiação (`src/lib/genealogia/geracao.ts`: G1 = o ancestral que
//      origina o direito, filhos G2…). O cônjuge fica na geração do parceiro. NUNCA `numeroLinhagem` (é um número de sequência: irmãos diferem).
//   2. Dentro da geração: LINHA RETA antes de fora da linha; depois ORDEM DE NASCIMENTO da pessoa.
//   3. Dentro da pessoa: NASCIMENTO, CASAMENTO, ÓBITO, depois os outros documentos.
// Risco, prazo, status ou criação NUNCA reordenam certidões dentro da família: só decidem a ordem ENTRE famílias (e o "Ordenar por" da Torre).
// Lista que não está agrupada por família: aplica-se família → a regra acima (`ordenarListaPorFamilia`).
//
// Esta é a única função de comparação: nenhuma lista tem ordenação própria de certidão. O teste `ordem-certidoes-todas-as-listas` trava isso.
// ============================================================================

export type CategoriaDaCertidao = 'NASCIMENTO' | 'CASAMENTO' | 'OBITO'

/** O que a regra precisa saber de uma certidão (linha de qualquer lista). */
export interface ChaveDaCertidao {
  /** A geração calculada (G1, G2…) — `calcularGeracoes`. `null` = sem geração (vai depois de quem tem). NÃO é `numeroLinhagem`. */
  geracao?: number | null
  /** A pessoa está na linha reta de transmissão? `null`/`false` = fora da linha. */
  linhaReta?: boolean | null
  /** Data de nascimento da PESSOA. `null` = sem data (vai depois de quem tem). */
  pessoaNascimento?: Date | string | null
  pessoaId?: number | null
  /** NASCIMENTO / CASAMENTO / OBITO — ou `null` (outros documentos). */
  categoria?: string | null
  /** Quando não há `categoria`: o título ("Certidão de nascimento · …") decide. */
  titulo?: string | null
  /** Desempate final estável (id da tarefa/documento). */
  desempate?: number | string | null
}

export const ORDEM_DA_CATEGORIA: Record<CategoriaDaCertidao, number> = { NASCIMENTO: 0, CASAMENTO: 1, OBITO: 2 }
const OUTROS = 3

/** 0 nascimento · 1 casamento · 2 óbito · 3 outros. */
export function ordemDaCategoria(c: Pick<ChaveDaCertidao, 'categoria' | 'titulo'>): number {
  const cat = (c.categoria ?? '').toUpperCase()
  if (cat in ORDEM_DA_CATEGORIA) return ORDEM_DA_CATEGORIA[cat as CategoriaDaCertidao]
  const t = (c.titulo ?? '').toLowerCase()
  if (/nasc/.test(t)) return 0
  if (/casam/.test(t)) return 1
  if (/[óo]bito/.test(t)) return 2
  return OUTROS
}

const tempo = (v: Date | string | null | undefined): number => {
  if (!v) return Number.POSITIVE_INFINITY
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v))
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY
}
const infinitoPrimeiro = (x: number, y: number): number => (x === y ? 0 : x < y ? -1 : 1) // Infinity vence só por ser maior: vai para o fim

/** A comparação ÚNICA de duas certidões DA MESMA FAMÍLIA. */
export function compararCertidoesDaFamilia(a: ChaveDaCertidao, b: ChaveDaCertidao): number {
  const ga = a.geracao ?? Number.POSITIVE_INFINITY, gb = b.geracao ?? Number.POSITIVE_INFINITY
  if (ga !== gb) return infinitoPrimeiro(ga, gb)
  const la = a.linhaReta === true ? 0 : 1, lb = b.linhaReta === true ? 0 : 1
  if (la !== lb) return la - lb
  const na = tempo(a.pessoaNascimento), nb = tempo(b.pessoaNascimento)
  if (na !== nb) return infinitoPrimeiro(na, nb)
  // Mesma geração, mesma linha, mesmo nascimento: as certidões da MESMA pessoa ficam juntas.
  const pa = a.pessoaId ?? Number.POSITIVE_INFINITY, pb = b.pessoaId ?? Number.POSITIVE_INFINITY
  if (pa !== pb) return infinitoPrimeiro(pa, pb)
  const ca = ordemDaCategoria(a), cb = ordemDaCategoria(b)
  if (ca !== cb) return ca - cb
  const da = a.desempate ?? 0, db = b.desempate ?? 0
  return typeof da === 'number' && typeof db === 'number' ? da - db : String(da).localeCompare(String(db), 'pt-BR')
}

/** Ordena uma CÓPIA, estável. Só vale para itens da MESMA família. */
export function ordenarCertidoesDaFamilia<T>(itens: readonly T[], chave: (t: T) => ChaveDaCertidao): T[] {
  return itens
    .map((t, i) => ({ t, i, k: chave(t) }))
    .sort((x, y) => compararCertidoesDaFamilia(x.k, y.k) || x.i - y.i)
    .map((x) => x.t)
}

/**
 * Lista NÃO agrupada por família: família → a regra acima.
 * `entreFamilias` (opcional) é o critério que decide QUAL FAMÍLIA vem primeiro (risco, prazo…): a posição de cada família é a da PRIMEIRA
 * linha dela quando a lista inteira é ordenada por esse critério. Sem ele, as famílias seguem a ordem em que aparecem. O critério nunca
 * toca a ordem DENTRO da família.
 */
export function ordenarListaPorFamilia<T>(
  itens: readonly T[],
  o: { familia: (t: T) => string | null | undefined; chave: (t: T) => ChaveDaCertidao; entreFamilias?: (a: T, b: T) => number },
): T[] {
  const nome = (t: T) => o.familia(t) ?? ''
  const base = o.entreFamilias ? itens.map((t, i) => ({ t, i })).sort((x, y) => o.entreFamilias!(x.t, y.t) || x.i - y.i).map((x) => x.t) : [...itens]
  const posicao = new Map<string, number>()
  base.forEach((t) => { if (!posicao.has(nome(t))) posicao.set(nome(t), posicao.size) })
  const grupos = new Map<string, T[]>()
  for (const t of itens) { const f = nome(t); if (!grupos.has(f)) grupos.set(f, []); grupos.get(f)!.push(t) }
  return [...grupos.entries()]
    .sort((x, y) => posicao.get(x[0])! - posicao.get(y[0])!)
    .flatMap(([, linhas]) => ordenarCertidoesDaFamilia(linhas, o.chave))
}

/** O texto da regra, para a tela e para a documentação (uma só redação). */
export const TEXTO_DA_REGRA_DE_ORDEM =
  'Dentro da família: geração (G1, G2…, cônjuge na geração do parceiro); na geração, linha reta antes de fora da linha e depois a ordem de nascimento; na pessoa, Nascimento, Casamento, Óbito e os outros documentos. Risco, prazo e status só ordenam as famílias.'

// ─── ADAPTADOR PARA AS LINHAS DE TAREFA/CERTIDÃO (Operação, Torre, Central, exportações) ───────────────────────────────────────────────
/** O que uma linha de tarefa de certidão carrega para a regra. */
export interface LinhaDeCertidao {
  geracao?: number | null
  linhaReta?: boolean | null
  pessoaNascimento?: string | null
  pessoaId?: number | null
  categoriaDoc?: string | null
  titulo?: string | null
  taskId?: number | null
  familiaNome?: string | null
  processoNome?: string | null
}

export const chaveDaLinhaDeCertidao = (l: LinhaDeCertidao): ChaveDaCertidao => ({
  geracao: l.geracao, linhaReta: l.linhaReta, pessoaNascimento: l.pessoaNascimento, pessoaId: l.pessoaId,
  categoria: l.categoriaDoc, titulo: l.titulo, desempate: l.taskId,
})
export const familiaDaLinhaDeCertidao = (l: LinhaDeCertidao): string => l.familiaNome ?? l.processoNome ?? '—'

/**
 * UMA lista de linhas de certidão (de qualquer tela ou exportação) na ordem fixa: família → regra. `entreFamilias` (opcional) é o critério
 * que decide QUAL FAMÍLIA vem primeiro (risco, prazo, "chegou trabalho"…); nunca mexe na ordem dentro da família.
 */
export function ordenarLinhasDeCertidao<T extends LinhaDeCertidao>(linhas: readonly T[], entreFamilias?: (a: T, b: T) => number): T[] {
  return ordenarListaPorFamilia(linhas, { familia: familiaDaLinhaDeCertidao, chave: chaveDaLinhaDeCertidao, entreFamilias })
}
