// src/app/api/torre/precisa-de-voce/acao/route.ts
// ============================================================================
// TORRE DE CONTROLE — EXECUTA UMA AÇÃO DE UM ITEM DO "PRECISA DE VOCÊ" (Bloco F, 29/09/2026; Torre nova, 01/10/2026).
//
//   POST /api/torre/precisa-de-voce/acao
//   body: { acao: "ATRIBUIR_SUGERIDO" | ..., ...parâmetros da ação }
//
// Cada ação já existe como porta canônica (atribuir, cancelar, desbloquear, redistribuir, reconciliar, cobrança, AVANÇO DE FASE pelo
// PhaseAdvanceService) — este endpoint só dispatcha e devolve o resultado real. Ver src/services/precisa-de-voce-acoes.ts.
//
// ACESSO: a guarda da Torre (administrador ou gerência operacional) + a MESMA permissão que a porta individual exige — avançar fase pede
// `workflow.avancar`; forçar/encerrar fase pede `workflow.forcarAvanco`; atribuir/redistribuir/reconciliar/trocar canal pedem `tarefas.editar`;
// desbloquear pede `tarefas.bloquear`. A API confere sempre; esconder o botão na tela é só sugestão.
// ============================================================================
import { respostaAtribuicaoSoNaPagina, veioDaPaginaDoProcesso } from '@/lib/operacional/atribuicao-origem'
import { confirmacaoDoCorpo, pedirConfirmacao } from '@/src/lib/torre-confirmacao'
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import type { PermissaoChave } from '@/src/lib/permissoes'
import * as acoes from '@/src/services/precisa-de-voce-acoes'

const PERMISSAO_DA_ACAO = {
  ATRIBUIR_SUGERIDO: 'tarefas.editar', ATRIBUIR_ESCOLHIDO: 'tarefas.editar', ENCERRAR_NAO_DEVIDA: 'tarefas.editar',
  RECONCILIAR: 'tarefas.editar', VER_3_FONTES: 'tarefas.ver',
  REGISTRAR_LIGACAO: 'tarefas.ver', TROCAR_CANAL: 'tarefas.editar',
  COBRAR_CLIENTE: 'tarefas.ver', DESBLOQUEAR: 'tarefas.bloquear',
  REDISTRIBUIR_CARGA: 'tarefas.editar', VER_EQUIPE: 'tarefas.ver',
  AVANCAR_FASE: 'workflow.avancar', AVANCAR_FASE_FORCADO: 'workflow.forcarAvanco', ENCERRAR_FASE_NAO_DEVIDA: 'workflow.forcarAvanco',
  ABRIR_GERENCIAMENTO: 'usuarios.gerenciar', IGNORAR_7_DIAS: 'usuarios.gerenciar',
} as const satisfies Record<string, PermissaoChave>
type Acao = keyof typeof PERMISSAO_DA_ACAO
const ACOES = Object.keys(PERMISSAO_DA_ACAO) as Acao[]

const idPositivo = (v: unknown): number | null => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null)

export async function POST(request: NextRequest) {
  const b = await request.clone().json().catch(() => ({}))
  const acao = String(b?.acao ?? '') as Acao
  if (!ACOES.includes(acao)) return NextResponse.json({ error: `acao inválida; use uma de ${ACOES.join(', ')}` }, { status: 400 })

  // ATRIBUIÇÃO SÓ NA PÁGINA DO PROCESSO: o item «Sem responsável» do Precisa de você leva ao processo; atribuir (sugerido ou escolhido) só com a origem da página.
  if ((acao === 'ATRIBUIR_SUGERIDO' || acao === 'ATRIBUIR_ESCOLHIDO') && !veioDaPaginaDoProcesso(b)) return NextResponse.json(respostaAtribuicaoSoNaPagina(), { status: 422 })

  const { usuario, erro } = await exigirTorre(request, PERMISSAO_DA_ACAO[acao])
  if (erro) return erro
  const autorId = usuario.userId
  const tarefaId = Number(b?.tarefaId)
  const processoId = idPositivo(b?.processoId)

  try {
    switch (acao) {
      case 'ATRIBUIR_SUGERIDO': {
        // Item "Sem responsável" é de um PROCESSO; `tarefaId` segue valendo para a ação individual (Tarefas, Revisão antiga).
        // SUGESTÃO NUNCA ATRIBUI SOZINHA: 1ª viagem devolve a prévia (428, nada gravado); a 2ª exige `confirmado` + a assinatura da prévia.
        const { confirmado, assinatura } = confirmacaoDoCorpo(b)
        if (!confirmado || assinatura == null) {
          const previa = processoId != null ? await acoes.previaDaSugestaoDoProcesso(processoId) : await acoes.previaDaSugestaoDaTarefa(tarefaId)
          if (!previa) return NextResponse.json({ ok: false, erro: 'Sem sugestão de responsável para confirmar — escolha a pessoa.' }, { status: 422 })
          return pedirConfirmacao(previa)
        }
        const o = { autorNome: usuario.nome, assinaturaConfirmada: assinatura }
        const r = processoId != null ? await acoes.atribuirSugeridoDoProcesso(processoId, autorId, new Date(), o) : await acoes.atribuirSugerido(tarefaId, autorId, o)
        return NextResponse.json(r, { status: r.ok ? 200 : (r as { mudou?: boolean }).mudou ? 409 : 422 })
      }
      case 'ATRIBUIR_ESCOLHIDO': {
        const responsavelId = idPositivo(b?.responsavelId)
        if (responsavelId == null) return NextResponse.json({ error: 'responsavelId é obrigatório' }, { status: 400 })
        const r = processoId != null ? await acoes.atribuirEscolhidoDoProcesso(processoId, responsavelId, autorId) : await acoes.atribuirEscolhido(tarefaId, responsavelId, autorId)
        return NextResponse.json(r, { status: r.ok ? 200 : 422 })
      }
      case 'ENCERRAR_NAO_DEVIDA': {
        const justificativa = String(b?.justificativa ?? '')
        if (!justificativa.trim()) return NextResponse.json({ error: 'justificativa é obrigatória' }, { status: 400 })
        const r = await acoes.encerrarNaoDevida(tarefaId, justificativa, autorId)
        return NextResponse.json(r, { status: r.ok ? 200 : 422 })
      }
      case 'AVANCAR_FASE': {
        if (processoId == null) return NextResponse.json({ error: 'processoId é obrigatório' }, { status: 400 })
        const r = await acoes.avancarFase(processoId, autorId)
        return NextResponse.json(r, { status: r.ok ? 200 : 422 })
      }
      case 'AVANCAR_FASE_FORCADO': {
        if (processoId == null) return NextResponse.json({ error: 'processoId é obrigatório' }, { status: 400 })
        const r = await acoes.avancarFaseForcado(processoId, b?.justificativa, autorId)
        return NextResponse.json(r, { status: r.ok ? 200 : 422 })
      }
      case 'ENCERRAR_FASE_NAO_DEVIDA': {
        if (processoId == null) return NextResponse.json({ error: 'processoId é obrigatório' }, { status: 400 })
        const r = await acoes.encerrarFaseNaoDevida(processoId, b?.justificativa, autorId)
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
        const usuarioId = idPositivo(b?.usuarioId)
        if (usuarioId == null) return NextResponse.json({ error: 'usuarioId é obrigatório' }, { status: 400 })
        const r = await acoes.redistribuirPorCarga(usuarioId, autorId)
        return NextResponse.json(r, { status: r.ok ? 200 : 422 })
      }
      case 'VER_EQUIPE': {
        const usuarioId = idPositivo(b?.usuarioId)
        if (usuarioId == null) return NextResponse.json({ error: 'usuarioId é obrigatório' }, { status: 400 })
        const r = await acoes.verEquipe(usuarioId)
        return NextResponse.json(r, { status: r.ok ? 200 : 404 })
      }
      case 'ABRIR_GERENCIAMENTO': {
        const achadoId = idPositivo(b?.achadoId)
        if (achadoId == null) return NextResponse.json({ error: 'achadoId é obrigatório' }, { status: 400 })
        const r = await acoes.abrirGerenciamento(achadoId)
        return NextResponse.json(r, { status: r.ok ? 200 : 404 })
      }
      case 'IGNORAR_7_DIAS': {
        const achadoId = idPositivo(b?.achadoId)
        const justificativa = String(b?.justificativa ?? '')
        if (achadoId == null) return NextResponse.json({ error: 'achadoId é obrigatório' }, { status: 400 })
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
