// lib/gerenciamento/cadastro-identidade.ts
// ============================================================================
// IDENTIDADE E ORDEM dos cadastros simples — regras puras, uma fonte só.
//
// Três responsabilidades que o sistema assume no lugar do operador:
//
//   1. CÓDIGO — identificador oficial, único e IMUTÁVEL, derivado do nome na
//      criação. Ninguém digita código, e ele nunca é regerado quando o nome
//      muda: se o código seguisse o nome, ele não seria identidade.
//   2. DUPLICIDADE — comparada por EQUIVALÊNCIA SEMÂNTICA (sem caixa, sem
//      acento, sem espaço excedente). "Registro Civil", "registro  civil" e
//      "REGISTRO CIVIL" são o mesmo cadastro, e o segundo é recusado.
//   3. ORDEM — administrada pelo sistema: nasce no fim e é reposicionada por
//      arrasto na listagem. O operador não digita número de posição.
//
// O código é identidade, NUNCA substituto de chave estrangeira: o vínculo entre
// registros continua sendo sempre por id.
//
// Módulo PURO: sem Prisma, sem React (scripts/cadastro-categorias.test.ts).
// ============================================================================

const DIACRITICOS = /[\u0300-\u036f]/g

/**
 * Texto do usuário pronto para gravar: sem espaços nas pontas e sem espaço
 * duplicado no meio. Preserva acentuação e caixa — é conteúdo dele.
 */
export function normalizarNome(v: string | null | undefined): string {
  return (v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim()
}

/**
 * Chave de COMPARAÇÃO semântica. Só existe para detectar equivalência entre
 * dois nomes; nunca é gravada nem usada para localizar entidade.
 */
export function chaveSemantica(v: string | null | undefined): string {
  return normalizarNome(v).normalize('NFD').replace(DIACRITICOS, '').toLowerCase()
}

/** Dois nomes designam o mesmo cadastro? */
export function mesmoNome(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = chaveSemantica(a)
  return ka !== '' && ka === chaveSemantica(b)
}

/**
 * Base do código a partir do nome: sem acento, não-alfanumérico vira `_`,
 * maiúsculas, limitado ao tamanho da coluna.
 */
export function baseDoCodigo(nome: string, limite = 60): string {
  const bruto = chaveSemantica(nome)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
  return bruto.slice(0, limite)
}

/**
 * Código único. Colisão ganha sufixo numérico (`_2`, `_3`…) — determinístico e
 * estável. Nome vazio (ou só símbolos) não gera código: quem chama valida antes.
 */
export function gerarCodigo(nome: string, ocupados: Iterable<string>, limite = 60): string {
  const base = baseDoCodigo(nome, limite)
  if (!base) return ''
  const usados = new Set(Array.from(ocupados, (c) => String(c).toUpperCase()))
  if (!usados.has(base)) return base
  for (let n = 2; n < 1000; n++) {
    const sufixo = `_${n}`
    const cand = `${base.slice(0, limite - sufixo.length)}${sufixo}`
    if (!usados.has(cand)) return cand
  }
  return ''
}

// ── Ordem administrada pelo sistema ────────────────────────────────────────

export interface Ordenavel { id: number; ordem?: number | null }

/** Próxima posição: sempre o fim da lista. Lista vazia começa em 1. */
export function proximaOrdem(registros: Ordenavel[]): number {
  let maior = 0
  for (const r of registros) {
    const o = typeof r.ordem === 'number' ? r.ordem : 0
    if (o > maior) maior = o
  }
  return maior + 1
}

/**
 * Posições finais a partir da ordem em que os ids aparecem na tela.
 * Sempre 1..N, sem buraco e sem empate — o que torna a ordenação estável.
 * Ids desconhecidos são ignorados; ids ausentes na lista mantêm-se ao final,
 * na ordem que já tinham (reordenar uma página não bagunça o resto).
 */
export function posicoesReordenadas(idsNaOrdem: number[], todos: Ordenavel[]): { id: number; ordem: number }[] {
  const existentes = new Map(todos.map((r) => [r.id, r]))
  const vistos = new Set<number>()
  const saida: { id: number; ordem: number }[] = []
  for (const id of idsNaOrdem) {
    if (!existentes.has(id) || vistos.has(id)) continue
    vistos.add(id)
    saida.push({ id, ordem: saida.length + 1 })
  }
  const resto = todos
    .filter((r) => !vistos.has(r.id))
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || a.id - b.id)
  for (const r of resto) saida.push({ id: r.id, ordem: saida.length + 1 })
  return saida
}

/**
 * Lista de ids resultante de mover UM registro uma posição para cima ou para
 * baixo. É a alternativa acessível ao arrasto — mesmo resultado, sem mouse.
 * Nos extremos, devolve a lista inalterada (não circula).
 */
export function moverUmaPosicao(ids: number[], id: number, direcao: 'cima' | 'baixo'): number[] {
  const i = ids.indexOf(id)
  if (i < 0) return ids
  const j = direcao === 'cima' ? i - 1 : i + 1
  if (j < 0 || j >= ids.length) return ids
  const out = [...ids]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

/** Lista resultante de arrastar `id` para a posição `destino` (0-based). */
export function moverPara(ids: number[], id: number, destino: number): number[] {
  const i = ids.indexOf(id)
  if (i < 0) return ids
  const alvo = Math.max(0, Math.min(ids.length - 1, destino))
  if (alvo === i) return ids
  const out = [...ids]
  out.splice(i, 1)
  out.splice(alvo, 0, id)
  return out
}
