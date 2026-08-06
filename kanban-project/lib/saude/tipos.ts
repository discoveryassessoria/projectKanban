// lib/saude/tipos.ts
//
// SAÚDE DO SISTEMA — vocabulário único do motor de auditoria contínua.
//
// REGRA FUNDANTE: o diagnóstico nunca mente por omissão. "Saudável" só existe
// quando TODAS as verificações obrigatórias rodaram, nenhuma falhou tecnicamente
// e nenhuma encontrou problema. Verificação que não pôde ser executada não é
// ausência de problema — é diagnóstico incompleto.

/** Gravidade de um achado. A ordem importa: índice maior = pior. */
export const SEVERIDADES = ['INFORMATIVO', 'ALERTA', 'ERRO', 'CRITICO'] as const
export type Severidade = (typeof SEVERIDADES)[number]

export const SEVERIDADE_LABEL: Record<Severidade, string> = {
  INFORMATIVO: 'Informativo',
  ALERTA: 'Alerta',
  ERRO: 'Erro',
  CRITICO: 'Crítico',
}

/** Estado geral do sistema. A ordem importa: índice maior = pior. */
export const ESTADOS = ['SAUDAVEL', 'ATENCAO', 'DEGRADADO', 'CRITICO', 'DIAGNOSTICO_INCOMPLETO', 'INDISPONIVEL'] as const
export type EstadoSaude = (typeof ESTADOS)[number]

export const ESTADO_LABEL: Record<EstadoSaude, string> = {
  SAUDAVEL: 'Saudável',
  ATENCAO: 'Atenção',
  DEGRADADO: 'Degradado',
  CRITICO: 'Crítico',
  DIAGNOSTICO_INCOMPLETO: 'Diagnóstico incompleto',
  INDISPONIVEL: 'Saúde desconhecida',
}

/** Domínios obrigatórios de auditoria. Cobertura é medida contra esta lista. */
export const DOMINIOS = [
  'BANCO', 'MIGRATIONS', 'INTEGRIDADE', 'DUPLICIDADES', 'PROCESSOS', 'WORKFLOW', 'FASES',
  'TRANSICOES', 'SLA', 'SERVICOS', 'DOCUMENTOS', 'SISTEMA_DOCUMENTAL', 'PESSOAS',
  'ARVORE', 'ORGANIZACOES', 'FINANCEIRO', 'TABELA_VALORES', 'COBRANCAS', 'CONTAS_PAGAR',
  'CONTAS_RECEBER', 'TESOURARIA', 'CAMBIO', 'AUTOMACOES', 'EVENTOS', 'FILAS', 'TAREFAS',
  'USUARIOS', 'PERMISSOES', 'AUDITORIA', 'ARQUIVOS', 'APIS', 'ROTAS', 'INTERFACE', 'INTEGRACOES',
  'COMUNICACOES', 'RELATORIOS', 'IMPORT_EXPORT', 'CONFIGURACOES', 'LEGADO', 'PERFORMANCE',
  'SEGURANCA', 'OBSERVABILIDADE', 'BACKUP', 'RECUPERACAO', 'DEPLOY', 'PONTA_A_PONTA',
] as const
export type Dominio = (typeof DOMINIOS)[number]

export const DOMINIO_LABEL: Record<Dominio, string> = {
  BANCO: 'Banco de dados', MIGRATIONS: 'Migrations', INTEGRIDADE: 'Integridade referencial',
  DUPLICIDADES: 'Duplicidades', PROCESSOS: 'Processos', WORKFLOW: 'Workflow', FASES: 'Fases',
  TRANSICOES: 'Transições', SLA: 'SLA', SERVICOS: 'Serviços',
  DOCUMENTOS: 'Documentos', SISTEMA_DOCUMENTAL: 'Sistema Documental', PESSOAS: 'Pessoas',
  ARVORE: 'Árvore Genealógica', ORGANIZACOES: 'Órgãos e Organizações', FINANCEIRO: 'Financeiro',
  TABELA_VALORES: 'Tabela de Valores', COBRANCAS: 'Cobranças', CONTAS_PAGAR: 'Contas a pagar',
  CONTAS_RECEBER: 'Contas a receber', TESOURARIA: 'Tesouraria', CAMBIO: 'Moedas e câmbio',
  AUTOMACOES: 'Automações', EVENTOS: 'Eventos', FILAS: 'Filas e dispatchers', TAREFAS: 'Tarefas e projetos',
  USUARIOS: 'Usuários', PERMISSOES: 'Perfis e permissões', AUDITORIA: 'Auditoria',
  ARQUIVOS: 'Arquivos e armazenamento', APIS: 'APIs internas', ROTAS: 'Rotas', INTERFACE: 'Interface',
  INTEGRACOES: 'Integrações externas', COMUNICACOES: 'E-mails e comunicações', RELATORIOS: 'Relatórios',
  IMPORT_EXPORT: 'Importações e exportações', CONFIGURACOES: 'Configurações gerais',
  LEGADO: 'Código e legado', PERFORMANCE: 'Performance', SEGURANCA: 'Segurança',
  OBSERVABILIDADE: 'Observabilidade', BACKUP: 'Backups', RECUPERACAO: 'Recuperação',
  DEPLOY: 'Deploy e versão', PONTA_A_PONTA: 'Operação ponta a ponta',
}

/** Modo de execução — define QUAIS verificações entram na rodada. */
export const MODOS = ['RAPIDO', 'COMPLETO', 'PROFUNDO'] as const
export type ModoExecucao = (typeof MODOS)[number]

/** Como a verificação terminou. `FALHA_TECNICA` NUNCA conta como aprovada. */
export type ResultadoStatus = 'APROVADA' | 'COM_ACHADOS' | 'FALHA_TECNICA' | 'NAO_EXECUTADA' | 'TIMEOUT'

/** Um problema concreto encontrado por uma verificação. */
export interface Achado {
  /** identidade estável do problema — mesma chave = mesmo problema ao longo do tempo */
  chave: string
  severidade: Severidade
  titulo: string
  /** o que está errado, em uma frase que o operador entende */
  descricao: string
  /** por que está errado, tecnicamente */
  explicacao?: string
  /** o que deixa de funcionar por causa disso */
  impacto?: string
  entidade?: string
  registroId?: string | null
  registroNome?: string | null
  /** quantos registros o problema atinge */
  quantidade?: number
  /** para onde o operador vai resolver */
  link?: string | null
  recomendacao?: string
  /** existe correção automática segura e reversível? */
  correcaoAutomatica?: string | null
  /** amostra verificável — ids, contagens, medições */
  evidencia?: Record<string, unknown>
}

/** O que uma verificação devolve ao motor. */
export interface ResultadoVerificacao {
  achados: Achado[]
  /** medições que a verificação quer expor mesmo sem achado (fila, latência…) */
  metricas?: Record<string, number | string | null>
  /** mensagem de sucesso específica quando não houve achado */
  resumo?: string
}

/** Execução de UMA verificação, já com o veredito do motor. */
export interface ExecucaoVerificacao {
  codigo: string
  status: ResultadoStatus
  duracaoMs: number
  achados: Achado[]
  metricas?: Record<string, number | string | null>
  resumo?: string
  /** preenchido só quando status = FALHA_TECNICA | TIMEOUT */
  erro?: string
}

/** Resultado consolidado de uma rodada. */
export interface ResultadoDiagnostico {
  id?: number
  modo: ModoExecucao
  estado: EstadoSaude
  motivoEstado: string
  iniciadoEm: string
  concluidoEm: string
  duracaoMs: number
  versaoCatalogo: string
  /** cobertura */
  totalCatalogo: number
  totalElegiveis: number
  executadas: number
  aprovadas: number
  comAchados: number
  falhasTecnicas: number
  naoExecutadas: number
  coberturaPercentual: number
  dominiosSemCobertura: Dominio[]
  /** achados por severidade */
  criticos: number
  erros: number
  alertas: number
  informativos: number
  execucoes: ExecucaoVerificacao[]
}

// ── ordenação e agregação ────────────────────────────────────────────────────

export const piorSeveridade = (a: Severidade, b: Severidade): Severidade =>
  SEVERIDADES.indexOf(a) >= SEVERIDADES.indexOf(b) ? a : b

export const piorEstado = (a: EstadoSaude, b: EstadoSaude): EstadoSaude =>
  ESTADOS.indexOf(a) >= ESTADOS.indexOf(b) ? a : b

/** Estado que uma severidade de achado impõe ao sistema. */
export const ESTADO_POR_SEVERIDADE: Record<Severidade, EstadoSaude> = {
  INFORMATIVO: 'SAUDAVEL',
  ALERTA: 'ATENCAO',
  ERRO: 'DEGRADADO',
  CRITICO: 'CRITICO',
}
