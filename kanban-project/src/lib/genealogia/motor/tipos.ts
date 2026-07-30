// src/lib/genealogia/motor/tipos.ts
//
// Motor Genealógico do Discovery — contratos.
//
// REGRA DE ESCOPO (permanente): este motor é EXCLUSIVAMENTE genealógico.
// Ele NUNCA cria, edita, move ou possui documentos — o Sistema Documental
// continua sendo o dono único do documento. Aqui só existe LEITURA de status
// documental já materializado (para semáforo) e SUGESTÃO de pesquisa
// (hipótese de onde o registro provavelmente existe). Nada além disso.

export type Severidade = "critico" | "alto" | "medio" | "baixo" | "info"

export type CategoriaInsight =
  | "conflito"        // dado internamente impossível
  | "duplicidade"     // mesma pessoa cadastrada 2x
  | "lacuna"          // falta informação essencial
  | "relacao"         // sugestão de vínculo (pai/mãe/irmão/cônjuge/filho)
  | "pesquisa"        // registro provável a buscar
  | "migracao"        // movimento entre países
  | "sobrenome"       // variação/alteração de sobrenome
  | "risco"           // risco documental/genealógico do processo

/** Um achado do motor. Sempre explicável e sempre acionável. */
export interface Insight {
  id: string
  categoria: CategoriaInsight
  severidade: Severidade
  titulo: string
  /** Por que isso é um problema — em linguagem de operador, nunca técnica. */
  explicacao: string
  /** O próximo passo concreto. Sem isso o insight não existe. */
  acao?: string
  pessoaIds: number[]
  uniaoIds?: number[]
  /** 0..1 — quão confiante o motor está. Sugestões nunca são afirmações. */
  confianca?: number
  /** Prioridade final (peso × severidade × impacto na linha de cidadania). */
  peso: number
}

export type PapelLinha =
  | "requerente"
  | "linha"          // linha reta de transmissão
  | "dante_causa"    // ascendente estrangeiro que origina o direito
  | "conjuge"
  | "colateral"

export interface AnalisePessoa {
  pessoaId: number
  /** Geração relativa ao requerente principal (0 = requerente, +1 = pais...). */
  geracao: number
  papel: PapelLinha
  naLinhaCidadania: boolean
  /** 0..100 — quanto do dossiê genealógico dessa pessoa está preenchido. */
  completude: number
  /** Campos essenciais ausentes, já ordenados por importância. */
  faltando: string[]
  insightIds: string[]
  /** Pior severidade entre os insights da pessoa (para o selo do card). */
  severidadeMax: Severidade | null
  /** Quantos descendentes na linha dependem dessa pessoa (gargalo). */
  descendentesNaLinha: number
  /** Resumo de uma linha, gerado automaticamente. */
  resumo: string
}

export interface QualidadeArvore {
  /** 0..100 — nota geral (completude × consistência × cobertura da linha). */
  score: number
  completude: number
  consistencia: number
  /** Quanto da linha de cidadania está resolvida do requerente ao dante causa. */
  coberturaLinha: number
  totalPessoas: number
  totalUnioes: number
  geracoesMapeadas: number
  conflitos: number
  duplicidades: number
  lacunas: number
}

export interface PassoSugerido {
  id: string
  ordem: number
  titulo: string
  motivo: string
  pessoaIds: number[]
  severidade: Severidade
  /** Ganho estimado no score da árvore ao concluir esse passo. */
  ganho: number
}

export interface AnaliseArvore {
  /**
   * Achados JÁ PRIORIZADOS e limitados. Numa árvore de 4.000 pessoas as regras
   * produzem mais de 10.000 achados: guardar todos custa memória e listar todos
   * é o mesmo que não listar nenhum. O corte é por relevância, e `totais` diz a
   * verdade sobre o que ficou de fora — a UI nunca finge cobertura completa.
   */
  insights: Insight[]
  /** Quantidade REAL por categoria, antes do corte. */
  totais: Record<CategoriaInsight, number>
  /** true quando algum achado ficou fora da lista. */
  truncado: boolean
  porPessoa: Map<number, AnalisePessoa>
  qualidade: QualidadeArvore
  /** Ancestrais que travam a maior quantidade de linha (ordenados). */
  gargalos: number[]
  proximosPassos: PassoSugerido[]
  /** Ids na ordem requerente → dante causa. */
  linhaCidadania: number[]
  danteCausaId: number | null
  paisAlvo: PaisAlvo | null
}

export type PaisAlvo = "ITALIA" | "PORTUGAL" | "ESPANHA" | "ALEMANHA"

/** Entrada mínima que o motor precisa. Espelha PessoaArvore sem acoplar a UI. */
export interface PessoaEntrada {
  id: number
  nome: string
  sobrenome?: string | null
  sexo?: string | null
  data_nasc?: Date | string | null
  data_obito?: Date | string | null
  local_nasc?: string | null
  estado_nasc?: string | null
  pais_nasc?: string | null
  vivo?: boolean
  batizado?: string | null
  data_batismo?: Date | string | null
  local_batismo?: string | null
  igreja_batismo?: string | null
  local_obito?: string | null
  profissao?: string | null
  nacionalidade?: string | null
  naturalizado?: boolean
  data_naturalizacao?: Date | string | null
  pais_naturalizacao?: string | null
  data_emigracao?: Date | string | null
  local_emigracao?: string | null
  porto_embarque?: string | null
  data_chegada?: Date | string | null
  porto_chegada?: string | null
  pais_destino?: string | null
  navio?: string | null
  comentario?: string | null
  requerente?: string | null
  /** Declarado como casado no cadastro (independe de existir União). */
  casado?: boolean
  numeroLinhagem?: number | null
  linhaReta?: boolean
  documentacao?: boolean
  paiId?: number | null
  maeId?: number | null
  /** Somente LEITURA — status já materializado pelo Sistema Documental. */
  documentos?: Array<{ id: number; tipo: string; status: string }>
}

export interface UniaoEntrada {
  id: number
  pessoa1Id?: number | null
  pessoa2Id?: number | null
  data_inicio?: Date | string | null
  data_fim?: Date | string | null
  tipo?: string | null
  local?: string | null
  pais?: string | null
  cartorio?: string | null
}

export const ORDEM_SEVERIDADE: Record<Severidade, number> = {
  critico: 5,
  alto: 4,
  medio: 3,
  baixo: 2,
  info: 1,
}

export function piorSeveridade(a: Severidade | null, b: Severidade | null): Severidade | null {
  if (!a) return b
  if (!b) return a
  return ORDEM_SEVERIDADE[a] >= ORDEM_SEVERIDADE[b] ? a : b
}
