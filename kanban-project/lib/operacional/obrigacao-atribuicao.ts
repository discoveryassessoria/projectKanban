// lib/operacional/obrigacao-atribuicao.ts
// ============================================================================
// OBRIGAÇÃO ADMINISTRATIVA — ATRIBUIR_RESPONSAVEL.
//
// "15 tarefas sem responsável na Grisotto" não é 15 interrupções, e também
// não é uma pendência FANTASMA calculada por fora: é UMA Tarefa canônica real
// — TAREFA é a unidade canônica de trabalho operacional do Discovery (regra
// suprema #1) — só que de OUTRA natureza: `tipo: ADMINISTRATIVA`. Ela
// representa o trabalho de GERIR a distribuição, nunca o trabalho de obter a
// certidão. Por isso aparece em Minha Operação, Tarefas e Projetos, Home e no
// sino pelos MESMOS mecanismos que qualquer Tarefa — nenhuma projeção nova.
//
// IDENTIDADE: `processoId + ATRIBUIR_RESPONSAVEL`. No máximo UMA obrigação
// ABERTA por processo — nunca uma cópia por tarefa sem responsável, nunca uma
// cópia por usuário competente. `chaveIdempotencia` é o mesmo mecanismo que
// `passo-tarefa.ts` já usa para nunca duplicar uma unidade de trabalho — aqui
// versionada (`:v${n}`) porque, ao contrário de uma certidão, esta obrigação
// pode abrir, fechar e abrir de novo várias vezes na vida do processo (uma
// tarefa encerrada não ressuscita — a mesma regra de `passo-tarefa.ts` — por
// isso o reabrir nasce OUTRA linha, nunca um `update` na antiga).
//
// SEM CIRCULARIDADE: esta Tarefa nasce SEMPRE com `responsavelId` já
// resolvido (`usuarioResponsavelPelaDistribuicao`). Ela nunca entra na
// contagem de "sem responsável" que ela própria existe para resolver —
// `contarSemResponsavelDistribuivel` também filtra `tipo: NORMAL`,
// pertencimento e pertencimento algum a esta obrigação, por reforço.
//
// PROJEÇÃO DA VERDADE ATUAL, NÃO EVENTO. `reconciliarObrigacaoDeAtribuicao`
// não é disparada só no avanço de fase: é chamada em TODO ponto que muda
// quantas tarefas de um processo estão sem responsável — materialização
// (`passo-tarefa.ts`), atribuição/transferência (`atribuirTarefa`) e devolução
// à fila (`devolverAFila`). Cada chamada faz a MESMA pergunta ("quantas
// tarefas distribuíveis deste processo estão sem responsável agora?") e ajusta
// a obrigação para bater com a resposta — nunca confia no evento que a
// chamou. Por isso funciona igual para cadastro inicial, avanço, retrocesso,
// operação antecipada e reconciliação: nenhum desses caminhos precisa saber
// que esta obrigação existe, e todos convergem para o mesmo resultado.
//
// O CONTADOR NUNCA É ESCRITO NA LINHA. "15 aguardando distribuição" é
// recalculado na leitura (mesma `contarSemResponsavelDistribuivel`) sempre
// que a obrigação é apresentada — nunca uma coluna que possa ficar velha.
// ============================================================================

import { type Prisma, TipoTarefa, type StatusTarefa } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { STATUS_ATIVOS, STATUS_TERMINAIS } from "./tarefa-canonica"
import { calcularPermissoes, temPermissao, type MapaPermissoes } from "@/src/lib/permissoes"
import { notificarAcontecimento } from "./notificacao-canonica"
import { urlDistribuicaoDoProcesso } from "./navegacao"
import { criarTarefaAdministrativa, concluirTarefaAdministrativa } from "./tarefa-ciclo"

type DB = Prisma.TransactionClient | typeof prisma

/** Marca só desta obrigação — nunca confundir com origem "workflow" (certidões). */
export const ORIGEM_OBRIGACAO_ATRIBUICAO = "obrigacao-atribuicao"

const CHAVE_BASE = (processoId: number) => `obrigacao-atribuicao:${processoId}`

/**
 * QUEM está resolvido HOJE para receber a obrigação — pela COMPETÊNCIA
 * (`operacao.distribuirTarefas`), nunca por `tipo === 'admin'` direto.
 * Hoje só o Administrador tem a competência por padrão (regra-base de
 * `calcularPermissoes`); conceder a um Gerente é cadastro (perfil/custom),
 * não uma mudança nesta função. Determinístico: o menor `id` entre os
 * competentes — para duas leituras no mesmo instante concordarem.
 */
export async function usuarioResponsavelPelaDistribuicao(db: DB): Promise<number | null> {
  const usuarios = await db.usuario.findMany({
    select: { id: true, tipo: true, permissoesCustom: true, perfil: { select: { permissoes: true } } },
    orderBy: { id: "asc" },
  })
  for (const u of usuarios) {
    const efetivas = calcularPermissoes(
      u.tipo,
      (u.perfil?.permissoes as MapaPermissoes | null) ?? null,
      (u.permissoesCustom as MapaPermissoes | null) ?? null,
    )
    if (temPermissao(efetivas, "operacao.distribuirTarefas")) return u.id
  }
  return null
}

/**
 * Quantas tarefas DISTRIBUÍVEIS (canônicas, `tipo: NORMAL`, ativas) deste
 * processo estão sem responsável AGORA. Nunca histórico, nunca concluída,
 * cancelada, inválida ou meramente encerrada — `STATUS_ATIVOS` já garante
 * isso. Nunca conta a própria obrigação administrativa (ela sempre tem
 * responsável; o filtro de `tipo` é reforço, não a única barreira).
 */
export async function contarSemResponsavelDistribuivel(db: DB, processoId: number): Promise<number> {
  return db.tarefa.count({
    where: {
      processoId,
      tipo: TipoTarefa.NORMAL,
      responsavelId: null,
      statusTarefa: { in: STATUS_ATIVOS as StatusTarefa[] },
    },
  })
}

/** A obrigação ABERTA deste processo, se existir — nunca mais de uma por desenho. */
async function obrigacaoAtribuicaoAberta(db: DB, processoId: number) {
  return db.tarefa.findFirst({
    where: {
      processoId,
      tipo: TipoTarefa.ADMINISTRATIVA,
      origem: ORIGEM_OBRIGACAO_ATRIBUICAO,
      concluida: false,
      statusTarefa: { notIn: STATUS_TERMINAIS as StatusTarefa[] },
    },
    orderBy: { id: "desc" },
  })
}

/**
 * RECONCILIA a obrigação de atribuição do processo com o estado real AGORA.
 *
 * Chamar depois de QUALQUER mudança que possa ter alterado quantas tarefas
 * deste processo estão sem responsável — nunca só no avanço de fase.
 * Idempotente: chamar de novo sem nada ter mudado não faz nada.
 */
export async function reconciliarObrigacaoDeAtribuicao(db: DB, processoId: number): Promise<void> {
  const semResponsavel = await contarSemResponsavelDistribuivel(db, processoId)
  const aberta = await obrigacaoAtribuicaoAberta(db, processoId)

  if (semResponsavel > 0) {
    if (aberta) return // já existe, e o contador é lido na apresentação — nada a escrever.
    await abrirObrigacaoDeAtribuicao(db, processoId, semResponsavel)
    return
  }

  // Zero sem responsável: se havia obrigação aberta, ela terminou — concluir,
  // nunca cancelar (o trabalho de distribuir foi feito, não abandonado).
  if (aberta) await concluirObrigacaoDeAtribuicao(db, aberta.id)
}

async function abrirObrigacaoDeAtribuicao(db: DB, processoId: number, quantidadeAgora: number): Promise<void> {
  const responsavelId = await usuarioResponsavelPelaDistribuicao(db)
  // NINGUÉM tem a competência hoje: não cria a obrigação sem dono — isso
  // reabriria exatamente a circularidade que este desenho existe para evitar.
  // É uma lacuna de configuração real; melhor a obrigação faltar visivelmente
  // (nenhuma tarefa administrativa aparece) do que nascer quebrada.
  if (responsavelId == null) return

  const processo = await db.processo.findUnique({ where: { id: processoId }, select: { nome: true } })
  const nomeProcesso = processo?.nome ?? `Processo ${processoId}`

  // VERSIONADA — reabrir depois de uma conclusão é OUTRA linha (mesma regra
  // de `passo-tarefa.ts`: tarefa encerrada não ressuscita), nunca um update na
  // antiga. `n` = quantas vezes esta obrigação já existiu para este processo.
  const jaExistiram = await db.tarefa.count({
    where: { processoId, tipo: TipoTarefa.ADMINISTRATIVA, origem: ORIGEM_OBRIGACAO_ATRIBUICAO },
  })
  const chave = `${CHAVE_BASE(processoId)}:v${jaExistiram + 1}`

  // A ESCRITA mora em tarefa-ciclo.ts (dono único de estado operacional de
  // Tarefa) — SEM workflowInstanceId/workflowStepInstanceId/necessidadeId/
  // documentoId/faseMacroKey/dataPrazo, DE PROPÓSITO: esta tarefa não
  // pertence ao Workflow Interno de nenhuma certidão, não participa de
  // progresso de fase, e não herda SLA operacional automaticamente.
  const criada = await criarTarefaAdministrativa(db, {
    processoId,
    titulo: `Atribuir tarefas — ${nomeProcesso}`,
    responsavelId,
    chaveIdempotencia: chave,
    origem: ORIGEM_OBRIGACAO_ATRIBUICAO,
  })
  // `null` = corrida: outra chamada criou a MESMA chave entre a leitura e
  // esta escrita. Idempotente — a que já existe é a verdade, não um erro.
  if (!criada) return
  const tarefaId = criada.tarefaId

  await notificarAcontecimento(db, {
    tipo: "DISTRIBUICAO_NECESSARIA",
    destinatarioId: responsavelId,
    tarefaId,
    titulo: `${nomeProcesso} — tarefas aguardando atribuição`,
    mensagem: `${quantidadeAgora} tarefa${quantidadeAgora === 1 ? "" : "s"} precisa${quantidadeAgora === 1 ? "" : "m"} de responsável.`,
    // `urlOperacionalDaTarefa` levaria ao Kanban do processo (pessoa/documento/
    // passo) — esta obrigação não tem nenhum dos três. O lugar onde ela se
    // executa é a Central Operacional gerencial, com o painel de distribuição
    // desta família já aberto.
    link: urlDistribuicaoDoProcesso(processoId),
    chaveIdempotencia: `notif::${chave}`,
  })

  await db.logAuditoria.create({
    data: {
      acao: "OBRIGACAO_ATRIBUICAO_ABERTA",
      entidade: "Tarefa",
      entidadeId: tarefaId,
      usuarioId: null,
      descricao: `Obrigação administrativa aberta: distribuir ${quantidadeAgora} tarefa(s) sem responsável de "${nomeProcesso}".`,
      detalhes: { processoId, responsavelId, quantidadeNaAbertura: quantidadeAgora } as never,
    },
  }).catch(() => null)
}

async function concluirObrigacaoDeAtribuicao(db: DB, tarefaId: number): Promise<void> {
  // A ESCRITA mora em tarefa-ciclo.ts (dono único de estado operacional de Tarefa).
  await concluirTarefaAdministrativa(db, tarefaId)
  // Item 7 do mandato: "com zero, deixa de existir como pendência" — vale
  // para o sino também. Sem isto a notificação de abertura ficava `lidaEm:
  // null` para sempre, mesmo depois de a obrigação já ter sido resolvida.
  await db.notificacaoOperacional.updateMany({
    where: { tarefaId, lidaEm: null },
    data: { lidaEm: new Date() },
  })
  await db.logAuditoria.create({
    data: {
      acao: "OBRIGACAO_ATRIBUICAO_CONCLUIDA",
      entidade: "Tarefa",
      entidadeId: tarefaId,
      usuarioId: null,
      descricao: "Obrigação administrativa concluída: todas as tarefas do processo já têm responsável.",
      detalhes: {} as never,
    },
  }).catch(() => null)
}
