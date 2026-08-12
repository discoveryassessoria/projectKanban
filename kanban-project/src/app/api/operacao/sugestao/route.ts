// src/app/api/operacao/sugestao/route.ts
// ============================================================================
// A SIMULAÇÃO DE DISTRIBUIÇÃO — recomendação, nunca atribuição.
//
//   GET /api/operacao/sugestao?taskId=123        uma tarefa
//   GET /api/operacao/sugestao?lote=1            todas as sem responsável
//
// Esta rota OPINA. Ela não atribui, não altera `responsavelId`, não notifica
// ninguém. Quem confirma continua sendo o gestor, por `POST
// /api/tarefas/{id}/comando` com `acao: "atribuir"` — a mesma porta de sempre.
//
// É um GET de propósito, e não um POST: um POST sugere efeito, e a garantia
// desta rodada é justamente que não há efeito nenhum. Se um dia isto virar
// distribuição automática, o método muda junto com a semântica.
//
// ─── PERMISSÃO ──────────────────────────────────────────────────────────────
// Ver quem PODERIA receber a tarefa alheia é ato de gestão: `tarefas.editar`,
// a mesma de atribuir. A resposta expõe a carga de cada funcionário — não é
// informação de quem só executa.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { simularTarefa, simularLote } from '@/lib/operacional/elegibilidade'

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'tarefas.editar')
  if (erro) return erro

  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  const p = request.nextUrl.searchParams
  const bruto = p.get('taskId')
  const taskId = Number(bruto)

  if (bruto != null && bruto !== '') {
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return NextResponse.json({ error: 'taskId inválido' }, { status: 400 })
    }
    return NextResponse.json({ simulacao: await simularTarefa(taskId) })
  }

  if (p.get('lote') === '1' || p.get('lote') === 'true') {
    const limite = Number(p.get('limite'))
    return NextResponse.json(await simularLote({ limite: Number.isInteger(limite) ? limite : undefined }))
  }

  return NextResponse.json(
    { error: 'informe taskId=<id> ou lote=1' },
    { status: 400 },
  )
}
