import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// PUT — edita a regra (campos do editor) / toggle active / arquivar
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const { id: idStr } = await params
    const id = Number(idStr)
    const body = await request.json()

    const atual = await prisma.phaseAutomationRule.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Automação não encontrada.' }, { status: 404 })

    // CONSOLIDAÇÃO DO AVANÇO DE FASE — automação não avança fase.
    // (1) não pode mudar o kind para phase_advance/phase_transition;
    // (2) regra legada kind=phase_advance é somente-leitura/arquivável: só
    //     permitimos arquivar/desativar, nunca reativar como executável.
    const MSG = 'Automações não avançam fase. O avanço é exclusivo do PhaseAdvanceService (Workflow Interno + Workflow Macro). Regras legadas de avanço permanecem apenas para histórico.'
    const novoKind = body.kind !== undefined ? String(body.kind) : atual.kind
    if (novoKind === 'phase_advance' || novoKind === 'phase_transition') {
      return NextResponse.json({ error: MSG, code: 'PHASE_ADVANCE_PROIBIDO' }, { status: 422 })
    }
    if (atual.kind === 'phase_advance') {
      // Só se permite arquivar/desativar uma regra legada de avanço.
      const querReativar = body.active === true || body.arquivado === false
      if (querReativar) {
        return NextResponse.json({ error: MSG, code: 'PHASE_ADVANCE_LEGADO' }, { status: 422 })
      }
    }

    const data: Prisma.PhaseAutomationRuleUpdateInput = {}
    if (body.name !== undefined) data.name = String(body.name)
    if (body.description !== undefined) data.description = body.description ? String(body.description) : null
    if (body.kind !== undefined) data.kind = String(body.kind)
    if (body.scope !== undefined) data.scope = String(body.scope)
    if (body.trigger !== undefined) data.trigger = String(body.trigger)
    if (body.action !== undefined) data.action = body.action ? String(body.action) : null
    if (body.conditions !== undefined) data.conditions = (body.conditions ?? undefined) as Prisma.InputJsonValue
    if (body.params !== undefined) data.params = (body.params ?? {}) as Prisma.InputJsonValue
    if (body.financialType !== undefined) data.financialType = body.financialType ? String(body.financialType) : null
    if (body.idempotent !== undefined) data.idempotent = !!body.idempotent
    if (body.active !== undefined) data.active = !!body.active
    if (body.arquivado !== undefined) data.arquivado = !!body.arquivado

    const rule = await prisma.phaseAutomationRule.update({ where: { id }, data })
    return NextResponse.json({ rule })
  } catch (e) {
    console.error('PUT automacoes-fase/[id]', e)
    return NextResponse.json({ error: 'Erro ao salvar a automação.' }, { status: 500 })
  }
}

// DELETE — guarda: se já foi executada (runCount>0) não exclui; oriente arquivar
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const { id: idStr } = await params
    const id = Number(idStr)

    const atual = await prisma.phaseAutomationRule.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Automação não encontrada.' }, { status: 404 })

    if ((atual.runCount || 0) > 0) {
      return NextResponse.json({ error: 'Esta automação já foi executada. Use Arquivar em vez de excluir.', blocked: true }, { status: 409 })
    }

    await prisma.phaseAutomationRule.delete({ where: { id } })

    // devolve o contador de uso ao modelo 2C (se veio de um)
    if (atual.templateId) {
      const modelo = await prisma.modeloAutomacao.findUnique({ where: { id: atual.templateId } })
      if (modelo && modelo.usedByCount > 0) {
        await prisma.modeloAutomacao.update({ where: { id: atual.templateId }, data: { usedByCount: { decrement: 1 } } })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE automacoes-fase/[id]', e)
    return NextResponse.json({ error: 'Erro ao excluir a automação.' }, { status: 500 })
  }
}