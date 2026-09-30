// src/lib/torre-acesso.ts
// ============================================================================
// QUEM ENTRA NA TORRE — "Acesso: Administrador · gerência operacional".
//
// A Torre age sobre o trabalho de TODOS, então além da permissão de cada ação
// (a MESMA que a porta individual já exige) o chamador precisa ser gestor
// operacional: `tipo: admin` OU `operacao.distribuirTarefas` — a mesma régua do
// `escopo=equipe` de `GET /api/operacao/tarefas` (Bloco A). A API confere
// SEMPRE; esconder o botão na tela é só sugestão.
// ============================================================================
import { NextResponse } from 'next/server'
import { extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { temPermissao, type PermissaoChave, type MapaPermissoes } from '@/src/lib/permissoes'

export interface UsuarioDaTorre { userId: number; nome: string; email: string; tipo: string; permissoes: MapaPermissoes }

export const ehGestorDaTorre = (u: { tipo: string; permissoes: MapaPermissoes }): boolean =>
  u.tipo === 'admin' || temPermissao(u.permissoes, 'operacao.distribuirTarefas')

export async function exigirTorre(
  request: Request, ...permissoes: PermissaoChave[]
): Promise<{ usuario: UsuarioDaTorre; erro: null } | { usuario: null; erro: NextResponse }> {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return { usuario: null, erro: NextResponse.json({ error: 'Não autorizado' }, { status: 401 }) }
  if (!ehGestorDaTorre(usuario)) {
    return { usuario: null, erro: NextResponse.json({ error: 'A Torre de Controle é para administrador e gerência operacional.' }, { status: 403 }) }
  }
  for (const p of permissoes) {
    if (!temPermissao(usuario.permissoes, p)) {
      return { usuario: null, erro: NextResponse.json({ error: 'Sem permissão para esta ação', permissao: p }, { status: 403 }) }
    }
  }
  return { usuario, erro: null }
}

/**
 * QUEM ENTRA NAS PORTAS QUE MORAM NO GERENCIAMENTO (Regras e Integridade — Saúde do sistema, 01/10/2026): a régua da tela de
 * Saúde é `usuarios.gerenciar`; estas portas exigem o MESMO, sem exigir também ser gestor operacional da Torre (quem gerencia
 * usuários e acessos abre a tela e precisa que as sub-abas funcionem). As permissões extras de cada ação continuam valendo.
 */
export async function exigirGerenciamento(
  request: Request, ...permissoes: PermissaoChave[]
): Promise<{ usuario: UsuarioDaTorre; erro: null } | { usuario: null; erro: NextResponse }> {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return { usuario: null, erro: NextResponse.json({ error: 'Não autorizado' }, { status: 401 }) }
  for (const p of ['usuarios.gerenciar' as PermissaoChave, ...permissoes]) {
    if (!temPermissao(usuario.permissoes, p)) {
      return { usuario: null, erro: NextResponse.json({ error: 'Sem permissão para esta ação', permissao: p }, { status: 403 }) }
    }
  }
  return { usuario, erro: null }
}
