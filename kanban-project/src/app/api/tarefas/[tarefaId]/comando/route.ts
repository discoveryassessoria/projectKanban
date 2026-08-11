// src/app/api/tarefas/[tarefaId]/comando/route.ts
// ============================================================================
// A PORTA HTTP DOS COMANDOS DA TAREFA.
//
//   POST /api/tarefas/{id}/comando   { acao, ...campos }
//
// UMA rota para todos os comandos, de propósito. Doze rotas separadas seriam
// doze lugares para esquecer a validação de permissão, doze formatos de erro e
// doze chances de alguém escrever `prisma.tarefa.update` "só desta vez". Aqui a
// rota não conhece Prisma: ela valida quem pode, converte o corpo e chama o
// serviço canônico.
//
// A UI futura não tem outro caminho — e é isso que impede a tela de alterar
// tarefa, etapa, responsável ou prazo por fora do motor.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import type { PermissaoChave } from '@/src/lib/permissoes'
import { atribuirTarefa, iniciarTarefa } from '@/lib/operacional/tarefa-comandos'
import {
  reabrirTarefa, bloquearTarefa, desbloquearTarefa, aguardarTerceiro, retomarDeEspera,
  cancelarTarefa, devolverAFila, alterarPrazo, alterarPrioridade,
  declararDependencia, removerDependencia,
} from '@/lib/operacional/tarefa-ciclo'

/** O código do domínio vira o status HTTP — um mapa só, nenhuma exceção local. */
const HTTP: Record<string, number> = {
  NAO_ENCONTRADA: 404,
  TERMINAL: 409, NAO_TERMINAL: 409, CONFLITO: 409,
  SEM_MOTIVO: 422, INVALIDO: 422, SEM_RESPONSAVEL: 422, MESMO_RESPONSAVEL: 422,
}

/**
 * QUEM PODE O QUÊ.
 *
 * A separação não é hierárquica por capricho: quem EXECUTA move o próprio
 * trabalho (iniciar, esperar terceiro, bloquear quando trava); quem GERE decide
 * de quem é o trabalho e quanto tempo ele tem. Deixar o executor mudar o
 * próprio prazo esvazia o SLA; deixá-lo cancelar a própria tarefa esvazia a
 * fila.
 */
const PERMISSAO: Record<string, PermissaoChave> = {
  iniciar: 'tarefas.iniciar_concluir',
  aguardar_terceiro: 'tarefas.iniciar_concluir',
  retomar_espera: 'tarefas.iniciar_concluir',
  bloquear: 'tarefas.bloquear',
  desbloquear: 'tarefas.bloquear',

  atribuir: 'tarefas.editar',
  transferir: 'tarefas.editar',
  devolver_a_fila: 'tarefas.editar',
  alterar_prazo: 'tarefas.editar',
  alterar_prioridade: 'tarefas.editar',
  reabrir: 'tarefas.editar',
  adicionar_dependencia: 'tarefas.editar',
  remover_dependencia: 'tarefas.editar',

  cancelar: 'tarefas.excluir',
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ tarefaId: string }> }) {
  const tarefaId = Number((await ctx.params).tarefaId)
  if (!Number.isInteger(tarefaId) || tarefaId <= 0) {
    return NextResponse.json({ error: 'tarefa inválida' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const acao = String(body?.acao ?? '')
  const permissao = PERMISSAO[acao]
  if (!permissao) {
    return NextResponse.json(
      { error: `ação desconhecida: "${acao}"`, acoes: Object.keys(PERMISSAO) },
      { status: 400 },
    )
  }

  // A permissão é conferida no BACKEND, sempre — esconder o botão na tela não é
  // controle de acesso, é sugestão.
  const erro = await verificarPermissao(request, permissao)
  if (erro) return erro

  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const autorId = usuario.userId
  const motivo = typeof body?.motivo === 'string' ? body.motivo.slice(0, 300) : ''
  const lockVersion = Number.isInteger(body?.lockVersion) ? (body.lockVersion as number) : undefined

  const executar = async () => {
    switch (acao) {
      case 'atribuir':
      case 'transferir': {
        const responsavelId = Number(body?.responsavelId)
        if (!Number.isInteger(responsavelId) || responsavelId <= 0) {
          return { ok: false as const, codigo: 'INVALIDO', mensagem: 'responsavelId é obrigatório' }
        }
        return atribuirTarefa({ tarefaId, responsavelId, autorId, motivo: motivo || null, lockVersion })
      }
      case 'devolver_a_fila':
        return devolverAFila({ tarefaId, autorId, motivo: motivo || null })
      case 'iniciar':
        // Gestor pode destravar a fila iniciando por outro; o executor, só a sua.
        return iniciarTarefa({ tarefaId, autorId, permiteDeTerceiro: usuario.tipo === 'admin' })
      case 'aguardar_terceiro':
        return aguardarTerceiro({ tarefaId, autorId, motivo })
      case 'retomar_espera':
        return retomarDeEspera({ tarefaId, autorId, motivo: motivo || null })
      case 'bloquear':
        return bloquearTarefa({ tarefaId, autorId, motivo })
      case 'desbloquear':
        return desbloquearTarefa({ tarefaId, autorId, motivo: motivo || null })
      case 'reabrir':
        return reabrirTarefa({
          tarefaId, autorId, motivo,
          stepDestinoId: Number.isInteger(body?.stepDestinoId) ? body.stepDestinoId : null,
        })
      case 'cancelar':
        return cancelarTarefa({ tarefaId, autorId, motivo, codigo: body?.codigo ?? null })
      case 'alterar_prazo': {
        // `null` explícito remove o prazo; ausente é erro, não "sem prazo".
        if (!('novoPrazo' in body)) {
          return { ok: false as const, codigo: 'INVALIDO', mensagem: 'novoPrazo é obrigatório (use null para remover)' }
        }
        const bruto = body.novoPrazo
        const novoPrazo = bruto == null ? null : new Date(String(bruto))
        if (novoPrazo != null && Number.isNaN(novoPrazo.getTime())) {
          return { ok: false as const, codigo: 'INVALIDO', mensagem: 'novoPrazo inválido' }
        }
        return alterarPrazo({ tarefaId, autorId, novoPrazo, motivo })
      }
      case 'alterar_prioridade': {
        const p = String(body?.prioridade ?? '')
        if (!['BAIXA', 'MEDIA', 'ALTA', 'URGENTE'].includes(p)) {
          return { ok: false as const, codigo: 'INVALIDO', mensagem: 'prioridade inválida' }
        }
        return alterarPrioridade({ tarefaId, autorId, prioridade: p as 'BAIXA', motivo: motivo || null })
      }
      case 'adicionar_dependencia': {
        const dependeDeId = Number(body?.dependeDeId)
        if (!Number.isInteger(dependeDeId) || dependeDeId <= 0) {
          return { ok: false as const, codigo: 'INVALIDO', mensagem: 'dependeDeId é obrigatório' }
        }
        return declararDependencia({
          tarefaId, dependeDeId, autorId,
          obrigatoria: body?.obrigatoria !== false, motivo: motivo || null,
        })
      }
      case 'remover_dependencia': {
        const dependeDeId = Number(body?.dependeDeId)
        if (!Number.isInteger(dependeDeId) || dependeDeId <= 0) {
          return { ok: false as const, codigo: 'INVALIDO', mensagem: 'dependeDeId é obrigatório' }
        }
        return removerDependencia({ tarefaId, dependeDeId, autorId })
      }
      default:
        return { ok: false as const, codigo: 'INVALIDO', mensagem: 'ação não implementada' }
    }
  }

  const r = await executar()
  if (!r.ok) {
    return NextResponse.json({ error: r.mensagem, codigo: r.codigo }, { status: HTTP[r.codigo] ?? 422 })
  }
  return NextResponse.json({ tarefaId: r.tarefaId, acao })
}
