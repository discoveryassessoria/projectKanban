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

  // Processos
  'processos.ver': 'Ver processos',
  'processos.criar': 'Criar processos',
  'processos.editar': 'Editar processos',
  'processos.editar_status': 'Alterar status/etapa do processo',
  'processos.excluir': 'Excluir processos',

  // Clientes/Cadastros
  'clientes.ver': 'Ver contratantes e requerentes',
  'clientes.criar': 'Cadastrar contratantes e requerentes',
  'clientes.editar': 'Editar dados cadastrais',
  'clientes.excluir': 'Excluir contratantes e requerentes',

  // Financeiro
  'financeiro.ver': 'Ver faturas e pagamentos',
  'financeiro.criar': 'Criar faturas',
  'financeiro.editar': 'Editar faturas e registrar pagamentos',
  'financeiro.dashboard': 'Ver dashboard financeiro',
  'financeiro.contas_pagar': 'Gerenciar contas a pagar',

  // Mensagens
  'mensagens.ver': 'Ver mensagens de clientes',
  'mensagens.responder': 'Responder mensagens',

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

  // Administração
  'usuarios.gerenciar': 'Ver usuários',
  'usuarios.criar': 'Criar usuários',
  'usuarios.editar': 'Editar usuários',
  'usuarios.excluir': 'Excluir usuários',
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
      'processos.editar_status',
      'processos.excluir',
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
      'financeiro.criar',
      'financeiro.editar',
      'financeiro.dashboard',
      'financeiro.contas_pagar',
    ],
  },
  {
    modulo: 'Mensagens',
    icone: '💬',
    permissoes: [
      'mensagens.ver',
      'mensagens.responder',
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

// Todas as permissões ligadas
const TODAS_PERMISSOES = Object.keys(PERMISSOES).reduce((acc, key) => {
  acc[key] = true
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
      'clientes.excluir': false,
      'eventos.excluir': false,
      // Sem financeiro avançado
      'financeiro.criar': false,
      'financeiro.editar': false,
      'financeiro.dashboard': false,
      'financeiro.contas_pagar': false,
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
      'clientes.ver': true,
      'mensagens.ver': true,
      'eventos.ver': true,
      'arvore.ver': true,
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
  // Admin sempre tem tudo
  if (tipo === 'admin') {
    return Object.keys(PERMISSOES).reduce((acc, key) => {
      acc[key] = true
      return acc
    }, {} as MapaPermissoes)
  }

  // Começar com tudo false
  const resultado: MapaPermissoes = Object.keys(PERMISSOES).reduce((acc, key) => {
    acc[key] = false
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