// src/components/torre/equipe-tipos.ts — o formato que /api/torre/equipe devolve (a aba Equipe só PINTA isto).
import type { AusenciaDaPessoa } from "./equipe-visual"

export interface PessoaDaEquipe {
  usuarioId: number; nome: string; papel: string; aptidoes: string[]; aptidoesPais: string[]
  ausencia: AusenciaDaPessoa | null
  carga: { executaveis: number; limite: number | null; pct: number | null; faixa: "verde" | "ambar" | "vermelha" | null; fechaPorSemana: number }
  ativas: number; atrasadas: number; aguardando: number
  fila: { semanas: number | null; faixa: "vermelho" | "ambar" | "livre" | "sem_base" }
}
export interface LinhaDaPrevisao { usuarioId: number | null; nome: string; porSemana: Array<{ n: number; nivel: 0 | 1 | 2 | 3 }>; vencidas: number; depois: number; semPrazo: number; total: number }
export interface Previsao { semanas: Array<{ inicio: string; fim: string }>; linhas: LinhaDaPrevisao[] }
export interface SugestaoDaEquipe {
  movimentos: Array<{ deUsuarioId: number; deNome: string; paraUsuarioId: number; paraNome: string; quantidade: number; excesso: number }>
  semResponsavel: { total: number; porPessoa: Array<{ usuarioId: number; nome: string; quantidade: number }>; semApto: number; seguradas: number }
  temAcao: boolean
}
export interface DadosDaEquipe {
  agora: string
  pessoas: PessoaDaEquipe[]
  semResponsavel: { ativas: number; atrasadas: number; aguardando: number }
  sugestao: SugestaoDaEquipe
  previsao: Previsao
}
export interface SimulacaoDeSaida { usuarioId: number; nome: string; dias: number; texto: string; sucessor: { usuarioId: number; nome: string } | null }
