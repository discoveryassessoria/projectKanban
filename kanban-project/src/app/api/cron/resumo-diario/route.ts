// src/app/api/cron/resumo-diario/route.ts
// ============================================================================
// O RESUMO DIÁRIO DO SINO — 07:00 em São Paulo (redesenho 29/09/2026).
//
//   GET/POST /api/cron/resumo-diario          executa
//   GET/POST /api/cron/resumo-diario?ensaio=1 só relata o que faria
//
// HORÁRIO: o agendador da Vercel só fala UTC. `0 10 * * *` = 10:00 UTC = 07:00 em
// America/Sao_Paulo (UTC-3), porque o Brasil NÃO tem horário de verão desde 2019. Se o
// horário de verão voltar, este cron passa a rodar às 08:00 locais e o `schedule` do
// `vercel.json` precisa ir para `0 9 * * *` — `scripts/guard-crons-alcancaveis.test.ts`
// trava o valor atual para a mudança nunca ser silenciosa. (O `vercel.json` é JSON puro,
// sem comentários: a documentação do horário mora aqui e no guard.)
//
// O que faz: PRECISA_AGIR por (pessoa, família), só se houver algo — "<Família> — X
// vencidas · Y vencem hoje · Z vencem amanhã · W cobranças a fazer" (partes zeradas
// omitidas) — recompondo a foto do dia mesmo para quem clicou ontem; e a lista do gestor.
//
// Autorização: mesma convenção dos outros crons (header da Vercel, CRON_SECRET ou
// operador autenticado com permissão de gerenciamento).
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { rodarResumoDiario } from '@/lib/operacional/avisos-sino'
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
    const r = await rodarResumoDiario({ ensaio })
    console.log(
      `[cron/resumo-diario]${ensaio ? ' ENSAIO' : ''} precisaAgir grupos=${r.precisaAgir.grupos} criados=${r.precisaAgir.criados} ` +
      `atualizados=${r.precisaAgir.atualizados} removidos=${r.precisaAgir.removidos} | gestor itens=${r.gestor.itens} ` +
      `criados=${r.gestor.criados} removidos=${r.gestor.removidos} `,
    )
    return NextResponse.json(r)
  } catch (e) {
    console.error('[cron/resumo-diario] falha na varredura:', e)
    return NextResponse.json(
      { error: 'Resumo diário indisponível.', detalhe: String((e as Error)?.message ?? e).slice(0, 300) },
      { status: 500 },
    )
  }
}

export const GET = executar
export const POST = executar
