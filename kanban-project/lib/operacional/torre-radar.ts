// lib/operacional/torre-radar.ts
// ============================================================================
// O RADAR — regras PURAS: filtros (Todas · Precisam de alguém · Bola nossa · Bola com terceiro · Críticas), busca por família,
// País, ordenação (Mais grave primeiro · Mais tempo na fase · Família A–Z), contagens e rodapé. Sem Prisma, sem relógio.
//
// Do protótipo (inventário §1.3/§2.8): "Precisam de alguém" = risco ≠ no ritmo; "Bola nossa" = bola Nossa; "Bola com terceiro" = bola ≠
// Nossa (Cliente conta como terceiro); "Críticas" = o balde vermelho (crítico OU parado — `ehGrave` da regra única); busca só no NOME
// da família, sem acento/maiúsculas; ordem "Mais grave" = balde vermelho → atenção → no ritmo e, no empate, MAIOR tempo na fase.
// As contagens dos botões são as do TOTAL (já recortado pelo país/busca do cabeçalho da Torre): não mexem ao digitar na busca nem ao escolher
// o País da tela, como no protótipo; o rodapé é que diz quantas famílias o recorte tem ("Mostrando 9 de 47 famílias").
// ============================================================================
import type { ProcessoDaTorre } from './torre-processos'
import { PESO_NO_RADAR, rotuloNoRadar, ehGrave, precisaDeAlguem } from './torre-risco'
import { diasComoNumero, semAcento, textoDuracao, paginar, ITENS_POR_PAGINA, TODOS_OS_PAISES } from './torre-fase'

export { ITENS_POR_PAGINA, TODOS_OS_PAISES }

export type FiltroDoRadar = 'todas' | 'precisam' | 'nossa' | 'terceiro' | 'criticas'
export type OrdemDoRadar = 'grave' | 'tempo' | 'az'

export const FILTROS_DO_RADAR: ReadonlyArray<{ chave: FiltroDoRadar; rotulo: string }> = [
  { chave: 'todas', rotulo: 'Todas' }, { chave: 'precisam', rotulo: 'Precisam de alguém' },
  { chave: 'nossa', rotulo: 'Bola nossa' }, { chave: 'terceiro', rotulo: 'Bola com terceiro' }, { chave: 'criticas', rotulo: 'Críticas' },
]
export const ORDENS_DO_RADAR: ReadonlyArray<{ chave: OrdemDoRadar; rotulo: string }> = [
  { chave: 'grave', rotulo: 'Mais grave primeiro' }, { chave: 'tempo', rotulo: 'Mais tempo na fase' }, { chave: 'az', rotulo: 'Família A–Z' },
]
/** O filtro padrão do protótipo (T131). */
export const FILTRO_INICIAL_DO_RADAR: FiltroDoRadar = 'precisam'

export const passaNoFiltroDoRadar = (p: ProcessoDaTorre, f: FiltroDoRadar): boolean =>
  f === 'todas'
  || (f === 'precisam' && precisaDeAlguem(p.nivelDeRisco))
  || (f === 'nossa' && p.bola.rotulo === 'Nossa')
  || (f === 'terceiro' && p.bola.rotulo !== 'Nossa')
  || (f === 'criticas' && ehGrave(p.nivelDeRisco))

/** País + busca por família (tudo menos o botão) — a base da lista. */
export function baseDoRadar(processos: ProcessoDaTorre[], pais: string, busca: string): ProcessoDaTorre[] {
  const q = semAcento(busca.trim())
  return processos.filter((p) => (pais === TODOS_OS_PAISES || p.pais === pais) && (!q || semAcento(p.familiaNome).includes(q)))
}

export type ContagensDoRadar = Record<FiltroDoRadar, number>
export function contagensDoRadar(base: ProcessoDaTorre[]): ContagensDoRadar {
  return {
    todas: base.length,
    precisam: base.filter((p) => passaNoFiltroDoRadar(p, 'precisam')).length,
    nossa: base.filter((p) => passaNoFiltroDoRadar(p, 'nossa')).length,
    terceiro: base.filter((p) => passaNoFiltroDoRadar(p, 'terceiro')).length,
    criticas: base.filter((p) => passaNoFiltroDoRadar(p, 'criticas')).length,
  }
}

export function ordenarRadar(linhas: ProcessoDaTorre[], ordem: OrdemDoRadar): ProcessoDaTorre[] {
  const az = (a: ProcessoDaTorre, b: ProcessoDaTorre) => a.familiaNome.localeCompare(b.familiaNome, 'pt-BR')
  const tempo = (a: ProcessoDaTorre, b: ProcessoDaTorre) => diasComoNumero(b.naFase.dias, b.naFase.horas) - diasComoNumero(a.naFase.dias, a.naFase.horas)
  const cmp = ordem === 'tempo' ? (a: ProcessoDaTorre, b: ProcessoDaTorre) => tempo(a, b) || az(a, b)
    : ordem === 'az' ? az
    : (a: ProcessoDaTorre, b: ProcessoDaTorre) => PESO_NO_RADAR[a.nivelDeRisco] - PESO_NO_RADAR[b.nivelDeRisco] || tempo(a, b) || az(a, b)
  return [...linhas].sort(cmp)
}

/** O que o Radar mostra, de ponta a ponta: base → botão → ordem → página. */
export function visaoDoRadar(
  processos: ProcessoDaTorre[], par: { filtro: FiltroDoRadar; pais: string; busca: string; ordem: OrdemDoRadar; pagina: number },
) {
  const base = baseDoRadar(processos, par.pais, par.busca)
  const filtradas = ordenarRadar(base.filter((p) => passaNoFiltroDoRadar(p, par.filtro)), par.ordem)
  return { base, contagens: contagensDoRadar(processos), filtradas, pagina: paginar(filtradas, par.pagina) }
}

/** O texto da célula da fase atual: "Cartório · 52 d" (sem registro de entrada: "Cartório · —"). */
export const textoDaCelulaAtual = (bola: string | undefined, dias: number | null | undefined, horas: number | null | undefined): string =>
  `${bola ?? '—'} · ${textoDuracao(dias ?? null, horas ?? null, true)}`

export { rotuloNoRadar }

/** O rodapé: "Mostrando 9 de 47 famílias · ordem: mais grave primeiro" (a ordem em minúsculas). */
export function rodapeDoRadar(mostrando: number, total: number, ordem: OrdemDoRadar): string {
  if (total === 0) return 'Nenhuma família encontrada com esses filtros.'
  const rotulo = ORDENS_DO_RADAR.find((o) => o.chave === ordem)?.rotulo ?? ''
  return `Mostrando ${mostrando} de ${total} ${total === 1 ? 'família' : 'famílias'} · ordem: ${rotulo.toLowerCase()}`
}
