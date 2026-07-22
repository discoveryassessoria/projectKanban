// lib/gerenciamento/auditoria.ts
// ============================================================================
// CAMADA COMPARTILHADA de auditoria/histórico dos Cadastros Mestre.
//
// Reutiliza a tabela LogAuditoria já existente (acao/entidade/entidadeId/
// descricao/detalhes/usuarioId). Nenhum modelo novo, nenhuma tabela nova.
//
// FAIL-SAFE: registrar auditoria NUNCA derruba a operação de negócio — se
// falhar, apenas loga no console. O usuário é extraído do próprio request.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'

export type AcaoAuditoria = 'CRIAR' | 'EDITAR' | 'EXCLUIR' | 'DESATIVAR' | 'REATIVAR'

export interface EntradaAuditoria {
  acao: AcaoAuditoria
  entidade: string
  entidadeId?: number | null
  descricao: string
  /** Antes/depois e o que mudou — vira o histórico consultável. */
  detalhes?: Record<string, unknown> | null
}

/**
 * Grava uma entrada de auditoria/histórico. Extrai o usuário do request.
 * Chamar após a mutação bem-sucedida; erros são engolidos (fail-safe).
 */
export async function registrarAuditoria(request: Request, e: EntradaAuditoria): Promise<void> {
  try {
    const usuario = await extrairUsuarioComPermissoes(request).catch(() => null)
    await prisma.logAuditoria.create({
      data: {
        acao: e.acao.slice(0, 50),
        entidade: e.entidade.slice(0, 50),
        entidadeId: e.entidadeId ?? null,
        descricao: e.descricao.slice(0, 1000),
        detalhes: (e.detalhes ?? undefined) as never,
        usuarioId: usuario?.userId ?? null,
      },
    })
  } catch (err) {
    console.error('[auditoria] falha ao registrar (operação seguiu):', err)
  }
}

/**
 * Diff raso entre antes/depois — só os campos que mudaram, para o histórico.
 * Ignora relações/objetos aninhados (compara por valor primitivo/string).
 */
export function diffCampos(
  antes: Record<string, unknown> | null | undefined,
  depois: Record<string, unknown> | null | undefined,
): Record<string, { de: unknown; para: unknown }> {
  const out: Record<string, { de: unknown; para: unknown }> = {}
  const a = antes ?? {}
  const d = depois ?? {}
  for (const k of new Set([...Object.keys(a), ...Object.keys(d)])) {
    const va = a[k]
    const vd = d[k]
    if (va && typeof va === 'object') continue
    if (vd && typeof vd === 'object') continue
    if (String(va ?? '') !== String(vd ?? '')) out[k] = { de: va ?? null, para: vd ?? null }
  }
  return out
}

/** Rota GET do histórico de uma entidade — reutilizável pelos cadastros. */
export async function historicoDe(entidade: string, entidadeId: number | null, limite = 50) {
  return prisma.logAuditoria.findMany({
    where: { entidade, ...(entidadeId != null ? { entidadeId } : {}) },
    orderBy: { criadoEm: 'desc' },
    take: Math.min(200, limite),
    select: {
      id: true, acao: true, entidade: true, entidadeId: true, descricao: true,
      detalhes: true, criadoEm: true,
      usuario: { select: { id: true, nome: true } },
    },
  })
}
