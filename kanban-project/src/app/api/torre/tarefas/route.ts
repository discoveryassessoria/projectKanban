// src/app/api/torre/tarefas/route.ts
// ============================================================================
// TORRE — A LISTA DE TAREFAS (Bloco G, 30/09/2026).
//
//   GET /api/torre/tarefas[?pais=&faseMacroKey=&processoId=&responsavelId=&busca=…]
//
// A MESMA projeção da Operação (ver `torre-tarefas.ts`) + o que as ações
// precisam, e as PERMISSÕES do chamador — a tela só mostra o botão que a API
// aceitaria (e a API confere de novo em cada ação).
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { temPermissao } from '@/src/lib/permissoes'
import { parseFiltrosGerenciais } from '@/lib/operacional/parse-filtros-gerenciais'
import { listarTarefasDaTorre } from '@/src/services/torre-tarefas'
import { processosCriticos, anotarRisco } from '@/lib/operacional/torre-processos'

export async function GET(request: NextRequest) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const filtros = parseFiltrosGerenciais(request)
  const { porPagina: _p, pagina: _pg, ...semPagina } = filtros as typeof filtros & { porPagina?: number; pagina?: number }
  // Os filtros de equipe (Bloco A) que o parser genérico não lê.
  const sp = request.nextUrl.searchParams
  if (sp.get('pais')) semPagina.pais = sp.get('pais')
  if (sp.get('responsavelId')) semPagina.responsavelId = Number(sp.get('responsavelId'))
  if (sp.get('faseMacroKey')) semPagina.faseMacroKey = sp.get('faseMacroKey')
  const processoId = sp.get('processoId') ?? sp.get('processo')
  if (processoId) semPagina.processoId = Number(processoId)
  const [r, criticos] = await Promise.all([listarTarefasDaTorre(semPagina), processosCriticos()])
  const pode = (p: Parameters<typeof temPermissao>[1]) => temPermissao(usuario.permissoes, p)
  return NextResponse.json({
    ...r,
    // Cada linha diz se o processo dela está em risco CRÍTICO (o cartão "Processos em risco" e o filtro dele usam isto).
    linhas: anotarRisco(r.linhas, criticos),
    permissoes: {
      editar: pode('tarefas.editar'),
      bloquear: pode('tarefas.bloquear'),
      iniciar: pode('tarefas.iniciar_concluir'),
      equipe: pode('usuarios.gerenciar'),
      admin: usuario.tipo === 'admin',
      usuarioId: usuario.userId,
    },
  })
}
