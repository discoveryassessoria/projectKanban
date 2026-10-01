// src/components/torre/torre-fase-memoria.ts — a MEMÓRIA de filtros do Radar e de Processos entre trocas de aba.
// O protótipo guarda o estado de cada tela ao sair e voltar e o zera no F5 (T012): um objeto de módulo faz exatamente isso (vive
// enquanto a página vive; não é storage, não sobrevive ao recarregamento). Só é lido DEPOIS do portão `useIsClient` da /torre.
import { FILTRO_INICIAL_DO_RADAR, TODOS_OS_PAISES as PAIS_RADAR, type FiltroDoRadar, type OrdemDoRadar } from "@/lib/operacional/torre-radar"
import { PARAMETROS_INICIAIS, type ParametrosDeProcessos } from "@/lib/operacional/torre-fase"

export interface MemoriaDoRadar { filtro: FiltroDoRadar; busca: string; pais: string; ordem: OrdemDoRadar }
export interface MemoriaDeProcessos extends ParametrosDeProcessos { fase: string | null; pagina: number }

export const memoriaDoRadar: MemoriaDoRadar = { filtro: FILTRO_INICIAL_DO_RADAR, busca: "", pais: PAIS_RADAR, ordem: "grave" }
export const memoriaDeProcessos: MemoriaDeProcessos = { ...PARAMETROS_INICIAIS, fase: null, pagina: 1 }

/** O casco pede a fase de Processos (`?aba=processos&fase=<phaseKey>`, vindo do funil): a aba a lê ao montar. Idempotente. */
export function pedirFaseDeProcessos(fase: string): void { memoriaDeProcessos.fase = fase }
