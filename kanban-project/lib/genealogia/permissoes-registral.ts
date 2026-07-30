// lib/genealogia/permissoes-registral.ts
// ============================================================================
// MRG — segregação de permissões do Motor Registral Genealógico.
//
// Ver evidência ≠ Revisar divergência ≠ Aprovar correção ≠ Alterar filiação ≠
// Mesclar identidade ≠ Reverter ≠ Reprocessar ≠ Administrar regras.
//
// Este módulo é a FONTE ÚNICA da matriz por perfil: o seed de produção e o teste
// de conformidade leem daqui. Matriz duplicada é como um perfil ganha em produção
// uma permissão que o teste jura que ele não tem.
//
// Enforcement é server-side (services/registral/aplicar.ts + as 20 rotas).
// ============================================================================
import type { PermissaoChave } from '@/src/lib/permissoes'

export type OperacaoRegistral =
  | 'ver_evidencias'
  | 'revisar'
  | 'aprovar'
  | 'alterar_filiacao'
  | 'mesclar_pessoas'
  | 'reverter'
  | 'reprocessar'
  | 'administrar_regras'

export const CHAVE_REGISTRAL: Record<OperacaoRegistral, PermissaoChave> = {
  ver_evidencias: 'registral.ver_evidencias',
  revisar: 'registral.revisar',
  aprovar: 'registral.aprovar',
  alterar_filiacao: 'registral.alterar_filiacao',
  mesclar_pessoas: 'registral.mesclar_pessoas',
  reverter: 'registral.reverter',
  reprocessar: 'registral.reprocessar',
  administrar_regras: 'registral.administrar_regras',
}

export const OPERACOES_REGISTRAIS = Object.keys(CHAVE_REGISTRAL) as OperacaoRegistral[]

/**
 * MATRIZ CANÔNICA POR PERFIL — espelha PERFIS_PADRAO de `src/lib/permissoes.ts`.
 *
 * `mesclar_pessoas` NÃO aparece em nenhum perfil: é OPT-IN. Fundir identidade é a
 * única operação sem volta do motor, então ela só existe por concessão explícita
 * a um usuário/perfil — nunca por herança de perfil padrão.
 *
 * Perfil fora desta matriz não é tocado pelo seed (nem criado, nem zerado).
 */
export const MATRIZ_REGISTRAL: Record<string, OperacaoRegistral[]> = {
  Administrador: [
    'ver_evidencias',
    'revisar',
    'aprovar',
    'alterar_filiacao',
    'reverter',
    'reprocessar',
    'administrar_regras',
  ],
  Gerente: [
    'ver_evidencias',
    'revisar',
    'aprovar',
    'alterar_filiacao',
    'reverter',
    'reprocessar',
    'administrar_regras',
  ],
  // OPERA a leitura (processa a pasta, revisa divergência, vê evidência) mas NÃO
  // decide dado registral nem estrutura da árvore.
  Assistente: ['ver_evidencias', 'revisar', 'reprocessar'],
  // Vê a evidência que sustenta um dado; não revisa, não aprova, não altera.
  'Estagiário': ['ver_evidencias'],
}

type Mapa = Record<string, boolean>

/**
 * Aplica a matriz sobre um mapa de permissões existente, mexendo SÓ nas 8 chaves
 * `registral.*`. Qualquer outra permissão do perfil é preservada byte a byte.
 */
export function aplicarMatrizRegistral(atual: Mapa | null | undefined, permitidas: OperacaoRegistral[]): Mapa {
  const saida: Mapa = { ...(atual ?? {}) }
  const set = new Set(permitidas)
  for (const op of OPERACOES_REGISTRAIS) saida[CHAVE_REGISTRAL[op]] = set.has(op)
  return saida
}

/** Só as diferenças nas chaves registrais — para log honesto do que muda. */
export function diffRegistral(antes: Mapa | null | undefined, depois: Mapa): string[] {
  const out: string[] = []
  for (const op of OPERACOES_REGISTRAIS) {
    const k = CHAVE_REGISTRAL[op]
    const a = !!antes?.[k]
    const d = !!depois[k]
    if (a !== d) out.push(`${op}: ${a ? 'sim' : 'não'} → ${d ? 'sim' : 'não'}`)
  }
  return out
}
