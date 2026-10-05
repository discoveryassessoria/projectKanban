// Tipos do "Precisa de você" no cliente — espelho de `ItemPrecisaDeVoceTorre` (lib/operacional/precisa-de-voce.ts) em JSON.
import { TIPOS_DO_PAINEL, ROTULO_DO_TIPO, regraDoTipo, ESCALAR_APOS_PADRAO, type TipoDoPainel, type ColunasDoItem } from "@/lib/operacional/precisa-de-voce-decisoes"

export type TipoItem = TipoDoPainel | "PAREDE_A_FRENTE"
export interface AcaoDoItem { rotulo: string; acao: string }
export interface ItemPrecisa {
  tipo: TipoItem
  score: number
  faixa: "CRITICO" | "ATENCAO" | "OK"
  /** Sem responsável e Fase deixada são de um PROCESSO (`tarefaId` nulo); os demais, de uma tarefa (ou, na Carga, de uma pessoa). */
  tarefaId: number | null
  processoId: number | null
  familiaNome: string | null
  titulo: string
  detalhe: string
  sugestao: string | null
  /** Família · Fase · Tarefa · Quantidade da tabela (cada informação uma vez). */
  colunas?: ColunasDoItem
  acao1: AcaoDoItem
  acao2: AcaoDoItem
  /** Onde o título leva: o Detalhe do Processo (ou a Equipe, na Carga). */
  link: string
  contexto: Record<string, unknown>
}

/** Os 6 tipos do painel, na ordem dos cartões; o nome, a regra e a cor vêm do módulo puro (a mesma fonte do servidor). */
export { TIPOS_DO_PAINEL, ESCALAR_APOS_PADRAO }
export const ROTULO_TIPO: Record<TipoItem, string> = { ...ROTULO_DO_TIPO, PAREDE_A_FRENTE: "Parede à frente" }
export const regraDoCartao = (tipo: TipoDoPainel, escaladaApos?: number): string => regraDoTipo(tipo, escaladaApos)

/** O selo do tipo (inventário §1.2.1): Sem responsável / Fase deixada = vermelho; Escalada / Divergência = âmbar; Bloqueada / Carga = azul-claro. */
export const PILL_DO_TIPO: Record<TipoItem, "red" | "amb" | "blu"> = {
  SEM_DONO: "red", FASE_DEIXADA: "red", ESCALADA: "amb", DIVERGENCIA: "amb", BLOQUEADA: "blu", CARGA: "blu", PAREDE_A_FRENTE: "blu",
}
/** A cor do NÚMERO no cartão: vermelho · âmbar · marinho. */
export const COR_DO_NUMERO: Record<TipoDoPainel, "red" | "amb" | "nav"> = {
  SEM_DONO: "red", FASE_DEIXADA: "red", ESCALADA: "amb", DIVERGENCIA: "amb", BLOQUEADA: "nav", CARGA: "nav",
}
/** Cor do pill pela FAIXA de risco do item (a mesma do score do Bloco F). */
export const PILL_DA_FAIXA: Record<ItemPrecisa["faixa"], "red" | "amb" | "gry"> = { CRITICO: "red", ATENCAO: "amb", OK: "gry" }

/** O limite de "cobranças sem resposta" do cadastro, que cada decisão traz no contexto (a seção escreve a regra do cartão com ele). */
export const escaladaAposDos = (itens: ItemPrecisa[]): number => {
  const v = itens.find((i) => typeof i.contexto?.escaladaApos === "number")?.contexto.escaladaApos
  return typeof v === "number" && v > 0 ? v : ESCALAR_APOS_PADRAO
}
export const nome1 = (titulo: string): string => titulo.split(" · ")[0]
