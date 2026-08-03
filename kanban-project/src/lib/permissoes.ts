// src/lib/permissoes.ts
// Sistema de permissões - Constantes, tipos e utilitários

// ========================================
// LISTA DE TODAS AS PERMISSÕES DO SISTEMA
// ========================================

export const PERMISSOES = {
  // Tarefas
  'tarefas.ver': 'Ver tarefas',
  'tarefas.criar': 'Criar tarefas',
  'tarefas.editar': 'Editar tarefas',
  'tarefas.excluir': 'Excluir tarefas',
  'tarefas.iniciar_concluir': 'Iniciar e concluir tarefas',
  'tarefas.bloquear': 'Bloquear e desbloquear tarefas', // CP-4D

  // Processos
  'processos.ver': 'Ver processos',
  'processos.criar': 'Criar processos',
  'processos.editar': 'Editar processos',
  'processos.excluir': 'Excluir processos',
  'processos.editar_status': 'Alterar status/etapa',
  'processos.criar_coluna': 'Criar colunas no kanban',
  'processos.editar_coluna': 'Editar colunas no kanban',
  'processos.excluir_coluna': 'Excluir colunas no kanban',
  'processos.ver_paginas': 'Ver páginas específicas (Protocolos/Informações)',
  'processos.editar_paginas': 'Editar páginas específicas',
  // REGULARIZAÇÃO HISTÓRICA — cadastrar processo já em fase avançada e completar
  // depois as fases anteriores. Mexe em histórico: é EXCLUSIVA (ver PERMISSOES_EXCLUSIVAS),
  // não vem por perfil padrão nem por ser tipo=admin. Só por concessão nominal.
  'processos.regularizarHistorico': 'Regularização histórica: cadastrar processo em fase avançada e completar fases anteriores',
  // MOVIMENTAÇÃO MANUAL DE FASE — reposiciona o processo em QUALQUER fase do workflow
  // (anterior, posterior ou intermediária) SEM as validações do fluxo automático. É a
  // permissão do "Administrador Master": EXCLUSIVA (ver PERMISSOES_EXCLUSIVAS), nunca
  // concedida por perfil padrão nem por `tipo = 'admin'`. Funcionário não a recebe.
  'processos.moverFaseManual': 'Administrador Master: mover o processo manualmente para qualquer fase, sem as validações do fluxo',

  // Clientes/Cadastros
  'clientes.ver': 'Ver contratantes e requerentes',
  'clientes.criar': 'Cadastrar contratantes e requerentes',
  'clientes.editar': 'Editar dados cadastrais',
  'clientes.excluir': 'Excluir contratantes e requerentes',

  // Financeiro - Faturas
  'financeiro.ver': 'Ver faturas e pagamentos',
  'financeiro.fatura_criar': 'Criar faturas',
  'financeiro.fatura_excluir': 'Excluir faturas',
  'financeiro.pagamento_criar': 'Registrar pagamentos',
  'financeiro.pagamento_editar': 'Editar pagamentos',
  'financeiro.pagamento_excluir': 'Excluir pagamentos',
  // Financeiro - Planilha de Custos
  'financeiro.coluna_criar': 'Adicionar coluna na planilha',
  'financeiro.coluna_editar': 'Editar nome de coluna',
  'financeiro.coluna_excluir': 'Excluir coluna da planilha',
  'financeiro.custos_editar': 'Editar valores e reordenar planilha',
  // F6 — Segregação de permissões de CUSTO (Contas a Pagar V3). Criar ≠ Aprovar ≠ Pagar ≠
  // Conciliar. Enforcement server-side; retrocompat via financeiro.ver durante a migração.
  'financeiro.custo_criar': 'Criar custo (Contas a Pagar)',
  'financeiro.custo_editar': 'Editar custo (descrição/valor/fornecedor/cronograma/repasse)',
  'financeiro.custo_aprovar': 'Aprovar custo',
  'financeiro.custo_reprovar': 'Reprovar custo',
  'financeiro.custo_cancelar': 'Cancelar custo',
  'financeiro.custo_pagar': 'Pagar custo (registrar pagamento)',
  'financeiro.custo_estornar': 'Estornar pagamento de custo',
  'financeiro.custo_conciliar': 'Conciliar custo',
  'financeiro.custo_excluir': 'Excluir custo (exclusão lógica)',
  'financeiro.custo_arquivar': 'Arquivar/desarquivar custo',

  // Eventos
  'eventos.ver': 'Ver eventos',
  'eventos.criar': 'Criar eventos',
  'eventos.editar': 'Editar eventos',
  'eventos.excluir': 'Excluir eventos',

  // Árvore Genealógica
  'arvore.ver': 'Ver árvore',
  'arvore.criar': 'Criar pessoas na árvore',
  'arvore.editar': 'Editar pessoas na árvore',
  'arvore.excluir': 'Excluir pessoas da árvore',
  'arvore.criar_documento': 'Criar documentos na árvore',
  'arvore.editar_documento': 'Editar documentos na árvore',
  'arvore.excluir_documento': 'Excluir documentos na árvore',

  // Motor Registral Genealógico (MRG) — revisão registral da Árvore.
  // Segregação de funções: VER evidência ≠ REVISAR divergência ≠ APROVAR correção
  // ≠ ALTERAR FILIAÇÃO ≠ MESCLAR pessoas ≠ REVERTER ≠ REPROCESSAR ≠ ADMINISTRAR.
  // Enforcement é server-side (services/registral/aplicar.ts + rotas).
  'registral.ver_evidencias': 'Ver evidências registrais (documento, página, trecho, confiança)',
  'registral.revisar': 'Revisar divergências e conflitos registrais',
  'registral.aprovar': 'Aprovar correções registrais (nome, datas, locais)',
  'registral.alterar_filiacao': 'Criar, corrigir ou remover filiação (altera a estrutura da árvore)',
  'registral.mesclar_pessoas': 'Mesclar ou separar identidades de pessoas',
  'registral.reverter': 'Reverter alterações registrais aplicadas',
  'registral.reprocessar': 'Processar e reprocessar a Pasta Documental no motor registral',
  'registral.administrar_regras': 'Administrar regras registrais e descartar conflito crítico',

  // Administração
  'usuarios.gerenciar': 'Ver usuários',
  'usuarios.criar': 'Criar usuários',
  'usuarios.editar': 'Editar usuários',
  'usuarios.excluir': 'Excluir usuários',

  // Regras Documentais (base configurável dos workflows futuros)
  'regras_documentais.ver': 'Ver regras documentais',
  'regras_documentais.criar': 'Criar regra documental (rascunho)',
  'regras_documentais.editar': 'Editar rascunho de regra documental',
  'regras_documentais.publicar': 'Publicar versão de regra documental',
  'regras_documentais.arquivar': 'Arquivar/inativar regra documental',
  'regras_documentais.simular': 'Simular regras documentais',
  'regras_documentais.excluir': 'Excluir regra documental nunca utilizada',

  // CP-4A — Motor de Workflow/Avanço (catálogo; enforcement nos subcheckpoints)
  'workflow.avancar': 'Avançar de fase (Motor de Avanço)',
  'workflow.gerarTarefa': 'Gerar tarefa a partir de passo do workflow', // CP-4C
  'workflow.iniciarPasso': 'Iniciar passo do workflow', // CP-4D
  'workflow.supersederPasso': 'Superseder passo do workflow (nova rodada)', // CP-4D
  'workflow.forcarAvanco': 'Forçar avanço de fase (independente de admin genérico)',
  'workflow.reabrirFase': 'Reabrir fase / novo ciclo',
  'workflow.retornarFase': 'Retorno controlado a fase anterior (novo ciclo)', // CP-4F
  'workflow.ativarV2': 'Ativar runtime v2 no processo (operação administrativa)', // CP-4G
  'workflow.dispensarPasso': 'Dispensar passo do workflow',
  'workflow.concluirPasso': 'Concluir passo do workflow',
  'workflow.aprovarPasso': 'Aprovar passo do workflow',
  'workflow.cancelarPasso': 'Cancelar passo do workflow',

  // SISTEMA — ações destrutivas de infraestrutura. OPT-IN: NÃO é concedida pelo "admin tem tudo"
  // nem pelos perfis padrão; precisa ser atribuída EXPLICITAMENTE a um perfil/usuário.
  'sistema.exclusaoDefinitiva': 'Excluir DEFINITIVAMENTE dados de teste (hard delete de Config Financeira / Catálogo de Serviços)',
  // FINANCEIRO V3 — ativação por DATA DE CORTE (Ledger vira a fonte). OPT-IN: ação
  // operacional sensível (grava aberturas/estornos no Ledger); exige permissão explícita.
  'financeiro.dataCorte': 'Administrar a DATA DE CORTE do Motor Financeiro V3 (ativar/reverter aberturas no Ledger)',
} as const

export type PermissaoChave = keyof typeof PERMISSOES

// ========================================
// AGRUPAMENTO POR MÓDULO (para UI)
// ========================================

export const MODULOS_PERMISSOES = [
  {
    modulo: 'Tarefas',
    icone: '✅',
    permissoes: [
      'tarefas.ver',
      'tarefas.criar',
      'tarefas.editar',
      'tarefas.excluir',
      'tarefas.iniciar_concluir',
    ],
  },
  {
    modulo: 'Processos',
    icone: '📋',
    permissoes: [
      'processos.ver',
      'processos.criar',
      'processos.editar',
      'processos.excluir',
      'processos.editar_status',
      'processos.criar_coluna',
      'processos.editar_coluna',
      'processos.excluir_coluna',
      'processos.ver_paginas',
      'processos.editar_paginas',
    ],
  },
  {
    modulo: 'Clientes / Cadastros',
    icone: '👤',
    permissoes: [
      'clientes.ver',
      'clientes.criar',
      'clientes.editar',
      'clientes.excluir',
    ],
  },
  {
    modulo: 'Financeiro',
    icone: '💰',
    permissoes: [
      'financeiro.ver',
      'financeiro.fatura_criar',
      'financeiro.fatura_excluir',
      'financeiro.pagamento_criar',
      'financeiro.pagamento_editar',
      'financeiro.pagamento_excluir',
      'financeiro.coluna_criar',
      'financeiro.coluna_editar',
      'financeiro.coluna_excluir',
      'financeiro.custos_editar',
      // OPT-IN: não vem em nenhum perfil padrão; só existe se concedida aqui, explicitamente.
      'financeiro.dataCorte',
    ],
  },
  {
    // F6 — Segregação de funções do Custo. Cada operação do ciclo de vida é uma permissão
    // independente e CONCEDÍVEL na tela (antes só existiam via seed). Enforcement server-side.
    modulo: 'Financeiro — Custos (Contas a Pagar)',
    icone: '🧾',
    permissoes: [
      'financeiro.custo_criar',
      'financeiro.custo_editar',
      'financeiro.custo_aprovar',
      'financeiro.custo_reprovar',
      'financeiro.custo_cancelar',
      'financeiro.custo_pagar',
      'financeiro.custo_estornar',
      'financeiro.custo_conciliar',
      'financeiro.custo_excluir',
      'financeiro.custo_arquivar',
    ],
  },
  {
    modulo: 'Eventos',
    icone: '📅',
    permissoes: [
      'eventos.ver',
      'eventos.criar',
      'eventos.editar',
      'eventos.excluir',
    ],
  },
  {
    modulo: 'Árvore Genealógica',
    icone: '🌳',
    permissoes: [
      'arvore.ver',
      'arvore.criar',
      'arvore.editar',
      'arvore.excluir',
      'arvore.criar_documento',
      'arvore.editar_documento',
      'arvore.excluir_documento',
    ],
  },
  {
    // MRG — a revisão registral tem funções segregadas: quem lê evidência não é
    // quem aprova correção, e quem aprova correção não é quem mescla identidade.
    modulo: 'Árvore — Motor Registral',
    icone: '📜',
    permissoes: [
      'registral.ver_evidencias',
      'registral.revisar',
      'registral.aprovar',
      'registral.alterar_filiacao',
      'registral.reprocessar',
      'registral.reverter',
      'registral.administrar_regras',
      // OPT-IN: fusão/separação de identidade não vem em nenhum perfil padrão.
      'registral.mesclar_pessoas',
    ],
  },
  {
    modulo: 'Administração',
    icone: '🛡️',
    permissoes: [
      'usuarios.gerenciar',
      'usuarios.criar',
      'usuarios.editar',
      'usuarios.excluir',
    ],
  },
] as const

// ========================================
// PERFIS PADRÃO (seed inicial)
// ========================================

// Permissões OPT-IN: ações destrutivas que NUNCA são concedidas automaticamente — nem por
// "admin tem tudo", nem pelos perfis padrão (TODAS_PERMISSOES). Só valem se atribuídas
// EXPLICITAMENTE no perfil ou nas permissões custom do usuário. Autorização por PERMISSÃO,
// nunca por tipo de usuário.
/**
 * Permissões EXCLUSIVAS: nem o `tipo === 'admin'` as recebe por ser admin.
 *
 * As OPT-IN abaixo já ficam fora dos perfis padrão, mas `calcularPermissoes` liga
 * TUDO para quem é `tipo='admin'` — ou seja, "admin" (um texto no cadastro) ainda
 * seria a autorização de fato. Para uma operação que reescreve histórico isso não
 * serve: a autorização tem de ser uma concessão NOMINAL, verificável e auditável.
 *
 * Uma permissão exclusiva só vale quando o perfil ou as permissões custom do usuário
 * a concedem com `true` de forma explícita.
 */
export const PERMISSOES_EXCLUSIVAS = new Set<string>([
  'processos.regularizarHistorico',
  'processos.moverFaseManual',
])

export const PERMISSOES_OPT_IN = new Set<string>([
  'sistema.exclusaoDefinitiva',
  'financeiro.dataCorte',
  // MRG — fusão/separação de identidade humana é a operação sem volta do motor
  // registral. Fica FORA dos perfis padrão: só existe por concessão explícita.
  'registral.mesclar_pessoas',
])

// Todas as permissões ligadas — EXCETO as opt-in (que exigem concessão explícita).
const TODAS_PERMISSOES = Object.keys(PERMISSOES).reduce((acc, key) => {
  acc[key] = !PERMISSOES_OPT_IN.has(key) && !PERMISSOES_EXCLUSIVAS.has(key)
  return acc
}, {} as Record<string, boolean>)

// Nenhuma permissão
const NENHUMA_PERMISSAO = Object.keys(PERMISSOES).reduce((acc, key) => {
  acc[key] = false
  return acc
}, {} as Record<string, boolean>)

export const PERFIS_PADRAO = [
  {
    nome: 'Administrador',
    descricao: 'Acesso total ao sistema',
    cor: '#EF4444',
    sistema: true,
    permissoes: { ...TODAS_PERMISSOES },
  },
  {
    nome: 'Gerente',
    descricao: 'Acesso amplo, sem gerenciar usuários',
    cor: '#F59E0B',
    sistema: true,
    permissoes: {
      ...TODAS_PERMISSOES,
      'usuarios.gerenciar': false,
      'usuarios.criar': false,
      'usuarios.editar': false,
      'usuarios.excluir': false,
    },
  },
  {
    nome: 'Assistente',
    descricao: 'Operações do dia a dia, sem excluir ou gerenciar financeiro',
    cor: '#3B82F6',
    sistema: true,
    permissoes: {
      ...TODAS_PERMISSOES,
      // Sem exclusões
      'tarefas.excluir': false,
      'processos.excluir': false,
      'processos.excluir_coluna': false,
      'clientes.excluir': false,
      'eventos.excluir': false,
      // Sem financeiro avançado
      'financeiro.fatura_criar': false,
      'financeiro.fatura_excluir': false,
      'financeiro.pagamento_criar': false,
      'financeiro.pagamento_editar': false,
      'financeiro.pagamento_excluir': false,
      'financeiro.coluna_criar': false,
      'financeiro.coluna_editar': false,
      'financeiro.coluna_excluir': false,
      'financeiro.custos_editar': false,
      // MATRIZ DE CUSTOS (homologação): o Assistente ORIGINA o custo (cria, corrige e
      // arquiva) mas não decide nem movimenta dinheiro — aprovar/reprovar/cancelar/pagar/
      // estornar/conciliar/excluir ficam com Gerente e Administrador.
      'financeiro.custo_criar': true,
      'financeiro.custo_editar': true,
      'financeiro.custo_arquivar': true,
      'financeiro.custo_aprovar': false,
      'financeiro.custo_reprovar': false,
      'financeiro.custo_cancelar': false,
      'financeiro.custo_pagar': false,
      'financeiro.custo_estornar': false,
      'financeiro.custo_conciliar': false,
      'financeiro.custo_excluir': false,
      // MATRIZ REGISTRAL: o Assistente OPERA a leitura (processa a pasta, revisa
      // divergência e vê evidência) mas NÃO decide dado registral nem estrutura.
      'registral.ver_evidencias': true,
      'registral.revisar': true,
      'registral.reprocessar': true,
      'registral.aprovar': false,
      'registral.alterar_filiacao': false,
      'registral.reverter': false,
      'registral.administrar_regras': false,
      // Sem admin
      'usuarios.gerenciar': false,
    },
  },
  {
    nome: 'Estagiário',
    descricao: 'Apenas visualização e tarefas básicas',
    cor: '#8B5CF6',
    sistema: true,
    permissoes: {
      ...NENHUMA_PERMISSAO,
      // Só visualizar
      'tarefas.ver': true,
      'tarefas.iniciar_concluir': true,
      'processos.ver': true,
      'processos.ver_paginas': true,
      'clientes.ver': true,
      'eventos.ver': true,
      'arvore.ver': true,
      // Vê a evidência que sustenta um dado; não revisa, não aprova, não altera.
      'registral.ver_evidencias': true,
    },
  },
]

// ========================================
// FUNÇÕES DE VERIFICAÇÃO
// ========================================

export type MapaPermissoes = Record<string, boolean>

/**
 * Calcula as permissões efetivas de um usuário:
 * 1. Começa com as permissões do perfil
 * 2. Aplica overrides individuais (permissoesCustom)
 * 3. Admin (tipo === 'admin') SEMPRE tem tudo
 */
export function calcularPermissoes(
  tipo: string,
  perfilPermissoes?: MapaPermissoes | null,
  permissoesCustom?: MapaPermissoes | null
): MapaPermissoes {
  // BASE: admin (tipo === 'admin') tem TUDO — inclusive as permissões OPT-IN (ações destrutivas
  // como exclusão definitiva). Usuário comum começa com tudo false e só recebe o que perfil/custom
  // conceder; PERMISSOES_OPT_IN mantém essas permissões FORA dos perfis padrão (TODAS_PERMISSOES),
  // então um não-admin só as obtém por concessão EXPLÍCITA.
  // EXCLUSIVAS ficam FALSE na base mesmo para admin: quem as concede é o cadastro
  // (perfil/custom), nominalmente. "ser admin" não é autorização para reescrever histórico.
  const resultado: MapaPermissoes = Object.keys(PERMISSOES).reduce((acc, key) => {
    acc[key] = tipo === 'admin' && !PERMISSOES_EXCLUSIVAS.has(key)
    return acc
  }, {} as MapaPermissoes)

  // Aplicar permissões do perfil
  if (perfilPermissoes) {
    for (const [key, value] of Object.entries(perfilPermissoes)) {
      if (key in resultado) {
        resultado[key] = !!value
      }
    }
  }

  // Aplicar overrides individuais (sobrescrevem o perfil)
  if (permissoesCustom) {
    for (const [key, value] of Object.entries(permissoesCustom)) {
      if (key in resultado) {
        resultado[key] = !!value
      }
    }
  }

  return resultado
}

/**
 * Verifica se o usuário tem uma permissão específica
 */
export function temPermissao(
  permissoesEfetivas: MapaPermissoes,
  permissao: PermissaoChave
): boolean {
  return !!permissoesEfetivas[permissao]
}

/**
 * Verifica se o usuário tem TODAS as permissões listadas
 */
export function temTodasPermissoes(
  permissoesEfetivas: MapaPermissoes,
  permissoes: PermissaoChave[]
): boolean {
  return permissoes.every(p => !!permissoesEfetivas[p])
}

/**
 * Verifica se o usuário tem ALGUMA das permissões listadas
 */
export function temAlgumaPermissao(
  permissoesEfetivas: MapaPermissoes,
  permissoes: PermissaoChave[]
): boolean {
  return permissoes.some(p => !!permissoesEfetivas[p])
}