// lib/operacional/torre-casca.ts
// ============================================================================
// REGRAS PURAS DO CASCO DA TORRE — Torre nova, integração (01/10/2026). A tela (`Torre.tsx`) e os testes leem as MESMAS regras.
//
//  1) SELOS DAS ABAS (T004–T008, INVENTARIO §1.1): em que tela cada selo aparece.
//       Tarefas → Hoje · Tarefas (dinâmico lá)   Famílias → Hoje · Famílias   Equipe e Terceiros → só em Hoje   Hoje → nunca (consolidação 06/10/2026)
//  2) `?fase=` TEM DOIS DONOS: na aba TAREFAS é o filtro "Fase" (`filtros.fase`, faseMacroKey); na aba FAMÍLIAS é a SELEÇÃO de fase
//     (o funil navega para `?aba=familias&fase=<phaseKey>`). Nunca um vira o outro: o filtro de tarefas não é gravado nem apagado
//     quando a aba é Famílias, e a fase pedida para Processos não vira filtro de tarefas (o selo da aba Tarefas não encolhe).
// ============================================================================
import type { Aba } from './torre-abas'
import { aplicarFiltrosNaQuery, type FiltrosTorre } from './torre-filtros'

const ONDE_APARECE: Record<Aba, readonly Aba[]> = {
  hoje: [],
  tarefas: ['hoje', 'tarefas'],
  familias: ['hoje', 'familias'],
  equipe: ['hoje'],
  terceiros: ['hoje'],
}

/** O selo da aba `selo` aparece quando a Torre está na aba `atual`? (Hoje não tem selo.) */
export const seloVisivel = (selo: Aba, atual: Aba): boolean => ONDE_APARECE[selo].includes(atual)

const FASE_VALIDA = /^[A-Za-z0-9_.-]{1,60}$/

/**
 * Lê o `fase` da URL conforme a aba. Em Famílias: a fase vira SELEÇÃO (`faseProcessos`) e sai de `filtros.fase`.
 * Nas outras abas: continua filtro de tarefas e `faseProcessos` é `null`.
 */
export function separarFaseDaUrl(aba: Aba, filtros: FiltrosTorre): { filtros: FiltrosTorre; faseProcessos: string | null } {
  if (aba !== 'familias') return { filtros, faseProcessos: null }
  const pedida = filtros.fase.find((f) => FASE_VALIDA.test(f)) ?? null
  return { filtros: { ...filtros, fase: [] }, faseProcessos: pedida }
}

/** Ao reler a URL na aba Famílias, o filtro "Fase" das Tarefas (que o usuário já tinha) fica como estava. */
export const preservarFaseDeTarefas = (aba: Aba, lidos: FiltrosTorre, atuais: FiltrosTorre): FiltrosTorre =>
  aba === 'familias' ? { ...lidos, fase: atuais.fase } : lidos

/** Escreve os filtros na querystring. Na aba Processos NÃO grava `filtros.fase` (a chave `fase` fica livre para a seleção de fase). */
export function filtrosNaQueryDaAba(query: URLSearchParams, aba: Aba, filtros: FiltrosTorre): URLSearchParams {
  return aplicarFiltrosNaQuery(query, aba === 'familias' ? { ...filtros, fase: [] } : filtros)
}
