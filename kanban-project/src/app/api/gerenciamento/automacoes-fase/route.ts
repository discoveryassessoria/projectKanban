import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

function amtTypeToKind(t?: string) { return t === 'phase_transition' ? 'phase_advance' : (t || 'task') }

// CONSOLIDAÇÃO DO AVANÇO DE FASE — kinds de EFEITO permitidos numa automação de
// fase. "phase_advance" (e o type de modelo "phase_transition") ficam PROIBIDOS:
// o avanço é exclusivo do PhaseAdvanceService (Workflow Interno conclui +
// BlockingEngine libera + ordem do Workflow Macro decide a próxima fase).
// Registros legados permanecem legíveis, mas não podem ser criados/reativados.
const KINDS_EFEITO_PERMITIDOS = new Set(['task', 'financial', 'document', 'event', 'protocol', 'alert'])
const MSG_PHASE_ADVANCE_PROIBIDO =
  'Automações não avançam fase. O avanço é controlado pelo Workflow Interno (conclusão) + Workflow Macro (ordem) via PhaseAdvanceService. Use um efeito (tarefa, documento, evento, protocolo, notificação).'
function kindDeAvanco(kind?: string) { return kind === 'phase_advance' || kind === 'phase_transition' }

// GET — dados da tela: processos+fases, regras aplicadas, biblioteca 2C
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const [tipos, regras, modelos] = await Promise.all([
      prisma.tipoProcessoNacionalidade.findMany({
        where: { arquivado: false },
        include: { macroWorkflow: { include: { fases: { orderBy: { ordem: 'asc' } } } } },
        orderBy: { name: 'asc' },
      }),
      prisma.phaseAutomationRule.findMany({
        orderBy: { criadoEm: 'asc' },
      }),
      prisma.modeloAutomacao.findMany({
        where: { arquivado: false },
        orderBy: { name: 'asc' },
      }),
    ])

    const tiposProcesso = tipos.map((t) => ({
      id: t.id,
      name: t.name,
      fases: (t.macroWorkflow?.fases || []).map((f) => ({
        phaseKey: f.phaseKey, label: f.label, order: f.ordem,
      })),
    }))

    return NextResponse.json({ tiposProcesso, regras, modelosAutomacao: modelos })
  } catch (e) {
    console.error('GET automacoes-fase', e)
    return NextResponse.json({ error: 'Erro ao carregar automações das fases.' }, { status: 500 })
  }
}

// POST — aplicar modelo 2C OU criar regra ad-hoc (payload do editor)
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const body = await request.json()

    // ---------- APLICAR MODELO 2C ----------
    if (body.aplicar) {
      const templateId = Number(body.templateId)
      const phaseKey = String(body.phaseKey || '')
      const tipoProcessoId = Number(body.tipoProcessoId)
      if (!templateId || !phaseKey || !tipoProcessoId) {
        return NextResponse.json({ error: 'templateId, phaseKey e tipoProcessoId são obrigatórios.' }, { status: 400 })
      }

      const modelo = await prisma.modeloAutomacao.findUnique({ where: { id: templateId } })
      if (!modelo) return NextResponse.json({ error: 'Modelo não encontrado.' }, { status: 404 })

      const kind = amtTypeToKind(modelo.type)
      // Modelo legado de transição de fase não pode ser aplicado a processos.
      if (kindDeAvanco(modelo.type) || kindDeAvanco(kind) || !KINDS_EFEITO_PERMITIDOS.has(kind)) {
        return NextResponse.json({ error: MSG_PHASE_ADVANCE_PROIBIDO, code: 'PHASE_ADVANCE_PROIBIDO' }, { status: 422 })
      }
      const dp = (modelo.defaultParams as Record<string, unknown>) || {}

      const rule = await prisma.phaseAutomationRule.create({
        data: {
          templateId: modelo.id, tipoProcessoId, phaseKey,
          name: modelo.name, description: modelo.description ?? null, kind,
          scope: modelo.scope || 'phase', trigger: modelo.trigger || 'phase_entered',
          action: modelo.action ?? null,
          conditions: (modelo.conditions ?? undefined) as Prisma.InputJsonValue | undefined,
          params: dp as Prisma.InputJsonValue,
          financialType: (dp.financialType as string) ?? null,
          idempotencyPattern: modelo.idempotencyPattern || 'processId+phaseKey',
        },
      })
      await prisma.modeloAutomacao.update({ where: { id: modelo.id }, data: { usedByCount: { increment: 1 } } })
      return NextResponse.json({ rule }, { status: 201 })
    }

    // ---------- CRIAR REGRA AD-HOC (editor) ----------
    const tipoProcessoId = Number(body.tipoProcessoId)
    const phaseKey = String(body.phaseKey || '')
    const kind = String(body.kind || 'task')
    const name = String(body.name || '').trim()
    if (!tipoProcessoId || !phaseKey) return NextResponse.json({ error: 'Selecione o processo e a fase.' }, { status: 400 })
    if (!name) return NextResponse.json({ error: 'Dê um nome à automação.' }, { status: 400 })
    if (kindDeAvanco(kind) || !KINDS_EFEITO_PERMITIDOS.has(kind)) {
      return NextResponse.json({ error: MSG_PHASE_ADVANCE_PROIBIDO, code: 'PHASE_ADVANCE_PROIBIDO' }, { status: 422 })
    }

    const rule = await prisma.phaseAutomationRule.create({
      data: {
        tipoProcessoId, phaseKey, kind, name,
        description: body.description ? String(body.description) : null,
        scope: body.scope || 'phase',
        trigger: body.trigger || 'phase_entered',
        action: body.action ? String(body.action) : null,
        conditions: (body.conditions ?? undefined) as Prisma.InputJsonValue | undefined,
        params: (body.params ?? {}) as Prisma.InputJsonValue,
        financialType: body.financialType ? String(body.financialType) : null,
        idempotent: body.idempotent !== false,
        active: body.active !== false,
      },
    })
    return NextResponse.json({ rule }, { status: 201 })
  } catch (e) {
    console.error('POST automacoes-fase', e)
    return NextResponse.json({ error: 'Erro ao processar a ação.' }, { status: 500 })
  }
}