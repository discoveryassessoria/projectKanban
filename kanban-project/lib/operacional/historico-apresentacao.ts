// lib/operacional/historico-apresentacao.ts
// ============================================================================
// HISTÓRICO LEGÍVEL — TRADUÇÃO NA EXIBIÇÃO (Torre nova, 01/10/2026). Módulo PURO (sem banco, importável no cliente).
//
// O que está gravado na auditoria NÃO muda: o motor grava "atribuída ao usuário 7 (estava na fila da equipe_documental)"
// e "Prazo 2026-10-06 (SLA 5d)" porque é o texto estável que os leitores antigos e os testes conhecem. A pessoa que LÊ
// o histórico (gaveta da Tarefa, Histórico do Detalhe) não deve ver id de usuário, chave de equipe nem sigla:
//
//     atribuída ao usuário 7                    →  atribuída a Daniela Brait
//     transferida do usuário 8 para 2           →  transferida de Lucas Ferraz para Daniela Brait
//     (estava na fila da equipe_documental)     →  (estava na fila da Equipe documental)
//     Prazo 2026-10-06 (SLA 5d)                 →  Prazo 06/10/2026 (prazo de 5 dias)
//
// Os nomes vêm de UMA consulta em lote feita por quem chama (`idsDeUsuarioNoTexto` coleta os ids de todos os textos
// antes; nunca uma consulta por linha). Id sem cadastro vira "usuário removido do cadastro", nunca o número.
// ============================================================================

const DESCONHECIDO = 'usuário removido do cadastro'

export type NomesDeUsuario = ReadonlyMap<number, string> | Readonly<Record<number, string>>

function nomeDe(nomes: NomesDeUsuario, id: number): string {
  const n = nomes instanceof Map ? nomes.get(id) : (nomes as Readonly<Record<number, string>>)[id]
  return n && n.trim() ? n.trim() : DESCONHECIDO
}

/** "Equipe documental" a partir da chave `equipe_documental` (a chave é dado; o rótulo é só de exibição). */
export function rotuloDeEquipe(chave: string): string {
  const palavras = chave.trim().replace(/_+/g, ' ').toLowerCase()
  return palavras ? palavras.charAt(0).toUpperCase() + palavras.slice(1) : chave
}

const dias = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`

// "usuário 7", "Usuário #7" — o que o motor grava quando só tem o id.
const RE_ID = /\b[Uu]su[áa]rio\s+#?(\d+)\b/g
// "do usuário 8 para 2" / "do usuário 8 para o usuário 2": o 2º id vem sem a palavra "usuário".
const RE_TRANSFERENCIA = /\bdo usu[áa]rio\s+(\d+)\s+para\s+(?:o usu[áa]rio\s+)?(\d+)\b/g

/** Ids de usuário citados no texto — para resolver os nomes de todos os textos de uma vez. */
export function idsDeUsuarioNoTexto(texto: string | null | undefined): number[] {
  if (!texto) return []
  const ids = new Set<number>()
  for (const m of texto.matchAll(RE_TRANSFERENCIA)) { ids.add(Number(m[1])); ids.add(Number(m[2])) }
  for (const m of texto.matchAll(RE_ID)) ids.add(Number(m[1]))
  return [...ids]
}

/**
 * O texto do histórico em linguagem de gente. Idempotente (aplicar duas vezes dá o mesmo) e sem efeito num texto que
 * não tem nada a traduzir.
 */
export function apresentarTextoDoHistorico(texto: string, nomes: NomesDeUsuario, opcoes: { rotuloDeEquipe?: (chave: string) => string } = {}): string {
  const rotEquipe = opcoes.rotuloDeEquipe ?? rotuloDeEquipe
  let t = texto
  // 1) "do usuário 8 para 2" (antes do caso genérico, que comeria o "usuário 8").
  t = t.replace(RE_TRANSFERENCIA, (_m, a: string, b: string) => `de ${nomeDe(nomes, Number(a))} para ${nomeDe(nomes, Number(b))}`)
  // 2) preposições que contraem com o artigo: "ao usuário N" → "a NOME"; "do usuário N" → "de NOME"; "o usuário N" → "NOME".
  t = t.replace(/\bao usu[áa]rio\s+#?(\d+)\b/g, (_m, id: string) => `a ${nomeDe(nomes, Number(id))}`)
  t = t.replace(/\bdo usu[áa]rio\s+#?(\d+)\b/g, (_m, id: string) => `de ${nomeDe(nomes, Number(id))}`)
  t = t.replace(/\b(?:o|O) usu[áa]rio\s+#?(\d+)\b/g, (_m, id: string) => nomeDe(nomes, Number(id)))
  t = t.replace(RE_ID, (_m, id: string) => nomeDe(nomes, Number(id)))
  // 3) chave de equipe → rótulo ("equipe_documental" → "Equipe documental").
  t = t.replace(/\bequipe_[a-z0-9_]+\b/g, (k) => rotEquipe(k))
  // 4) prazo: "(SLA 5d)" → "(prazo de 5 dias)" e "Sem SLA declarado" → "Sem prazo declarado".
  t = t.replace(/\bSLA\s+(\d+)\s*d\b/g, (_m, n: string) => `prazo de ${dias(Number(n))}`)
  t = t.replace(/\bSem SLA declarado\b/g, 'Sem prazo declarado')
  // 5) data ISO ("2026-10-06") → "06/10/2026".
  t = t.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_m, a: string, m: string, d: string) => `${d}/${m}/${a}`)
  // 6) o status oficial no plural: "passou a aguardar terceiro" → "passou a aguardar terceiros".
  t = t.replace(/\baguardar terceiro\b(?!s)/g, 'aguardar terceiros')
  return t
}
