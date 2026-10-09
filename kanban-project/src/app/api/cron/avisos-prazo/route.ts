// src/app/api/cron/avisos-prazo/route.ts
// ============================================================================
// A VARREDURA HORÁRIA DO SINO — só FATO NOVO (redesenho 29/09/2026).
//
//   GET/POST /api/cron/avisos-prazo          executa
//   GET/POST /api/cron/avisos-prazo?ensaio=1 só relata o que faria
//
// Já NÃO cria um aviso por tarefa (esse modelo — 10 "Prazo próximo" da mesma família
// no mesmo minuto — foi abolido). De hora em hora esta rota:
//   • atualiza NO LUGAR o PRECISA_AGIR aberto de cada (pessoa, família);
//   • abre aviso só quando há FATO NOVO depois do clique (nova vencida, nova cobrança),
//     com o texto dizendo o que é novo ("Cibils — 1 nova vencida");
//   • atualiza a lista do gestor (ESCALADA, SEM_RESPONSAVEL, INTEGRIDADE crítica);
//   • reconcilia posse (regra 5) e expurga: não lido expira em 7 dias, lido some em 30.
// A foto do dia (07:00) é de `/api/cron/resumo-diario`.
//
// Não muda status, prazo, workflow, etapa, responsável nem SLA: só LÊ e escreve aviso.
//
// Autorização: mesma convenção dos crons existentes (header da Vercel, CRON_SECRET ou
// operador autenticado com permissão de gerenciamento).
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { rodarVarreduraHoraria } from '@/lib/operacional/avisos-sino'
import { registrarExecucaoDeCron } from "@/lib/operacional/cron-rastro"
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
    const r = await rodarVarreduraHoraria({ ensaio })
    console.log(
      `[cron/avisos-prazo]${ensaio ? ' ENSAIO' : ''} precisaAgir grupos=${r.precisaAgir.grupos} criados=${r.precisaAgir.criados} ` +
      `atualizados=${r.precisaAgir.atualizados} removidos=${r.precisaAgir.removidos} | gestor itens=${r.gestor.itens} ` +
      `criados=${r.gestor.criados} removidos=${r.gestor.removidos} | posse retiradas=${r.posse?.retiradas ?? '-'} ` +
      `expirados=${r.expurgo?.expirados ?? '-'} lidosApagados=${r.expurgo?.apagadosLidos ?? '-'}`,
    )
    if (!ensaio) await registrarExecucaoDeCron('avisos-prazo')
    return NextResponse.json(r)
  } catch (e) {
    console.error('[cron/avisos-prazo] falha na varredura:', e)
    return NextResponse.json(
      { error: 'Varredura de avisos indisponível.', detalhe: String((e as Error)?.message ?? e).slice(0, 300) },
      { status: 500 },
    )
  }
}

export const GET = executar
export const POST = executar
