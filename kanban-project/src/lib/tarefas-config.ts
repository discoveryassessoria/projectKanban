// Configuração das tarefas pré-definidas
// Para adicionar/remover/editar tarefas, basta modificar este arquivo

export interface TarefaPreDefinida {
  id: string
  nome: string
  descricao?: string
  prioridade?: "BAIXA" | "MEDIA" | "ALTA" | "URGENTE"
}

// Tarefas pré-definidas - EDITE AQUI OS NOMES
export const TAREFAS_PRE_DEFINIDAS: TarefaPreDefinida[] = [
  { id: "pasta_documental", nome: "Pasta documental" },
  { id: "busca_certidao_brasil", nome: "Busca de certidão no Brasil" },
  { id: "busca_certidao_italia", nome: "Busca de certidão na Itália" },
  { id: "analise_documental", nome: "Análise documental" },
  { id: "retificacao", nome: "Retificação" },
  { id: "traducao_juramentada", nome: "Tradução juramentada" },
  { id: "apostilamento", nome: "Apostilamento" },
  { id: "confeccao_procuracao", nome: "Confecção da procuração" },
  { id: "envio_documentos", nome: "Envio de documentos" },
  { id: "protocolo_consulado", nome: "Protocolo no consulado" },
  // Adicione mais tarefas aqui conforme necessário
]

// Se quiser tarefas diferentes por país, use esta estrutura:
// export const TAREFAS_POR_PAIS: Record<string, TarefaPreDefinida[]> = {
//   ITALIA: [
//     { id: "busca_comune", nome: "Busca na Comune" },
//     { id: "transcricao", nome: "Transcrição" },
//   ],
//   ESPANHA: [
//     { id: "fase_2", nome: "Fase 2" },
//   ],
//   // ...
// }