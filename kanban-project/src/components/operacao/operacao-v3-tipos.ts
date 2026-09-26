// src/components/operacao/operacao-v3-tipos.ts
// ============================================================================
// ETAPA 3 — TELA OPERAÇÃO, TIPOS.
//
// Espelho do que `/api/operacao/tarefas` devolve (LinhaGerencial, serializado
// em JSON — datas viram string). Campo por campo, nunca `any`: uma divergência
// de nome aqui é um bug silencioso na tela inteira.
// ============================================================================

export type EstadoOperacao = "FILA" | "AGUARDANDO" | "CONCLUIDA"

export interface EstadoTemporalApi {
  dueAt: string | null
  diasParaPrazo: number | null
  atrasado: boolean
  atrasadoHaDias: number | null
  venceHoje: boolean
  venceAmanha: boolean
  semPrazo: boolean
}

export interface LinhaOperacaoV3 {
  taskId: number
  titulo: string
  documentoId: number | null
  processoId: number | null
  processoNome: string | null
  pais: string | null
  familiaNome: string | null
  pessoaId: number | null
  pessoaNome: string | null
  numeroLinhagem: number | null
  linhaReta: boolean | null
  categoriaDoc: "NASCIMENTO" | "CASAMENTO" | "OBITO" | null
  origem: string | null
  faseMacroKey: string | null
  etapaAtual: string | null
  statusTarefa: string
  equipeKey: string | null
  responsavelId: number | null
  responsavelNome: string | null
  prioridade: string
  dataPrazo: string | null
  atrasada: boolean
  rotuloDoPrazo: string
  diasParaPrazo: number | null
  aguardandoDependencia: boolean
  requerDecisao: boolean
  executavelAgora: boolean
  terceiroNome: string | null
  terceiroEmail: string | null
  terceiroTelefone: string | null
  servico: string | null
  criadaEm: string | null
  atribuidaEm: string | null
  passoAtual: { ordem: number; total: number } | null
  regraTemporalPasso: EstadoTemporalApi | null
  acompanhamentoPasso: EstadoTemporalApi | null
  emRisco: boolean
  motivosRisco: string[]
  atrasoInterno: boolean
  atrasoTerceiro: boolean
  acompanhamentoVencido: boolean
  retornoRecebido: boolean
  proximoAcontecimento: { tipo: string; data: string | null; descricao: string } | null
  escalada: boolean
  totalCobrancas: number
  estadoOperacao: EstadoOperacao
  aIniciar: boolean
  passoCorrente: { chave: string; label: string } | null
  // LinhaGerencial (soma sobre LinhaDeFila):
  venceHoje: boolean
  coluna: string
  esperandoDe: "terceiro" | "cliente" | null
  esperandoDesde: string | null
  esperandoHaDias: number | null
  motivoBloqueio: string | null
  concluidaEm: string | null
}

export interface RespostaTarefas {
  visao: string
  total: number
  linhas: LinhaOperacaoV3[]
}

export type Vista = "minha" | "es" | "it" | "urg"
export type AgruparFilaPor = "pessoa" | "orgao" | "passo"
export type AgruparAguardPor = "familia" | "orgao"
export type FiltroRadar = "noorg" | "faseant" | null
export type FiltroQuick = "atrasadas" | "escaladas" | "vencidos" | null
