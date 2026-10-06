// src/lib/historico-rota.ts
// ============================================================================
// A RESPOSTA HTTP DO HISTÓRICO DO PROCESSO — uma só, para as duas portas:
//   GET/POST /api/processos/{id}/historico            (aba Histórico; `processos.ver`)
//   GET/POST /api/torre/foco/{id}/historico           (Foco da família; gestor da Torre + `tarefas.ver`)
// Cada porta confere a SUA permissão e entrega o usuário aqui; o conteúdo (fatos,
// filtros, CSV, auditoria da exportação) é o mesmo — "mesma fonte para os dois".
//
//   GET  …/historico                      → { processo, fatos, permissoes, … }
//   GET  …/historico?formato=csv&<filtros> → o CSV do que está filtrado (servidor), auditado
//   POST …/historico { formato: 'pdf', filtros, linhas } → registra a exportação em PDF (o PDF
//                                            é desenhado no navegador com os fatos já filtrados)
// ============================================================================
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { temPermissao, type MapaPermissoes } from '@/src/lib/permissoes'
import { historicoDoProcesso } from '@/src/services/historico-processo'
import { filtrarFatos, filtrosDaQuery, queryDosFiltros } from '@/lib/operacional/historico-filtros'
import { csvDoHistorico, nomeDoArquivo } from '@/lib/operacional/historico-exportar'
import { csvDaLinhaDoTempo, passaNaLinhaDoTempo, type FiltrosDaLinhaDoTempo } from '@/lib/operacional/historico-linha-do-tempo'

export interface UsuarioDoHistorico { userId: number; nome: string; permissoes: MapaPermissoes }

export const idDoProcesso = (bruto: string): number | null => { const n = Number(bruto); return Number.isInteger(n) && n > 0 ? n : null }

type FormatoAuditado = 'csv' | 'pdf' | 'pdf-cliente'

async function auditarExportacao(processoId: number, usuario: UsuarioDoHistorico, formato: FormatoAuditado, filtro: string, linhas: number) {
  await prisma.logAuditoria.create({
    data: {
      acao: 'HISTORICO_EXPORTADO', entidade: 'Processo', entidadeId: processoId, usuarioId: usuario.userId,
      descricao: `Histórico do processo exportado em ${formato.toUpperCase()}: ${linhas} fato(s) (${filtro || 'sem filtros'}).`,
      detalhes: { formato, filtro, linhas },
    },
  })
}

const ACAO_DE_VISITA = 'HISTORICO_VISITADO'

/** A última visita DESTE usuário a ESTE processo (um registro por par, atualizado a cada visita; fora do histórico e da auditoria de processo). */
export async function ultimaVisitaDoUsuario(processoId: number, usuarioId: number): Promise<string | null> {
  const r = await prisma.logAuditoria.findFirst({ where: { acao: ACAO_DE_VISITA, entidade: 'Processo', entidadeId: processoId, usuarioId }, orderBy: { id: 'desc' }, select: { detalhes: true } })
  const v = (r?.detalhes as { ultimaVisita?: unknown } | null)?.ultimaVisita
  return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null
}

export async function registrarVisita(processoId: number, usuarioId: number, agora: Date): Promise<void> {
  const existente = await prisma.logAuditoria.findFirst({ where: { acao: ACAO_DE_VISITA, entidade: 'Processo', entidadeId: processoId, usuarioId }, orderBy: { id: 'desc' }, select: { id: true } })
  const detalhes = { ultimaVisita: agora.toISOString() }
  if (existente) await prisma.logAuditoria.update({ where: { id: existente.id }, data: { detalhes } })
  else await prisma.logAuditoria.create({ data: { acao: ACAO_DE_VISITA, entidade: 'Processo', entidadeId: processoId, usuarioId, descricao: 'Última visita ao histórico do processo.', detalhes } })
}

/** A certidão que a janela filtrou (`?certidaoDoc=` / `?certidaoTarefa=`) — a MESMA leitura para a tela e para o CSV. */
export function filtroDeCertidaoDaQuery(q: URLSearchParams): FiltrosDaLinhaDoTempo['certidao'] {
  const n = (k: string) => { const v = Number(q.get(k)); return Number.isInteger(v) && v > 0 ? v : null }
  const documentoId = n('certidaoDoc'), tarefaId = n('certidaoTarefa')
  return documentoId != null || tarefaId != null ? { documentoId, tarefaId, rotulo: '' } : null
}

export async function getHistorico(request: Request, processoId: number, usuario: UsuarioDoHistorico): Promise<NextResponse> {
  const url = new URL(request.url)
  const agora = new Date()
  // `visao=linha`: a janela da Torre (linha do tempo) — lote por identificador / mesmo minuto, e a última visita do usuário.
  const linha = url.searchParams.get('visao') === 'linha'
  const h = await historicoDoProcesso(processoId, { agora, agrupar: linha ? 'minuto' : 'sequencia' })
  if (!h) return NextResponse.json({ error: 'processo não encontrado' }, { status: 404 })

  if (url.searchParams.get('formato') === 'csv') {
    const filtros = filtrosDaQuery(url.searchParams)
    const certidao = linha ? filtroDeCertidaoDaQuery(url.searchParams) : null
    const fatos = linha ? h.fatos.filter((f) => passaNaLinhaDoTempo(f, { ...filtros, certidao }, agora)) : filtrarFatos(h.fatos, filtros, agora)
    await auditarExportacao(processoId, usuario, 'csv', queryDosFiltros(filtros).toString(), fatos.length)
    return new NextResponse(linha ? csvDaLinhaDoTempo(fatos) : csvDoHistorico(fatos), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nomeDoArquivo(h.processo.nome, 'csv', agora)}"`,
        'X-Historico-Fatos': String(fatos.length), 'X-Historico-Total': String(h.fatos.length),
      },
    })
  }
  return NextResponse.json({ ...h, permissoes: { reabrir: temPermissao(usuario.permissoes, 'tarefas.editar') }, ...(linha ? { ultimaVisita: await ultimaVisitaDoUsuario(processoId, usuario.userId) } : {}) })
}

export async function postHistorico(request: Request, processoId: number, usuario: UsuarioDoHistorico): Promise<NextResponse> {
  const b = await request.json().catch(() => ({}))
  // A VISITA: a janela da Torre avisa, depois de montar o que é novo, que o usuário viu o histórico agora.
  if (b?.visita === true) {
    const existeV = await prisma.processo.findUnique({ where: { id: processoId }, select: { id: true } })
    if (!existeV) return NextResponse.json({ error: 'processo não encontrado' }, { status: 404 })
    await registrarVisita(processoId, usuario.userId, new Date())
    return NextResponse.json({ ok: true })
  }
  if (b?.formato !== 'pdf' && b?.formato !== 'pdf-cliente') return NextResponse.json({ error: 'formato inválido; o CSV é gerado pelo GET (?formato=csv)' }, { status: 400 })
  const existe = await prisma.processo.findUnique({ where: { id: processoId }, select: { id: true } })
  if (!existe) return NextResponse.json({ error: 'processo não encontrado' }, { status: 404 })
  const linhas = Number.isInteger(b?.linhas) && b.linhas >= 0 ? (b.linhas as number) : 0
  const filtro = typeof b?.filtros === 'string' ? b.filtros.slice(0, 500) : ''
  await auditarExportacao(processoId, usuario, b.formato === 'pdf-cliente' ? 'pdf-cliente' : 'pdf', filtro, linhas)
  return NextResponse.json({ ok: true })
}
