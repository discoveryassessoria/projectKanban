// src/app/api/cron/avisos-prazo/route.ts
// ============================================================================
// A VARREDURA DE PRAZOS — de hora em hora, e só isso.
//
//   GET/POST /api/cron/avisos-prazo          executa e envia
//   GET/POST /api/cron/avisos-prazo?ensaio=1 só relata o que enviaria
//
// `avisarPrazosEAtrasos` existia, era testada e não tinha chamador: prazo
// vencia e ninguém era avisado, porque não havia quem perguntasse as horas.
// Esta rota é esse chamador — e não faz mais nada.
//
// Etapa 4 (item 19): a mesma rota também chama `avisarAcontecimentosOperacionais`
// — retorno de terceiro, acompanhamento vencido, entrada em EM_RISCO — porque
// nenhum cron pode ter sua própria definição de atrasado/risco/retorno; as
// duas varreduras leem os mesmos motores canônicos (`tempo-operacional.ts`,
// `proximo-acontecimento.ts`) e não um segundo cron com semântica própria.
//
// ─── O QUE ELA NÃO FAZ ──────────────────────────────────────────────────────
// Não muda status, não move prazo, não toca em workflow, etapa, responsável
// nem SLA. Um cron que escreve estado é um segundo motor operando sem ninguém
// olhando; este LÊ o relógio e cria notificação quando um marco novo acontece.
//
// ─── POR QUE DE HORA EM HORA ────────────────────────────────────────────────
// O SLA é medido em dias. De hora em hora, o aviso do dia anterior sai no
// máximo com uma hora de diferença do ideal — precisão de sobra. A cada minuto
// seriam 1.440 execuções diárias para produzir a mesma informação.
//
// Rodar de hora em hora não multiplica aviso: a identidade do marco é
// `tarefa + tipo + prazo`, e o banco recusa a segunda pela chave única.
//
// Autorização: mesma convenção dos crons existentes (header da Vercel,
// CRON_SECRET ou operador autenticado com permissão de gerenciamento).
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { avisarPrazosEAtrasos, avisarAcontecimentosOperacionais } from '@/lib/operacional/tarefa-comandos'
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

  // ENSAIO: conta e lista sem enviar. É como se confere o volume antes de
  // ligar o sino para gente de verdade.
  const ensaio = new URL(req.url).searchParams.get('ensaio') === '1'

  try {
    const [prazos, atencao] = await Promise.all([
      avisarPrazosEAtrasos({ ensaio }),
      avisarAcontecimentosOperacionais({ ensaio }),
    ])
    // O log da EXECUÇÃO, não da tarefa: registrar "verifiquei a tarefa 3358"
    // uma vez por hora encheria o histórico de cada tarefa com o fato de nada
    // ter acontecido.
    console.log(
      `[cron/avisos-prazo]${ensaio ? ' ENSAIO' : ''} avaliadas=${prazos.avaliadas} ` +
      `prazo=${prazos.prazo} atraso=${prazos.atraso} dedup=${prazos.deduplicados} ` +
      `semDestinatario=${prazos.semDestinatario} erros=${prazos.erros}`,
    )
    console.log(
      `[cron/atencao]${ensaio ? ' ENSAIO' : ''} avaliadas=${atencao.avaliadas} ` +
      `retorno=${atencao.retorno} acompanhamento=${atencao.acompanhamento} risco=${atencao.risco} ` +
      `dedup=${atencao.deduplicados} semDestinatario=${atencao.semDestinatario} erros=${atencao.erros}`,
    )
    // Erro em tarefa isolada não é sucesso: o agendador precisa enxergar.
    const erros = prazos.erros + atencao.erros
    return NextResponse.json({ prazos, atencao }, { status: erros > 0 ? 207 : 200 })
  } catch (e) {
    console.error('[cron/avisos-prazo] falha na varredura:', e)
    return NextResponse.json(
      { error: 'Varredura de prazos indisponível.', detalhe: String((e as Error)?.message ?? e).slice(0, 300) },
      { status: 500 },
    )
  }
}

export const GET = executar
export const POST = executar
