// lib/financeiro/flags.ts
// ============================================================================
// FEATURE FLAGS do Motor Financeiro V3 · Fase 2 — INDEPENDENTES entre si.
// Inicialmente: apenas Preview + usuários administrativos autorizados. Em prod,
// cada flag só liga por env explícita (FINANCEIRO_V3_*). Fallback ao legado
// permanece SEMPRE disponível. Ver spec §Compatibilidade / §Feature Flags.
// ============================================================================

import { SANDBOX_PREVIEW } from './sandbox.generated'

export type FlagV3 =
  | 'posicaoRead' // leitura da nova Posição Financeira
  | 'extras' // lançamentos financeiros extras
  | 'ocorrencias' // registrar ocorrência financeira
  | 'dataCorte' // Fase 3 — ativação por data de corte (LedgerOpeningBalance)
  | 'conciliacao' // Fase 3 — conciliação bancária (extrato ↔ ocorrências)
  | 'fallbackLegado' // manter legado como fallback (default: ligado)

const ENV: Record<FlagV3, string> = {
  posicaoRead: 'FINANCEIRO_V3_POSICAO',
  extras: 'FINANCEIRO_V3_EXTRAS',
  ocorrencias: 'FINANCEIRO_V3_OCORRENCIAS',
  dataCorte: 'FINANCEIRO_V3_DATA_CORTE',
  conciliacao: 'FINANCEIRO_V3_CONCILIACAO',
  fallbackLegado: 'FINANCEIRO_V3_FALLBACK_LEGADO',
}

export interface UsuarioFlag {
  id?: number
  tipo?: string | null // 'admin' | ...
  permissoes?: string[] | null
  isAdmin?: boolean | null
}

function envLigada(flag: FlagV3): boolean {
  return process.env[ENV[flag]] === '1'
}

function ehAdmin(u?: UsuarioFlag | null): boolean {
  if (!u) return false
  if (u.isAdmin) return true
  if ((u.tipo ?? '').toLowerCase() === 'admin') return true
  return Array.isArray(u.permissoes) && u.permissoes.includes('financeiro.motor_v3')
}

/**
 * A flag está ativa se: (a) ligada explicitamente por env; OU (b) ambiente
 * Preview E usuário administrativo autorizado. O fallback ao legado é o padrão
 * seguro: fica ligado a menos que explicitamente desligado por env.
 */
export function flagAtiva(flag: FlagV3, usuario?: UsuarioFlag | null): boolean {
  if (flag === 'fallbackLegado') return process.env[ENV.fallbackLegado] !== '0'
  // Sandbox de homologação (marcador assado no build do Preview): V3 é a
  // experiência PADRÃO — flags ligadas por padrão, sem depender de env em runtime.
  // Só se desliga se a env correspondente estiver EXPLICITAMENTE em '0'.
  if (SANDBOX_PREVIEW && process.env[ENV[flag]] !== '0') return true
  if (envLigada(flag)) return true
  const preview = process.env.VERCEL_ENV === 'preview'
  return preview && ehAdmin(usuario)
}

/** Estado de todas as flags — útil para a UI decidir o que renderizar. */
export function flagsV3(usuario?: UsuarioFlag | null): Record<FlagV3, boolean> {
  return {
    posicaoRead: flagAtiva('posicaoRead', usuario),
    extras: flagAtiva('extras', usuario),
    ocorrencias: flagAtiva('ocorrencias', usuario),
    dataCorte: flagAtiva('dataCorte', usuario),
    conciliacao: flagAtiva('conciliacao', usuario),
    fallbackLegado: flagAtiva('fallbackLegado', usuario),
  }
}
