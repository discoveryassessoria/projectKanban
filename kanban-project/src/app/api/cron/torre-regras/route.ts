// src/app/api/cron/torre-regras/route.ts
// ============================================================================
// EXECUÇÃO PERIÓDICA DAS REGRAS DA TORRE — Bloco H3 (30/09/2026).
//
//   GET/POST /api/cron/torre-regras            executa
//   GET/POST /api/cron/torre-regras?ensaio=1   só simula (nunca grava)
//
// De hora em hora. Cada regra consulta o PRÓPRIO estado antes de agir: com r1
// DESLIGADA (o padrão), `executarR1` devolve `REGRA_DESLIGADA` e nenhuma tarefa
// é tocada — este cron é inofensivo enquanto ninguém ligar a regra.
// (r2 age em `registrarCobranca`; r3 só restringe r1. Não há o que rodar aqui para elas.)
//
// Autorização: mesma convenção dos outros crons — header da Vercel, CRON_SECRET,
// ou operador autenticado com permissão de gerenciamento.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { executarR1, simularRegra } from '@/lib/operacional/regras-torre'
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
  if (!(await autorizado(req))) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  const ensaio = new URL(req.url).searchParams.get('ensaio') === '1'
  try {
    if (ensaio) return NextResponse.json({ ensaio: true, r1: await simularRegra('r1') })
    const r1 = await executarR1(null)
    console.log(`[cron/torre-regras] r1 ${r1.executou ? `executada: ${r1.atribuidas} atribuída(s)` : 'desligada — nada feito'}`)
    return NextResponse.json({ r1 })
  } catch (e) {
    console.error('[cron/torre-regras] falha:', e)
    return NextResponse.json({ error: 'Regras da Torre indisponíveis.', detalhe: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return executar(req) }
export async function POST(req: NextRequest) { return executar(req) }
