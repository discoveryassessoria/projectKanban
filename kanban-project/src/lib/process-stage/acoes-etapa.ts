// src/lib/process-stage/acoes-etapa.ts
//
// AÇÕES PERMITIDAS NUMA ETAPA — decisão de DOMÍNIO, calculada no servidor.
//
// O frontend não infere mais o que pode fazer a partir do status ("se status !==
// concluida, mostra Concluir/Bloquear/Transferir/Forçar"). Ele RECEBE a lista de
// ações e desenha o que veio. A mesma função é usada pelo enforcement das rotas,
// então o que a tela oferece e o que o servidor aceita não podem divergir.
//
// PURO: sem prisma, sem React. Recebe estado + permissões, devolve ações.

import type { StepInstanceStatus } from "@prisma/client"
import type { PermissaoChave } from "@/src/lib/permissoes"

export type AcaoEtapa =
  | "salvar_andamento"
  | "registrar_contato"
  | "registrar_observacao"
  | "anexar"
  | "transferir"
  | "alterar_prazo"
  | "bloquear"
  | "desbloquear"
  | "concluir"
  | "reabrir"
  | "forcar"

/** Permissão exigida por ação. Fonte ÚNICA — rota e UI leem daqui. */
export const PERMISSAO_DA_ACAO: Record<AcaoEtapa, PermissaoChave> = {
  salvar_andamento: "workflow.iniciarPasso",
  registrar_contato: "workflow.iniciarPasso",
  registrar_observacao: "workflow.iniciarPasso",
  anexar: "workflow.iniciarPasso",
  transferir: "workflow.gerarTarefa",
  alterar_prazo: "workflow.iniciarPasso",
  bloquear: "tarefas.bloquear",
  desbloquear: "tarefas.bloquear",
  concluir: "workflow.concluirPasso",
  reabrir: "workflow.reabrirFase",
  // "Forçar" é função ADMINISTRATIVA auditada — nunca o caminho normal de execução.
  forcar: "workflow.forcarAvanco",
}

/** Estados em que a etapa aceita trabalho operacional. */
const EXECUTAVEIS: StepInstanceStatus[] = [
  "PENDENTE",
  "DISPONIVEL",
  "EM_ANDAMENTO",
  "AGUARDANDO",
  "EXECUTADO",
  "AGUARDANDO_APROVACAO",
]

const ENCERRADOS: StepInstanceStatus[] = ["CANCELADO", "SUPERSEDIDO", "DISPENSADO"]

export interface ContextoAcoes {
  status: StepInstanceStatus
  /** Mapa de permissões efetivas do usuário. null = sem usuário resolvido. */
  permissoes: Record<string, boolean> | null
}

/**
 * Ações que a etapa aceita AGORA, para ESTE usuário.
 * Ordem estável (a UI não reordena) e sem duplicatas.
 */
export function acoesPermitidasDaEtapa(ctx: ContextoAcoes): AcaoEtapa[] {
  const { status } = ctx
  if (ENCERRADOS.includes(status)) return []

  const candidatas: AcaoEtapa[] = []

  if (status === "CONCLUIDO") {
    candidatas.push("reabrir")
  } else if (status === "BLOQUEADO") {
    // Etapa bloqueada não executa, mas o registro do que aconteceu continua valendo:
    // é exatamente enquanto está travada que a equipe precisa anotar contato e motivo.
    candidatas.push("registrar_contato", "registrar_observacao", "anexar", "desbloquear", "transferir", "forcar")
  } else if (EXECUTAVEIS.includes(status)) {
    candidatas.push(
      "salvar_andamento",
      "registrar_contato",
      "registrar_observacao",
      "anexar",
      "alterar_prazo",
      "transferir",
      "bloquear",
      "concluir",
      "forcar",
    )
  }

  if (!ctx.permissoes) return []
  return candidatas.filter((a) => ctx.permissoes?.[PERMISSAO_DA_ACAO[a]] === true)
}

/** A ação está liberada neste estado, ignorando permissão? (usado nas mensagens de erro) */
export function acaoCompativelComEstado(acao: AcaoEtapa, status: StepInstanceStatus): boolean {
  return acoesPermitidasDaEtapa({
    status,
    permissoes: { [PERMISSAO_DA_ACAO[acao]]: true },
  }).includes(acao)
}
