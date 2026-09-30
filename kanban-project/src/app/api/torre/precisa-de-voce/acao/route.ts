// src/app/api/torre/precisa-de-voce/acao/route.ts
// ============================================================================
// TORRE DE CONTROLE — BLOCO F: EXECUTA UMA AÇÃO DE UM ITEM (29/09/2026).
//
//   POST /api/torre/precisa-de-voce/acao
//   body: { acao: "ATRIBUIR_SUGERIDO" | ..., ...parâmetros da ação }
//
// Cada ação já existe como porta canônica (atribuir, cancelar, desbloquear,
// redistribuir, reconciliar, cobrança) — este endpoint só dispatcha e devolve
// o resultado real. Ver src/services/precisa-de-voce-acoes.ts.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import * as acoes from '@/src/services/precisa-de-voce-acoes'

const ACOES = [
  'ATRIBUIR_SUGERIDO', 'ATRIBUIR_ESCOLHIDO', 'ENCERRAR_NAO_DEVIDA',
  'RECONCILIAR', 'VER_3_FONTES',
  'REGISTRAR_LIGACAO', 'TROCAR_CANAL',
  'COBRAR_CLIENTE', 'DESBLOQUEAR',
  'REDISTRIBUIR_CARGA', 'VER_EQUIPE',
  'ABRIR_GERENCIAMENTO', 'IGNORAR_7_DIAS',
] as const
type Acao = (typeof ACOES)[number]

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  const b = await request.json().catch(() => ({}))
  const acao = String(b?.acao ?? '') as Acao
  if (!ACOES.includes(acao)) return NextResponse.json({ error: `acao inválida; use uma de ${ACOES.join(', ')}` }, { status: 400 })

  const tarefaId = Number(b?.tarefaId)
  const autorId = usuario.userId

  try {
    switch (acao) {
      case 'ATRIBUIR_SUGERIDO': {
        const r = await acoes.atribuirSugerido(tarefaId, autorId)
        return NextResponse.json(r, { status: r.ok ? 200 : 422 })
      }
      case 'ATRIBUIR_ESCOLHIDO': {
        const responsavelId = Number(b?.responsavelId)
        if (!Number.isInteger(responsavelId) || responsavelId <= 0) return NextResponse.json({ error: 'responsavelId é obrigatório' }, { status: 400 })
        const r = await acoes.atribuirEscolhido(tarefaId, responsavelId, autorId)
        return NextResponse.json(r, { status: r.ok ? 200 : 422 })
      }
      case 'ENCERRAR_NAO_DEVIDA': {
        const justificativa = String(b?.justificativa ?? '')
        if (!justificativa.trim()) return NextResponse.json({ error: 'justificativa é obrigatória' }, { status: 400 })
        const r = await acoes.encerrarNaoDevida(tarefaId, justificativa, autorId)
        return NextResponse.json(r, { status: r.ok ? 200 : 422 })
      }
      case 'RECONCILIAR': {
        const r = await acoes.reconciliar(tarefaId, autorId)
        return NextResponse.json(r, { status: r.ok ? 200 : 422 })
      }
      case 'VER_3_FONTES': {
        const r = await acoes.ver3Fontes(tarefaId)
        return NextResponse.json(r, { status: r.ok ? 200 : 404 })
      }
      case 'REGISTRAR_LIGACAO': {
        const r = await acoes.registrarLigacao(tarefaId, autorId, typeof b?.observacao === 'string' ? b.observacao : null, typeof b?.resultado === 'string' ? b.resultado.toUpperCase() : undefined)
        return NextResponse.json(r, { status: r.ok ? 200 : 422 })
      }
      case 'TROCAR_CANAL': {
        const novoCanal = String(b?.canal ?? '')
        const r = await acoes.trocarCanal(tarefaId, novoCanal, autorId)
        return NextResponse.json(r, { status: r.ok ? 200 : 422 })
      }
      case 'COBRAR_CLIENTE': {
        const r = await acoes.cobrarCliente(tarefaId, autorId, typeof b?.texto === 'string' ? b.texto : null)
        return NextResponse.json(r, { status: r.ok ? 200 : 422 })
      }
      case 'DESBLOQUEAR': {
        const r = await acoes.desbloquear(tarefaId, autorId, typeof b?.motivo === 'string' ? b.motivo : null)
        return NextResponse.json(r, { status: r.ok ? 200 : 422 })
      }
      case 'REDISTRIBUIR_CARGA': {
        const usuarioId = Number(b?.usuarioId)
        if (!Number.isInteger(usuarioId) || usuarioId <= 0) return NextResponse.json({ error: 'usuarioId é obrigatório' }, { status: 400 })
        const r = await acoes.redistribuirPorCarga(usuarioId, autorId, Number.isInteger(b?.limite) ? Number(b.limite) : 5)
        return NextResponse.json(r, { status: r.ok ? 200 : 422 })
      }
      case 'VER_EQUIPE': {
        const usuarioId = Number(b?.usuarioId)
        if (!Number.isInteger(usuarioId) || usuarioId <= 0) return NextResponse.json({ error: 'usuarioId é obrigatório' }, { status: 400 })
        const r = await acoes.verEquipe(usuarioId)
        return NextResponse.json(r, { status: r.ok ? 200 : 404 })
      }
      case 'ABRIR_GERENCIAMENTO': {
        const achadoId = Number(b?.achadoId)
        if (!Number.isInteger(achadoId) || achadoId <= 0) return NextResponse.json({ error: 'achadoId é obrigatório' }, { status: 400 })
        const r = await acoes.abrirGerenciamento(achadoId)
        return NextResponse.json(r, { status: r.ok ? 200 : 404 })
      }
      case 'IGNORAR_7_DIAS': {
        const achadoId = Number(b?.achadoId)
        const justificativa = String(b?.justificativa ?? '')
        if (!Number.isInteger(achadoId) || achadoId <= 0) return NextResponse.json({ error: 'achadoId é obrigatório' }, { status: 400 })
        if (!justificativa.trim()) return NextResponse.json({ error: 'justificativa é obrigatória' }, { status: 400 })
        const r = await acoes.ignorar7Dias(achadoId, justificativa, autorId)
        return NextResponse.json(r, { status: r.ok ? 200 : 422 })
      }
    }
  } catch (e) {
    console.error('[torre/precisa-de-voce/acao]', e)
    return NextResponse.json({ error: 'erro ao executar a ação' }, { status: 500 })
  }
}
