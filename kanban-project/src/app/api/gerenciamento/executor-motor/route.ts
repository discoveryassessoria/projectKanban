import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { executarMotorNaFase } from '@/src/lib/motor/executor'

// ============================================================
// FASE 4.2/4.3 — EXECUTOR REAL (botão manual) + chave do gatilho automático.
// A lógica de criar artefatos vive em @/src/lib/motor/executor (compartilhada
// com o gatilho automático do avançar-fase). Aqui só orquestra + desfazer.
// ============================================================

// ---- GET: bootstrap (processos + tipos + estado da chave automática) ----
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const [processos, tipos, cfg] = await Promise.all([
      prisma.processo.findMany({ select: { id: true, nome: true, tipoProcessoMotorId: true }, orderBy: { createdAt: 'desc' }, take: 300 }),
      prisma.tipoProcessoNacionalidade.findMany({
        where: { ativo: true, arquivado: false },
        select: { id: true, name: true, macroWorkflow: { select: { fases: { select: { phaseKey: true, label: true, ordem: true }, orderBy: { ordem: 'asc' } } } } },
        orderBy: { name: 'asc' },
      }),
      prisma.motorConfig.findUnique({ where: { id: 1 } }),
    ])
    return NextResponse.json({
      processos,
      tipos: tipos.map(t => ({ id: t.id, name: t.name, fases: t.macroWorkflow?.fases ?? [] })),
      autoExecutar: cfg?.autoExecutarAoAvancar ?? false,
    })
  } catch (e) {
    console.error('GET executor-motor', e)
    return NextResponse.json({ error: 'Erro ao carregar o executor.' }, { status: 500 })
  }
}

// ---- POST: ações ----
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const b = await request.json()
    const action = String(b.action || '')

    // liga/desliga o gatilho automático
    if (action === 'config') {
      const value = !!b.value
      await prisma.motorConfig.upsert({ where: { id: 1 }, create: { id: 1, autoExecutarAoAvancar: value }, update: { autoExecutarAoAvancar: value } })
      return NextResponse.json({ ok: true, autoExecutar: value })
    }

    if (action === 'assign') {
      const processoId = Number(b.processoId)
      const tipoProcessoId = b.tipoProcessoId == null ? null : Number(b.tipoProcessoId)
      if (!processoId) return NextResponse.json({ error: 'Processo inválido.' }, { status: 400 })
      await prisma.processo.update({ where: { id: processoId }, data: { tipoProcessoMotorId: tipoProcessoId } })
      return NextResponse.json({ ok: true })
    }

    if (action === 'list') {
      const processoId = Number(b.processoId)
      if (!processoId) return NextResponse.json({ error: 'Processo inválido.' }, { status: 400 })
      const artefatos = await prisma.motorArtefato.findMany({ where: { processoId }, orderBy: { criadoEm: 'desc' } })
      return NextResponse.json({ artefatos })
    }

    if (action === 'undo') {
      const artefatoId = Number(b.artefatoId)
      if (!artefatoId) return NextResponse.json({ error: 'Artefato inválido.' }, { status: 400 })
      const art = await prisma.motorArtefato.findUnique({ where: { id: artefatoId } })
      if (!art) return NextResponse.json({ error: 'Artefato não encontrado.' }, { status: 404 })
      if (art.status !== 'active') return NextResponse.json({ error: 'Este artefato já foi desfeito.' }, { status: 400 })
      await prisma.$transaction(async (tx) => {
        if (art.targetId) {
          try {
            if (art.targetTable === 'Tarefa') await tx.tarefa.delete({ where: { id: art.targetId } })
            else if (art.targetTable === 'Receita') await tx.receita.delete({ where: { id: art.targetId } })
            else if (art.targetTable === 'Custo') await tx.custo.delete({ where: { id: art.targetId } })
            else if (art.targetTable === 'Evento') await tx.evento.delete({ where: { id: art.targetId } })
            else if (art.targetTable === 'Protocolo') await tx.protocolo.delete({ where: { id: art.targetId } })
          } catch { /* já removido */ }
        }
        await tx.motorArtefato.update({ where: { id: art.id }, data: { status: 'undone', undoneEm: new Date() } })
      })
      return NextResponse.json({ ok: true })
    }

    // EXECUTAR de verdade (botão manual) — usa a lib compartilhada
    if (action === 'run') {
      const processoId = Number(b.processoId)
      const phaseKey = String(b.phaseKey || '')
      const event = String(b.event || 'entered')
      if (!processoId || !phaseKey) return NextResponse.json({ error: 'Escolha o processo e a fase.' }, { status: 400 })
      const processo = await prisma.processo.findUnique({ where: { id: processoId }, select: { tipoProcessoMotorId: true } })
      if (!processo) return NextResponse.json({ error: 'Processo não encontrado.' }, { status: 404 })
      if (!processo.tipoProcessoMotorId) return NextResponse.json({ error: 'Este processo ainda não está conectado a um Tipo do motor. Conecte primeiro.' }, { status: 400 })
      const r = await executarMotorNaFase(processoId, processo.tipoProcessoMotorId, phaseKey, event)
      return NextResponse.json(r)
    }

    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 })
  } catch (e) {
    console.error('POST executor-motor', e)
    return NextResponse.json({ error: 'Erro no executor.' }, { status: 500 })
  }
}