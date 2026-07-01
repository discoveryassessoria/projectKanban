import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma, PrioridadeTarefa } from '@prisma/client'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// ============================================================
// FASE 4.2 — EXECUTOR REAL (manual, por botão)
// Cria artefatos de verdade num processo conectado a um Tipo do motor.
// PASSO 1: só cria TAREFA (kind=task). Os demais tipos entram depois.
// Segurança: idempotência via MotorArtefato.automaticKey (@unique) e
// desfazer via targetTable+targetId.
// ============================================================

function pstr(p: Prisma.JsonValue | null | undefined, key: string): string | null {
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const v = (p as Record<string, unknown>)[key]
    if (typeof v === 'string' && v) return v
  }
  return null
}
function pnum(p: Prisma.JsonValue | null | undefined, key: string): number | null {
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const v = (p as Record<string, unknown>)[key]
    if (typeof v === 'number') return v
    if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v)
  }
  return null
}
function mapPrio(v: string | null): PrioridadeTarefa {
  switch ((v || '').toLowerCase()) {
    case 'low': return 'BAIXA'
    case 'high': return 'ALTA'
    case 'urgent': return 'URGENTE'
    default: return 'MEDIA'
  }
}
const opautoTriggerFor = (ev: string) => (ev === 'entered' ? 'phase_entered' : null)

// ---- GET: bootstrap (processos reais + tipos do motor com fases) ----
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const [processos, tipos] = await Promise.all([
      prisma.processo.findMany({
        select: { id: true, nome: true, tipoProcessoMotorId: true },
        orderBy: { createdAt: 'desc' }, take: 300,
      }),
      prisma.tipoProcessoNacionalidade.findMany({
        where: { ativo: true, arquivado: false },
        select: { id: true, name: true, macroWorkflow: { select: { fases: { select: { phaseKey: true, label: true, ordem: true }, orderBy: { ordem: 'asc' } } } } },
        orderBy: { name: 'asc' },
      }),
    ])
    return NextResponse.json({
      processos,
      tipos: tipos.map(t => ({ id: t.id, name: t.name, fases: t.macroWorkflow?.fases ?? [] })),
    })
  } catch (e) {
    console.error('GET executor-motor', e)
    return NextResponse.json({ error: 'Erro ao carregar o executor.' }, { status: 500 })
  }
}

// ---- POST: ações (assign | run | list | undo) ----
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const b = await request.json()
    const action = String(b.action || '')

    // conectar/desconectar um processo a um tipo do motor
    if (action === 'assign') {
      const processoId = Number(b.processoId)
      const tipoProcessoId = b.tipoProcessoId == null ? null : Number(b.tipoProcessoId)
      if (!processoId) return NextResponse.json({ error: 'Processo inválido.' }, { status: 400 })
      await prisma.processo.update({ where: { id: processoId }, data: { tipoProcessoMotorId: tipoProcessoId } })
      return NextResponse.json({ ok: true })
    }

    // listar o que o motor já criou nesse processo
    if (action === 'list') {
      const processoId = Number(b.processoId)
      if (!processoId) return NextResponse.json({ error: 'Processo inválido.' }, { status: 400 })
      const artefatos = await prisma.motorArtefato.findMany({
        where: { processoId }, orderBy: { criadoEm: 'desc' },
      })
      return NextResponse.json({ artefatos })
    }

    // desfazer um artefato criado pelo motor
    if (action === 'undo') {
      const artefatoId = Number(b.artefatoId)
      if (!artefatoId) return NextResponse.json({ error: 'Artefato inválido.' }, { status: 400 })
      const art = await prisma.motorArtefato.findUnique({ where: { id: artefatoId } })
      if (!art) return NextResponse.json({ error: 'Artefato não encontrado.' }, { status: 404 })
      if (art.status !== 'active') return NextResponse.json({ error: 'Este artefato já foi desfeito.' }, { status: 400 })
      await prisma.$transaction(async (tx) => {
        if (art.targetTable === 'Tarefa' && art.targetId) {
          // apaga a tarefa criada pelo motor (é o desfazer). Ignora se já não existir.
          try { await tx.tarefa.delete({ where: { id: art.targetId } }) } catch { /* já removida */ }
        }
        // (futuro: Custo | Receita | Evento | Protocolo)
        await tx.motorArtefato.update({ where: { id: art.id }, data: { status: 'undone', undoneEm: new Date() } })
      })
      return NextResponse.json({ ok: true })
    }

    // EXECUTAR de verdade
    if (action === 'run') {
      const processoId = Number(b.processoId)
      const phaseKey = String(b.phaseKey || '')
      const event = String(b.event || 'entered')
      if (!processoId || !phaseKey) return NextResponse.json({ error: 'Escolha o processo e a fase.' }, { status: 400 })

      const processo = await prisma.processo.findUnique({
        where: { id: processoId },
        select: { id: true, nome: true, tipoProcessoMotorId: true },
      })
      if (!processo) return NextResponse.json({ error: 'Processo não encontrado.' }, { status: 404 })
      if (!processo.tipoProcessoMotorId) {
        return NextResponse.json({ error: 'Este processo ainda não está conectado a um Tipo do motor. Conecte primeiro.' }, { status: 400 })
      }
      const tipoProcessoId = processo.tipoProcessoMotorId

      // PASSO 1: só automações do tipo TAREFA
      const wantTrigger = opautoTriggerFor(event)
      const rules = await prisma.phaseAutomationRule.findMany({
        where: { tipoProcessoId, phaseKey, kind: 'task', active: true, arquivado: false },
      })

      const created: { name: string; tarefaId: number }[] = []
      const skipped: { name: string; reason: string }[] = []
      const errors: string[] = []

      for (const rule of rules) {
        if (wantTrigger == null || rule.trigger !== wantTrigger) {
          skipped.push({ name: rule.name, reason: `gatilho não corresponde (dispara em "${rule.trigger}")` })
          continue
        }
        const akey = `${processoId}::${phaseKey}::automation::${rule.id}`
        const prio = mapPrio(pstr(rule.params, 'priority'))
        const slaDays = pnum(rule.params, 'slaDays')
        const dataPrazo = slaDays && slaDays > 0 ? new Date(Date.now() + slaDays * 86400000) : null
        try {
          await prisma.$transaction(async (tx) => {
            const tarefa = await tx.tarefa.create({
              data: {
                titulo: rule.name,
                descricao: rule.description || null,
                processoId,
                prioridade: prio,
                dataPrazo,
                observacoes: `Criada automaticamente pelo motor · fase "${phaseKey}" · regra "${rule.name}"`,
              },
            })
            await tx.motorArtefato.create({
              data: {
                processoId, tipoProcessoId, phaseKey, event,
                ruleKind: 'task', ruleSource: 'automation', ruleId: rule.id,
                automaticKey: akey, targetTable: 'Tarefa', targetId: tarefa.id,
                status: 'active', descricao: rule.name,
                detalhes: { prioridade: prio, dataPrazo: dataPrazo?.toISOString() || null },
              },
            })
            created.push({ name: rule.name, tarefaId: tarefa.id })
          })
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            skipped.push({ name: rule.name, reason: 'já criado antes (idempotência)' })
          } else {
            errors.push(`${rule.name}: ${(e as Error)?.message || 'erro'}`)
          }
        }
      }

      return NextResponse.json({ created, skipped, errors, totalCriado: created.length })
    }

    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 })
  } catch (e) {
    console.error('POST executor-motor', e)
    return NextResponse.json({ error: 'Erro no executor.' }, { status: 500 })
  }
}