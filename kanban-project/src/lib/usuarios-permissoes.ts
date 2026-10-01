// src/lib/usuarios-permissoes.ts
// ============================================================================
// REGRAS PURAS DA TELA DE USUÁRIOS × PERMISSÕES PERSONALIZADAS (sem banco; serve à tela e ao servidor).
//
// POR QUE EXISTE (achado de 01/10/2026): o botão "Excluir processo" do Administrador sumiu. A permissão
// `processos.excluirDefinitivo` é EXCLUSIVA (`PERMISSOES_EXCLUSIVAS`): nem o `tipo = 'admin'` a concede, só uma
// concessão NOMINAL em `Usuario.permissoesCustom`. A tela de Usuários não a oferecia e, ao salvar QUALQUER edição de
// um admin, gravava `permissoesCustom: null` — apagando a concessão em silêncio, sem nenhum registro.
//
// Esta fonte única diz (a) quais exclusivas a tela oferece, (b) quais exclusivas uma gravação faria PERDER e (c) o diff
// que vai para a auditoria. Nenhuma migration: `permissoesCustom` já é JSON e `LogAuditoria` já existe.
// ============================================================================
import { PERMISSOES, PERMISSOES_EXCLUSIVAS } from './permissoes'

export type MapaCustom = Record<string, boolean>

/** As três exclusivas, na ordem em que a tela as mostra, com o texto oficial de `PERMISSOES`. */
export const EXCLUSIVAS_DA_TELA: ReadonlyArray<{ chave: string; label: string }> = [
  { chave: 'processos.excluirDefinitivo', label: 'Excluir processo definitivamente' },
  { chave: 'processos.moverFaseManual', label: 'Mover o processo de fase manualmente' },
  { chave: 'processos.regularizarHistorico', label: 'Regularizar histórico (cadastrar em fase avançada)' },
]

/** O que cada exclusiva faz — o mesmo texto de `PERMISSOES`, para a tela explicar sem inventar. */
export const DESCRICAO_DA_EXCLUSIVA = (chave: string): string =>
  (PERMISSOES as Record<string, string>)[chave] ?? chave

/** `permissoesCustom` vindo do banco/corpo: só chaves texto com valor booleano. Qualquer outra coisa vira vazio. */
export function normalizarCustom(v: unknown): MapaCustom {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const saida: MapaCustom = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === 'boolean') saida[k] = val
  return saida
}

/** As exclusivas CONCEDIDAS (`true`) em `antes` que `depois` deixaria de conceder. */
export function exclusivasPerdidas(antes: unknown, depois: unknown): string[] {
  const a = normalizarCustom(antes), d = normalizarCustom(depois)
  return [...PERMISSOES_EXCLUSIVAS].filter((k) => a[k] === true && d[k] !== true)
}

export interface DiffPermissoes {
  concedidas: string[]
  revogadas: string[]
  mudancas: Array<{ chave: string; de: boolean | null; para: boolean | null }>
}

/** O que mudou entre dois `permissoesCustom` — `null` = a chave não existia. Vazio = nada mudou. */
export function diffPermissoesCustom(antes: unknown, depois: unknown): DiffPermissoes {
  const a = normalizarCustom(antes), d = normalizarCustom(depois)
  const chaves = [...new Set([...Object.keys(a), ...Object.keys(d)])].sort()
  const mudancas: DiffPermissoes['mudancas'] = []
  const concedidas: string[] = []
  const revogadas: string[] = []
  for (const chave of chaves) {
    const de = chave in a ? a[chave] : null
    const para = chave in d ? d[chave] : null
    if (de === para) continue
    mudancas.push({ chave, de, para })
    if (para === true && de !== true) concedidas.push(chave)
    if (de === true && para !== true) revogadas.push(chave)
  }
  return { concedidas, revogadas, mudancas }
}

export const semMudanca = (d: DiffPermissoes): boolean => d.mudancas.length === 0
