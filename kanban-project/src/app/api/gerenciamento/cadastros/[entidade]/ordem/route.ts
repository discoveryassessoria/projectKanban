// src/app/api/gerenciamento/cadastros/[entidade]/ordem/route.ts
// ============================================================================
// REORDENAÇÃO dos cadastros ordenáveis. Recebe a lista de IDs na ordem em que o
// operador deixou a tela (arrasto ou botões de mover) e regrava as posições.
//
// Só aceita entidade declarada como `ordenavel` no registro único. Posições são
// recalculadas para 1..N — sem buraco, sem empate —, o que mantém a ordenação
// estável entre cargas. A gravação é transacional: ou a lista inteira assume a
// nova ordem, ou nada muda.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { CADASTROS } from '@/src/lib/gerenciamento/cadastros-registry'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'
import { posicoesReordenadas } from '@/lib/gerenciamento/cadastro-identidade'

type Delegate = {
  findMany: (args?: Record<string, unknown>) => Promise<Record<string, unknown>[]>
  update: (args: Record<string, unknown>) => Promise<Record<string, unknown>>
}
const db = prisma as unknown as Record<string, Delegate>

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ entidade: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  const { entidade } = await params
  const cfg = CADASTROS[entidade]
  if (!cfg) return NextResponse.json({ error: 'Cadastro não encontrado.' }, { status: 404 })
  if (!cfg.ordenavel) return NextResponse.json({ error: 'Este cadastro não tem ordem administrada.' }, { status: 400 })

  try {
    const body = (await request.json().catch(() => ({}))) as { ids?: unknown }
    if (!Array.isArray(body.ids)) {
      return NextResponse.json({ error: 'Informe `ids` com a ordem desejada.' }, { status: 400 })
    }
    const ids = body.ids.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)

    const todos = (await db[cfg.model].findMany({ orderBy: { id: 'asc' } })) as unknown as {
      id: number
      ordem?: number | null
    }[]
    const posicoes = posicoesReordenadas(ids, todos)

    // Só grava quem realmente mudou de posição.
    const atual = new Map(todos.map((r) => [r.id, r.ordem ?? 0]))
    const mudou = posicoes.filter((p) => atual.get(p.id) !== p.ordem)
    if (mudou.length) {
      await prisma.$transaction(
        mudou.map((p) => db[cfg.model].update({ where: { id: p.id }, data: { ordem: p.ordem } }) as never),
      )
      if (cfg.auditoria) {
        await registrarAuditoria(request, {
          acao: 'EDITAR', entidade: cfg.auditoria, entidadeId: null,
          descricao: `${cfg.titulo}: ordem alterada (${mudou.length} registro(s))`,
          detalhes: { ordem: posicoes },
        })
      }
    }

    return NextResponse.json({ ok: true, alterados: mudou.length, ordem: posicoes })
  } catch (e) {
    console.error(`PATCH cadastros/${entidade}/ordem`, e)
    return NextResponse.json({ error: 'Não foi possível salvar a nova ordem.' }, { status: 500 })
  }
}
