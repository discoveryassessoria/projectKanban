// Configuração das tarefas pré-definidas por país
// Para adicionar/remover/editar tarefas, basta modificar este arquivo

export interface TarefaPreDefinida {
  id: string
  nome: string
  descricao?: string
  prioridade?: "BAIXA" | "MEDIA" | "ALTA" | "URGENTE"
}

// Tarefas pré-definidas por país
export const TAREFAS_POR_PAIS: Record<string, TarefaPreDefinida[]> = {
  Italia: [
    { id: "busca_certidao_italia", nome: "Busca de certidão na Itália" },
    { id: "busca_certidao_brasil", nome: "Busca de certidão no Brasil" },
    { id: "confeccao_procuracao_administrativa", nome: "Confecção procuração administrativa" },
    { id: "emissao_pasta_documental", nome: "Emissão da pasta documental" },
    { id: "emissao_cnn", nome: "Emissão da CNN" },
    { id: "confeccao_procuracao_judicial_retificacao", nome: "Confecção procuração judicial (Retificação)" },
    { id: "traducao_juramentada", nome: "Tradução juramentada" },
    { id: "confeccao_procuracao_judicial_italia", nome: "Confecção procuração judicial Itália" },
    { id: "apostilamento_haia", nome: "Apostilamento de Haia" },
  ],
  Alemanha: [
    { id: "busca_certidao_alemanha", nome: "Busca de certidão na Alemanha" },
    { id: "busca_certidao_brasil", nome: "Busca de certidão no Brasil" },
    { id: "confeccao_procuracao_administrativa", nome: "Confecção procuração administrativa" },
    { id: "emissao_pasta_documental", nome: "Emissão da pasta documental" },
    { id: "emissao_cnn", nome: "Emissão da CNN" },
    { id: "confeccao_procuracao_judicial_retificacao", nome: "Confecção procuração judicial (Retificação)" },
    { id: "traducao_juramentada", nome: "Tradução juramentada" },
    { id: "formularios_consular", nome: "Formulários consular" },
  ],
  Espanha: [
    { id: "busca_certidao_espanha", nome: "Busca de certidão na Espanha" },
    { id: "busca_certidao_brasil", nome: "Busca de certidão no Brasil" },
    { id: "confeccao_procuracao_administrativa", nome: "Confecção procuração administrativa" },
    { id: "emissao_pasta_documental", nome: "Emissão da pasta documental" },
    { id: "emissao_cnn", nome: "Emissão da CNN" },
    { id: "confeccao_procuracao_judicial_retificacao", nome: "Confecção procuração judicial (Retificação)" },
    { id: "apostilamento_haia", nome: "Apostilamento de Haia" },
    { id: "formularios_consular", nome: "Formulários consular" },
  ],
  Portugal: [
    { id: "busca_certidao_portugal", nome: "Busca de certidão em Portugal" },
    { id: "busca_certidao_brasil", nome: "Busca de certidão no Brasil" },
    { id: "confeccao_procuracao_administrativa", nome: "Confecção procuração administrativa" },
    { id: "emissao_pasta_documental", nome: "Emissão da pasta documental" },
    { id: "emissao_cnn", nome: "Emissão da CNN" },
    { id: "confeccao_procuracao_judicial_retificacao", nome: "Confecção procuração judicial (Retificação)" },
    { id: "apostilamento_haia", nome: "Apostilamento de Haia" },
    { id: "formularios_consular", nome: "Formulários consular" },
  ],
}

// Função helper para obter tarefas por país
export function getTarefasPorPais(pais: string): TarefaPreDefinida[] {
  return TAREFAS_POR_PAIS[pais] || []
}

// Lista de todos os países disponíveis
export const PAISES_DISPONIVEIS = Object.keys(TAREFAS_POR_PAIS)