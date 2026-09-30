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

export interface UsuarioDoHistorico { userId: number; nome: string; permissoes: MapaPermissoes }

export const idDoProcesso = (bruto: string): number | null => { const n = Number(bruto); return Number.isInteger(n) && n > 0 ? n : null }

async function auditarExportacao(processoId: number, usuario: UsuarioDoHistorico, formato: 'csv' | 'pdf', filtro: string, linhas: number) {
  await prisma.logAuditoria.create({
    data: {
      acao: 'HISTORICO_EXPORTADO', entidade: 'Processo', entidadeId: processoId, usuarioId: usuario.userId,
      descricao: `Histórico do processo exportado em ${formato.toUpperCase()}: ${linhas} fato(s) (${filtro || 'sem filtros'}).`,
      detalhes: { formato, filtro, linhas },
    },
  })
}

export async function getHistorico(request: Request, processoId: number, usuario: UsuarioDoHistorico): Promise<NextResponse> {
  const url = new URL(request.url)
  const agora = new Date()
  const h = await historicoDoProcesso(processoId, { agora })
  if (!h) return NextResponse.json({ error: 'processo não encontrado' }, { status: 404 })

  if (url.searchParams.get('formato') === 'csv') {
    const filtros = filtrosDaQuery(url.searchParams)
    const fatos = filtrarFatos(h.fatos, filtros, agora)
    await auditarExportacao(processoId, usuario, 'csv', queryDosFiltros(filtros).toString(), fatos.length)
    return new NextResponse(csvDoHistorico(fatos), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nomeDoArquivo(h.processo.nome, 'csv', agora)}"`,
        'X-Historico-Fatos': String(fatos.length), 'X-Historico-Total': String(h.fatos.length),
      },
    })
  }
  return NextResponse.json({ ...h, permissoes: { reabrir: temPermissao(usuario.permissoes, 'tarefas.editar') } })
}

export async function postHistorico(request: Request, processoId: number, usuario: UsuarioDoHistorico): Promise<NextResponse> {
  const b = await request.json().catch(() => ({}))
  if (b?.formato !== 'pdf') return NextResponse.json({ error: 'formato inválido; o CSV é gerado pelo GET (?formato=csv)' }, { status: 400 })
  const existe = await prisma.processo.findUnique({ where: { id: processoId }, select: { id: true } })
  if (!existe) return NextResponse.json({ error: 'processo não encontrado' }, { status: 404 })
  const linhas = Number.isInteger(b?.linhas) && b.linhas >= 0 ? (b.linhas as number) : 0
  const filtro = typeof b?.filtros === 'string' ? b.filtros.slice(0, 500) : ''
  await auditarExportacao(processoId, usuario, 'pdf', filtro, linhas)
  return NextResponse.json({ ok: true })
}
