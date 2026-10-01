"use client"
// src/lib/torre-agora.ts — o "agora" da Torre para telas que precisam do relógio sem quebrar a hidratação.
// `useSyncExternalStore`: no servidor e no PRIMEIRO render da hidratação devolve `null` (o mesmo nos dois lados); depois do mount
// devolve o instante atual com granularidade de MINUTO (snapshot estável — não re-renderiza em laço). Quem usa renderiza o estado
// "carregando" enquanto for `null`. Nenhum `Date` no corpo do componente que o consome.
import { useMemo, useSyncExternalStore } from "react"

const semInscricao = () => () => {}
const minutoAtual = () => Math.floor(Date.now() / 60_000)

export function useAgora(): Date | null {
  const minuto = useSyncExternalStore<number | null>(semInscricao, minutoAtual, () => null)
  return useMemo(() => (minuto == null ? null : new Date(minuto * 60_000)), [minuto])
}
