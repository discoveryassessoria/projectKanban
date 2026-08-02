// GET/POST — EXECUÇÃO AGENDADA do diagnóstico de saúde.
//
// Frequência (definida em vercel.json):
//   · a cada hora  → modo RÁPIDO   (verificações críticas e operacionais)
//   · 1× por dia   → modo COMPLETO (todas as verificações)
//   · domingo      → modo PROFUNDO (inclui análise histórica e ponta a ponta)
//
// O modo é escolhido pelo relógio, então um único cron horário cobre os três
// ritmos sem depender de três agendamentos.
//
// Autorização: mesma convenção dos crons existentes (header da Vercel,
// CRON_SECRET ou operador autenticado com permissão de gerenciamento).

import { type NextRequest, NextResponse } from 'next/server'
import { executarDiagnostico, persistirDiagnostico, type ModoExecucao } from '@/lib/saude'
import { extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { temPermissao } from '@/src/lib/permissoes'
import { notificarAchados } from '@/lib/saude/notificacoes'

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

/** RÁPIDO de hora em hora; COMPLETO à 1h; PROFUNDO no domingo à 1h. */
function modoDoRelogio(agora: Date): ModoExecucao {
  if (agora.getUTCHours() === 4) return agora.getUTCDay() === 0 ? 'PROFUNDO' : 'COMPLETO'
  return 'RAPIDO'
}

async function executar(req: NextRequest) {
  if (!(await autorizado(req))) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }
  const url = new URL(req.url)
  const forcado = url.searchParams.get('modo')?.toUpperCase()
  const modo: ModoExecucao = forcado === 'RAPIDO' || forcado === 'COMPLETO' || forcado === 'PROFUNDO'
    ? forcado
    : modoDoRelogio(new Date())

  try {
    const resultado = await executarDiagnostico({ modo })
    const persistencia = await persistirDiagnostico(resultado)
    // Notificação só depois de persistir: o que é comunicado já está registrado.
    const notificacao = await notificarAchados(resultado, persistencia)
    return NextResponse.json({
      modo,
      estado: resultado.estado,
      motivoEstado: resultado.motivoEstado,
      executadas: `${resultado.executadas}/${resultado.totalElegiveis}`,
      criticos: resultado.criticos,
      erros: resultado.erros,
      alertas: resultado.alertas,
      falhasTecnicas: resultado.falhasTecnicas,
      persistencia,
      notificacao,
    })
  } catch (e) {
    console.error('[cron/saude] falha ao executar diagnóstico:', e)
    // Falha do motor NÃO é sucesso silencioso — devolve 500 para o agendador.
    return NextResponse.json(
      { error: 'Motor de diagnóstico indisponível.', estado: 'INDISPONIVEL', detalhe: String((e as Error)?.message ?? e).slice(0, 300) },
      { status: 500 },
    )
  }
}

export const GET = executar
export const POST = executar
