// Configuração das tarefas pré-definidas por país
// Para adicionar/remover/editar tarefas, basta modificar este arquivo

export interface TarefaPreDefinida {
  id: string
  nome: string
  descricao?: string
  prioridade?: "BAIXA" | "MEDIA" | "ALTA" | "URGENTE"
}

// Tarefas padrão (mesma lista para todos os países)
const TAREFAS_PADRAO: TarefaPreDefinida[] = [
  { id: "documentos_pessoais", nome: "Documentos pessoais" },
  { id: "procuracao_administrativa", nome: "Procuração administrativa" },
  { id: "emissao_pasta_documental", nome: "Emissão da pasta documental" },
  { id: "procuracao_judicial_retificacao", nome: "Procuração judicial (Retificação)" },
  { id: "emissao_pasta_documental_retificada", nome: "Emissão da pasta documental (Retificada)" },
  { id: "emissao_cnn", nome: "Emissão da CNN" },
  { id: "traducao_juramentada", nome: "Tradução juramentada" },
  { id: "apostilamento_haia", nome: "Apostilamento de Haia" },
  { id: "formulario_consular", nome: "Formulário consular" },
]

// Tarefas pré-definidas por país (todos usam a lista padrão)
export const TAREFAS_POR_PAIS: Record<string, TarefaPreDefinida[]> = {
  Italia: TAREFAS_PADRAO,
  Alemanha: TAREFAS_PADRAO,
  Espanha: TAREFAS_PADRAO,
  Portugal: TAREFAS_PADRAO,
}

// Função helper para obter tarefas por país
export function getTarefasPorPais(pais: string): TarefaPreDefinida[] {
  // Busca direta primeiro
  if (TAREFAS_POR_PAIS[pais]) return TAREFAS_POR_PAIS[pais]
  
  // Busca normalizada (sem acentos)
  const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const paisNorm = normalizar(pais).toLowerCase()
  
  const chave = Object.keys(TAREFAS_POR_PAIS).find(
    k => normalizar(k).toLowerCase() === paisNorm
  )
  
  return chave ? TAREFAS_POR_PAIS[chave] : []
}

// Lista de todos os países disponíveis
export const PAISES_DISPONIVEIS = Object.keys(TAREFAS_POR_PAIS)