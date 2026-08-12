// src/app/api/tarefas/manual/route.ts
// ============================================================================
// CRIAR TAREFA MANUAL — trabalho que o cadastro não previu.
//
// Separada da porta de comandos porque aqui a tarefa ainda NÃO EXISTE: não há
// `tarefaId` na URL, e o corpo é o da criação. Todo o resto continua igual —
// permissão no backend, serviço canônico, auditoria.
//
// O aviso de possível duplicidade volta como resposta ESTRUTURADA (409 com a
// lista), não como erro opaco: a UI precisa poder mostrar quais tarefas já
// existem e deixar a pessoa decidir entre reabrir e criar mesmo assim.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { criarTarefaManual, tarefasSemelhantesAbertas } from '@/lib/operacional/tarefa-ciclo'

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'tarefas.criar')
  if (erro) return erro
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  const b = await request.json().catch(() => ({}))
  const processoId = Number(b?.processoId)
  if (!Number.isInteger(processoId) || processoId <= 0) {
    return NextResponse.json({ error: 'processoId é obrigatório' }, { status: 400 })
  }

  const r = await criarTarefaManual({
    processoId,
    titulo: String(b?.titulo ?? ''),
    autorId: usuario.userId,
    faseMacroKey: b?.faseMacroKey ?? null,
    pessoaId: Number.isInteger(b?.pessoaId) ? b.pessoaId : null,
    documentoId: Number.isInteger(b?.documentoId) ? b.documentoId : null,
    necessidadeId: Number.isInteger(b?.necessidadeId) ? b.necessidadeId : null,
    equipeKey: typeof b?.equipeKey === 'string' ? b.equipeKey : null,
    responsavelId: Number.isInteger(b?.responsavelId) ? b.responsavelId : null,
    prioridade: ['BAIXA', 'MEDIA', 'ALTA', 'URGENTE'].includes(b?.prioridade) ? b.prioridade : undefined,
    slaDays: Number.isInteger(b?.slaDays) ? b.slaDays : null,
    dataPrazo: b?.dataPrazo ? new Date(String(b.dataPrazo)) : null,
    motivo: String(b?.motivo ?? ''),
    confirmarDuplicidade: b?.confirmarDuplicidade === true,
  })

  if (!r.ok) {
    if (r.codigo === 'CONFLITO') {
      // A UI precisa da LISTA para oferecer "reabrir aquela" ou "criar mesmo
      // assim". Devolver só a mensagem obrigaria a tela a adivinhar quais são.
      const semelhantes = await tarefasSemelhantesAbertas({
        processoId,
        pessoaId: Number.isInteger(b?.pessoaId) ? b.pessoaId : null,
        documentoId: Number.isInteger(b?.documentoId) ? b.documentoId : null,
        necessidadeId: Number.isInteger(b?.necessidadeId) ? b.necessidadeId : null,
      })
      return NextResponse.json(
        { error: r.mensagem, codigo: r.codigo, semelhantes, comoConfirmar: 'reenvie com confirmarDuplicidade: true' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: r.mensagem, codigo: r.codigo }, { status: 422 })
  }
  return NextResponse.json({ tarefaId: r.tarefaId, semelhantes: r.semelhantes })
}
