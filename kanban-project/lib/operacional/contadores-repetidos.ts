// lib/operacional/contadores-repetidos.ts
// ============================================================================
// REGRA h DO MARCO — «nenhuma informação ou contador aparece repetido em dois lugares da mesma tela». PURA.
// Recebe o TEXTO visível de uma tela e acusa cada contador (número + rótulo) que aparece mais de uma vez. O mesmo detector roda no teste da
// suíte (renderiza as peças da página do processo) e no script do vigia (texto real da tela).
// ============================================================================

/** Os rótulos que acompanham um número e contam coisas do processo. */
const ROTULOS = [
  'abertas?', 'vencid[ao]s?', 'atrasad[ao]s?', 'sem responsável', 'sem dono', 'aguardando terceiros?', 'aguardando', 'a fazer', 'selecionadas?',
  'ativas?', 'certidões', 'tarefas?', 'concluídas?', 'pendentes?', 'recebidas?',
] as const
const RE = new RegExp(`(?<![\\w/])(\\d{1,4})\\s+(${ROTULOS.join('|')})(?![\\wÀ-ÿ])`, 'gi')

export interface ContadorRepetido { chave: string; vezes: number }

export function textoVisivel(html: string): string {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

export function acharContadoresRepetidos(texto: string): ContadorRepetido[] {
  const conta = new Map<string, number>()
  for (const m of texto.matchAll(RE)) {
    // «0 abertas» em cada fase do Caminho é o MESMO rótulo para fases diferentes (e zero não é informação repetida): ignorado.
    if (Number(m[1]) === 0) continue
    const chave = `${m[1]} ${m[2].toLowerCase().replace(/s$/, '')}`
    conta.set(chave, (conta.get(chave) ?? 0) + 1)
  }
  return [...conta.entries()].filter(([, n]) => n > 1).map(([chave, vezes]) => ({ chave, vezes })).sort((a, b) => b.vezes - a.vezes || a.chave.localeCompare(b.chave))
}
