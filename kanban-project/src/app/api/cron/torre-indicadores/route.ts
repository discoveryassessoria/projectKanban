// src/app/api/cron/torre-indicadores/route.ts
// ============================================================================
// A FOTO DIÁRIA DOS INDICADORES DA TORRE — Bloco E10 (29/09/2026).
//
//   GET/POST /api/cron/torre-indicadores            executa e grava
//   GET/POST /api/cron/torre-indicadores?ensaio=1    só calcula, não grava
//
// HORÁRIO: 09:00 UTC = 06:00 em America/Sao_Paulo (Brasil não tem horário de
// verão desde 2019 — mesma nota de `resumo-diario`). Antes do resumo diário
// (10:00 UTC) de propósito: a foto de HOJE precisa existir antes que qualquer
// leitura de tendência do dia a procure.
//
// Autorização: mesma convenção dos outros crons — header da Vercel,
// CRON_SECRET, ou operador autenticado com permissão de gerenciamento.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { gravarIndicadoresDoDia, calcularIndicadoresDoDia } from '@/lib/operacional/indicadores-diarios'
import { extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { temPermissao } from '@/src/lib/permissoes'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function autorizado(req: NextRequest): Promise<boolean> {
  if (req.headers.get('x-vercel-cron')) return true
  const segredo = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (segredo && auth === `Bearer ${segredo}`) return true
  const usuario = await extrairUsuarioComPermissoes(req)
  return !!usuario && (usuario.tipo === 'admin' || temPermissao(usuario.permissoes, 'usuarios.gerenciar'))
}

async function executar(req: NextRequest) {
  if (!(await autorizado(req))) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }
  const ensaio = new URL(req.url).searchParams.get('ensaio') === '1'
  try {
    if (ensaio) {
      const indicadores = await calcularIndicadoresDoDia()
      return NextResponse.json({ ensaio: true, indicadores })
    }
    const r = await gravarIndicadoresDoDia()
    console.log(`[cron/torre-indicadores] foto de ${r.data} gravada`)
    return NextResponse.json(r)
  } catch (e) {
    console.error('[cron/torre-indicadores] falha:', e)
    return NextResponse.json(
      { error: 'Indicadores da Torre indisponíveis.', detalhe: String((e as Error)?.message ?? e).slice(0, 300) },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) { return executar(req) }
export async function POST(req: NextRequest) { return executar(req) }
