// src/app/api/operacao/tarefas/[tarefaId]/registrar-recebimento/route.ts
// ============================================================================
// REGISTRAR RECEBIMENTO — a certidão chegou do cartório (Operação, 07/10/2026).
//
//   POST /api/operacao/tarefas/{id}/registrar-recebimento
//   body: { recebidaEm?: "AAAA-MM-DD", confirmado: true }
//
// Duas viagens, como o resto da Operação: sem `confirmado`, devolve a PRÉVIA em texto claro (o que vai mudar) e não grava nada;
// com `confirmado: true`, grava. Nada exige anexo: o anexo (opcional) é enviado pela tela depois, pela porta de arquivos do documento.
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { registrarRecebimentoDaCertidao } from '@/src/services/registrar-recebimento'
import { dataDeRecebimento, diaMes } from '@/lib/operacional/emissao-recebimento'

export async function POST(request: NextRequest, { params }: { params: Promise<{ tarefaId: string }> }) {
  const erro = await verificarPermissao(request, 'tarefas.ver')
  if (erro) return erro
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const { tarefaId: bruto } = await params
  const tarefaId = Number(bruto)
  if (!Number.isInteger(tarefaId)) return NextResponse.json({ ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Tarefa inválida.' }, { status: 400 })
  const corpo = (await request.json().catch(() => ({}))) as { recebidaEm?: string; confirmado?: boolean }

  if (corpo.confirmado !== true) {
    // Prévia: só valida a data e diz o que vai acontecer. Quem pode e o estado são conferidos na gravação.
    const dia = corpo.recebidaEm?.trim() || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
    const data = dataDeRecebimento(dia)
    if (!data) return NextResponse.json({ ok: false, codigo: 'DATA_INVALIDA', mensagem: 'A data de recebimento é inválida ou está no futuro.' }, { status: 422 })
    return NextResponse.json({
      ok: true, previa: true,
      pergunta: `Registrar que a certidão foi recebida em ${diaMes(data)}? Isso conclui "Receber certidão", libera "Conferir e validar certidão" para você e tira a certidão de Aguardando.`,
    })
  }

  const r = await registrarRecebimentoDaCertidao({
    tarefaId, usuario: { userId: usuario.userId, tipo: usuario.tipo }, recebidaEm: corpo.recebidaEm ?? null,
  })
  if (r.ok) return NextResponse.json(r)
  const status = r.codigo === 'SEM_PERMISSAO' ? 403 : r.codigo === 'NAO_ENCONTRADA' ? 404 : r.codigo === 'DATA_INVALIDA' ? 422 : 409
  return NextResponse.json(r, { status })
}
