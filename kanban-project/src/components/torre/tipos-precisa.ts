// Tipos do "Precisa de você" no cliente — espelho de `ItemPrecisaDeVoceTorre` (lib/operacional/precisa-de-voce.ts) em JSON.
export type TipoItem = "FASE_DEIXADA" | "DIVERGENCIA" | "SEM_DONO" | "ESCALADA" | "BLOQUEADA" | "CARGA" | "PAREDE_A_FRENTE"
export interface AcaoDoItem { rotulo: string; acao: string }
export interface ItemPrecisa {
  tipo: TipoItem
  score: number
  faixa: "CRITICO" | "ATENCAO" | "OK"
  tarefaId: number | null
  processoId: number | null
  familiaNome: string | null
  titulo: string
  detalhe: string
  sugestao: string | null
  acao1: AcaoDoItem
  acao2: AcaoDoItem
  link: string
  contexto: Record<string, unknown>
}
export const ROTULO_TIPO: Record<TipoItem, string> = {
  FASE_DEIXADA: "Fase deixada", DIVERGENCIA: "Divergência", SEM_DONO: "Sem dono", ESCALADA: "Escalada",
  BLOQUEADA: "Bloqueada", CARGA: "Carga", PAREDE_A_FRENTE: "Parede à frente",
}
/** Cor do pill pela FAIXA de risco do item (a mesma do score do Bloco F). */
export const PILL_DA_FAIXA: Record<ItemPrecisa["faixa"], "red" | "amb" | "gry"> = { CRITICO: "red", ATENCAO: "amb", OK: "gry" }
