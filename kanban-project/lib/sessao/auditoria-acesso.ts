// lib/sessao/auditoria-acesso.ts
// ============================================================================
// TRILHA DE ACESSO — ponto único. Login, logout, expiração e renovação caem
// todos aqui, na MESMA entidade "ACESSO" de LogAuditoria que a tela de
// Auditoria de Acessos já lê. Sem tabela nova, sem migration.
//
// Auditar NUNCA derruba autenticação: qualquer falha é engolida de propósito.
// Nenhuma credencial é registrada — só quem, quando, de onde e por quê.
// ============================================================================
import { prisma } from '@/lib/prisma'
import type { MotivoEncerramento } from './politica'

export type AcaoAcesso =
  | 'LOGIN'
  | 'LOGIN_NEGADO'
  | 'LOGOUT'
  | 'SESSAO_EXPIRADA'
  | 'SESSAO_RENOVADA'

interface Origem {
  ip: string | null
  agente: string | null
}

/** Extrai origem da requisição sem depender do tipo concreto de Request. */
export function origemDaRequisicao(req: { headers: { get(n: string): string | null } }): Origem {
  return {
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    agente: req.headers.get('user-agent')?.slice(0, 200) ?? null,
  }
}

export async function registrarAcesso(
  acao: AcaoAcesso,
  descricao: string,
  usuarioId: number | null,
  req: { headers: { get(n: string): string | null } },
  detalhesExtra?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.logAuditoria.create({
      data: {
        acao,
        entidade: 'ACESSO',
        entidadeId: usuarioId ?? undefined,
        descricao: descricao.slice(0, 1000),
        usuarioId: usuarioId ?? undefined,
        detalhes: { ...origemDaRequisicao(req), ...(detalhesExtra ?? {}) },
      },
    })
  } catch {
    /* auditar nunca derruba a autenticação */
  }
}

/** Encerramento de sessão — o motivo é o dado que importa na trilha. */
export async function registrarEncerramento(
  motivo: MotivoEncerramento,
  usuarioId: number | null,
  email: string | null,
  req: { headers: { get(n: string): string | null } },
  extra?: Record<string, unknown>,
): Promise<void> {
  const expirou = motivo === 'inatividade' || motivo === 'expiracao_absoluta'
  await registrarAcesso(
    expirou ? 'SESSAO_EXPIRADA' : 'LOGOUT',
    `Sessão encerrada${email ? ` de ${email}` : ''} — ${motivo}.`,
    usuarioId,
    req,
    { motivo, ...(extra ?? {}) },
  )
}
