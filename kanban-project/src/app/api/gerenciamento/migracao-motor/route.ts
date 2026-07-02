import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import type { Pais } from '@prisma/client'

// ============================================================
// FASE 5 — Parte 1: conectar processos ao motor EM LOTE.
// Seguro: só preenche/limpa o campo tipoProcessoMotorId (updateMany).
// Nada é apagado. Reversível (desconectar).
// ============================================================

const PAISES: Pais[] = ['PORTUGAL', 'ESPANHA', 'ALEMANHA', 'ITALIA']
const isPais = (s: string): s is Pais => (PAISES as string[]).includes(s)

// monta o filtro por país (ou todos)
function wherePais(pais: string) {
  return pais && pais !== 'all' && isPais(pais) ? { pais } : {}
}

// ---- GET: números atuais (total, conectados, por país) + tipos ----
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const [total, conectados, tipos] = await Promise.all([
      prisma.processo.count(),
      prisma.processo.count({ where: { tipoProcessoMotorId: { not: null } } }),
      prisma.tipoProcessoNacionalidade.findMany({
        where: { ativo: true, arquivado: false },
        select: { id: true, name: true, countryLabel: true },
        orderBy: { name: 'asc' },
      }),
    ])

    const porPais = await Promise.all(PAISES.map(async (p) => {
      const [t, c] = await Promise.all([
        prisma.processo.count({ where: { pais: p } }),
        prisma.processo.count({ where: { pais: p, tipoProcessoMotorId: { not: null } } }),
      ])
      return { pais: p, total: t, conectados: c }
    }))

    return NextResponse.json({ total, conectados, naoConectados: total - conectados, porPais, tipos })
  } catch (e) {
    console.error('GET migracao-motor', e)
    return NextResponse.json({ error: 'Erro ao carregar a migração.' }, { status: 500 })
  }
}

// ---- POST: ações (preview | connect | disconnect) ----
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const b = await request.json()
    const action = String(b.action || '')
    const pais = String(b.pais || 'all')
    const overwrite = !!b.overwrite

    // quantos seriam afetados (sem gravar)
    if (action === 'preview') {
      const where = { ...wherePais(pais), ...(overwrite ? {} : { tipoProcessoMotorId: null }) }
      const count = await prisma.processo.count({ where })
      return NextResponse.json({ count })
    }

    // conecta em lote
    if (action === 'connect') {
      const tipoProcessoId = Number(b.tipoProcessoId)
      if (!tipoProcessoId) return NextResponse.json({ error: 'Escolha um tipo de processo.' }, { status: 400 })
      const where = { ...wherePais(pais), ...(overwrite ? {} : { tipoProcessoMotorId: null }) }
      const r = await prisma.processo.updateMany({ where, data: { tipoProcessoMotorId: tipoProcessoId } })
      return NextResponse.json({ ok: true, count: r.count })
    }

    // desconecta em lote
    if (action === 'disconnect') {
      const where = { ...wherePais(pais), tipoProcessoMotorId: { not: null } }
      const r = await prisma.processo.updateMany({ where, data: { tipoProcessoMotorId: null } })
      return NextResponse.json({ ok: true, count: r.count })
    }

    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 })
  } catch (e) {
    console.error('POST migracao-motor', e)
    return NextResponse.json({ error: 'Erro na migração.' }, { status: 500 })
  }
}