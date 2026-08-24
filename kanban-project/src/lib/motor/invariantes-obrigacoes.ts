// src/lib/motor/invariantes-obrigacoes.ts
//
// INVARIANTE DE DOMÍNIO — mover o processo de fase NÃO altera obrigação alheia.
//
// A posição operacional do processo (Processo.faseAtualKey) e o ESTADO DAS
// OBRIGAÇÕES (passos e tarefas de cada fase/ciclo) são coisas separadas. Mover o
// card muda a primeira; a segunda só muda por execução real do trabalho ou por uma
// operação própria e auditada do domínio (concluir, dispensar, cancelar).
//
// Por isso a movimentação tira uma FOTOGRAFIA das obrigações antes e depois, dentro
// da MESMA transação, e recusa o commit se alguma obrigação ALHEIA tiver mudado.
// "Alheia" = qualquer passo/tarefa que não pertença à instância de destino criada ou
// convergida por esta operação. É uma trava de escrita, não um aviso de tela: se o
// invariante quebrar, a movimentação inteira volta atrás.
//
// SUPERSEDIDO no CICLO não é cancelamento da OBRIGAÇÃO. Um ciclo supersedido deixou
// de ser a referência operacional; as tarefas dele continuam com o status real que
// tinham, continuam pendentes e continuam cobráveis. Este módulo é o que garante
// isso na prática — nada aqui olha para o status do ciclo, só para o das obrigações.
//
// PURO na comparação (comparar não toca no banco); a fotografia é uma leitura.

import type { Prisma } from "@prisma/client"

// --------------------------------------------------------------------------
// Fotografia
// --------------------------------------------------------------------------

/** Estado observável de UMA obrigação (passo de workflow ou tarefa). */
export interface ObrigacaoFotografada {
  /** "passo:123" | "tarefa:456" — identidade estável entre as duas fotografias. */
  chave: string
  tipo: "PASSO" | "TAREFA"
  id: number
  /** Instância de fase a que a obrigação pertence (null = tarefa solta). */
  workflowInstanceId: number | null
  faseMacroKey: string | null
  ciclo: number | null
  status: string
  obrigatorio: boolean
  concluidoEm: string | null
  /** Para TAREFA: o passo do qual ela é projeção. `null` em tarefa avulsa. */
  passoId?: number | null
}

export interface FotografiaObrigacoes {
  processoId: number
  /** Todas as obrigações do processo, por chave. */
  porChave: Map<string, ObrigacaoFotografada>
  /** Contagem de pendentes obrigatórias por fase — o número que o usuário cobra. */
  pendentesPorFase: Map<string, number>
  total: number
}

const PASSO_ENCERRADO = new Set(["CONCLUIDO", "DISPENSADO", "SUPERSEDIDO", "CANCELADO", "FALHOU"])

/**
 * Fotografa as obrigações do processo. Lê SEMPRE pelo cliente de quem chama — sob
 * transação, é a única forma de ver o que a própria transação escreveu (e de não
 * pedir uma segunda conexão ao pool enquanto a primeira está retida).
 */
export async function fotografarObrigacoes(
  db: Prisma.TransactionClient,
  processoId: number,
): Promise<FotografiaObrigacoes> {
  const [passos, tarefas] = await Promise.all([
    db.phaseWorkflowStepInstance.findMany({
      where: { processoId },
      select: {
        id: true, workflowInstanceId: true, faseMacroKey: true, ciclo: true,
        status: true, obrigatorio: true, completedAt: true,
      },
      orderBy: { id: "asc" },
    }),
    db.tarefa.findMany({
      where: { processoId },
      select: {
        id: true, workflowInstanceId: true, workflowStepInstanceId: true,
        statusTarefa: true, concluida: true, dataConclusao: true,
      },
      orderBy: { id: "asc" },
    }),
  ])

  const porChave = new Map<string, ObrigacaoFotografada>()
  const pendentesPorFase = new Map<string, number>()

  for (const p of passos) {
    porChave.set(`passo:${p.id}`, {
      chave: `passo:${p.id}`,
      tipo: "PASSO",
      id: p.id,
      workflowInstanceId: p.workflowInstanceId,
      faseMacroKey: p.faseMacroKey,
      ciclo: p.ciclo,
      status: String(p.status),
      obrigatorio: p.obrigatorio,
      concluidoEm: p.completedAt?.toISOString() ?? null,
    })
    if (p.obrigatorio && !PASSO_ENCERRADO.has(String(p.status))) {
      const k = p.faseMacroKey ?? "(sem fase)"
      pendentesPorFase.set(k, (pendentesPorFase.get(k) ?? 0) + 1)
    }
  }

  // Tarefas entram na fotografia mesmo sem passo: o vínculo com a fase vem do
  // passo quando existe, e a ausência dele não pode virar licença para alterá-la.
  const faseDoPasso = new Map(passos.map((p) => [p.id, { fase: p.faseMacroKey, ciclo: p.ciclo }]))
  for (const t of tarefas) {
    const ref = t.workflowStepInstanceId != null ? faseDoPasso.get(t.workflowStepInstanceId) : undefined
    porChave.set(`tarefa:${t.id}`, {
      chave: `tarefa:${t.id}`,
      tipo: "TAREFA",
      id: t.id,
      workflowInstanceId: t.workflowInstanceId,
      // DE QUAL PASSO ELA É PROJEÇÃO. A tarefa pode ter `workflowInstanceId` nulo —
      // ela nasce do passo, e nem sempre carrega a instância — então o vínculo com a
      // fase (e com a instância) só se resolve por aqui.
      passoId: t.workflowStepInstanceId ?? null,
      faseMacroKey: ref?.fase ?? null,
      ciclo: ref?.ciclo ?? null,
      status: `${String(t.statusTarefa)}|${t.concluida ? "concluida" : "aberta"}`,
      obrigatorio: true,
      concluidoEm: t.dataConclusao?.toISOString() ?? null,
    })
  }

  return { processoId, porChave, pendentesPorFase, total: porChave.size }
}

// --------------------------------------------------------------------------
// Comparação (PURA)
// --------------------------------------------------------------------------

export type TipoViolacao =
  | "OBRIGACAO_ALHEIA_ALTERADA"
  | "OBRIGACAO_ALHEIA_REMOVIDA"
  | "OBRIGACAO_CRIADA_FORA_DO_DESTINO"

export interface ViolacaoInvariante {
  tipo: TipoViolacao
  chave: string
  faseMacroKey: string | null
  ciclo: number | null
  de: string | null
  para: string | null
}

export interface ResultadoInvariantes {
  ok: boolean
  violacoes: ViolacaoInvariante[]
  /** Números para a auditoria: o que existia, o que passou a existir, o que mudou. */
  resumo: {
    antes: number
    depois: number
    criadasNoDestino: number
    pendentesAntesPorFase: Record<string, number>
    pendentesDepoisPorFase: Record<string, number>
  }
}

/** Estados em que a obrigação ainda conta como trabalho por fazer. */
const VIVOS = new Set(["PENDENTE", "DISPONIVEL", "EM_ANDAMENTO", "AGUARDANDO", "BLOQUEADO", "EXECUTADO", "AGUARDANDO_APROVACAO"])
const VIVOS_TAREFA = new Set(["NAO_INICIADA", "EM_ANDAMENTO", "AGUARDANDO_CLIENTE", "AGUARDANDO_TERCEIRO", "BLOQUEADA"])

/**
 * Compara as duas fotografias. Só a instância de DESTINO desta operação pode ganhar
 * obrigações novas; nenhuma obrigação pode mudar de status ou desaparecer.
 *
 * `instanciaDestinoId` é a instância criada/convergida pela operação. Passos e
 * tarefas dela são o único delta legítimo.
 *
 * ─── A ÚNICA OUTRA MUDANÇA ADMITIDA ────────────────────────────────────────
 * `instanciaSupersedidaId`: quando a operação supersede a instância de origem, os
 * passos e tarefas VIVOS dela podem — e devem — ir junto para SUPERSEDIDO.
 *
 * Não é afrouxamento: é a mesma exigência dita por inteiro. Antes, o invariante
 * aceitava a instância morrer e os filhos dela continuarem vivos — container
 * supersedido com conteúdo DISPONIVEL. Medido em produção (24/08/2026): dezoito de
 * dezenove passos "abertos" do processo 523 estavam nesse estado, e qualquer contagem
 * que esquecesse de escopar por instância viva os enxergava como trabalho a fazer.
 *
 * A permissão é estreita de propósito e cada limite tem razão:
 *   · SÓ a instância que ESTÁ sendo supersedida — nenhuma outra;
 *   · SÓ de estado VIVO para SUPERSEDIDO — concluir ou cancelar durante uma
 *     movimentação continua sendo violação, que é o defeito real que este invariante
 *     nasceu para pegar (a tela bespoke concluindo à força os passos da fase);
 *   · o que já era terminal continua onde estava — superseder um desfecho apagaria
 *     o que aconteceu.
 */
/**
 * A obrigação apenas ACOMPANHOU a instância que morreu?
 *
 * Três exigências, e nenhuma delas é dispensável:
 *   · pertence à instância que ESTÁ sendo supersedida (a tarefa pela via do passo,
 *     porque ela pode não carregar a instância);
 *   · estava VIVA — o que já era desfecho continua onde estava;
 *   · foi para SUPERSEDIDO/SUPERSEDIDA, e não para concluído nem cancelado.
 */
function seguiuAInstanciaMorta(
  antes: FotografiaObrigacoes,
  a: ObrigacaoFotografada,
  d: ObrigacaoFotografada,
  instanciaSupersedidaId: number | null | undefined,
): boolean {
  if (instanciaSupersedidaId == null) return false
  if (d.concluidoEm !== a.concluidoEm) return false

  // O STATUS DA TAREFA carrega o sufixo `|aberta`/`|concluida`. Comparar a string
  // inteira faria "NAO_INICIADA|aberta" nunca bater com o vocabulário de estados.
  const [estadoAntes, sufixoAntes] = a.status.split("|")
  const [estadoDepois, sufixoDepois] = d.status.split("|")
  if (sufixoAntes !== sufixoDepois) return false

  if (a.tipo === "PASSO") {
    if (a.workflowInstanceId !== instanciaSupersedidaId) return false
    return VIVOS.has(estadoAntes) && estadoDepois === "SUPERSEDIDO"
  }

  // TAREFA: o vínculo com a instância vem do passo do qual ela é projeção.
  const passo = a.passoId != null ? antes.porChave.get(`passo:${a.passoId}`) : undefined
  if (!passo || passo.workflowInstanceId !== instanciaSupersedidaId) return false
  return VIVOS_TAREFA.has(estadoAntes) && estadoDepois === "SUPERSEDIDA"
}

export function compararObrigacoes(
  antes: FotografiaObrigacoes,
  depois: FotografiaObrigacoes,
  opcoes: {
    instanciaDestinoId: number | null
    passosDoDestino?: Set<number>
    /** A instância que esta operação está supersedendo, quando há uma. */
    instanciaSupersedidaId?: number | null
  },
): ResultadoInvariantes {
  const violacoes: ViolacaoInvariante[] = []
  let criadasNoDestino = 0

  const doDestino = (o: ObrigacaoFotografada): boolean => {
    if (opcoes.instanciaDestinoId != null && o.workflowInstanceId === opcoes.instanciaDestinoId) return true
    // Tarefa recém-criada de um passo do destino ainda pode não carregar a instância.
    if (o.tipo === "TAREFA" && opcoes.passosDoDestino && o.workflowInstanceId == null) return true
    return false
  }

  for (const [chave, a] of antes.porChave) {
    const d = depois.porChave.get(chave)
    if (!d) {
      violacoes.push({
        tipo: "OBRIGACAO_ALHEIA_REMOVIDA", chave,
        faseMacroKey: a.faseMacroKey, ciclo: a.ciclo, de: a.status, para: null,
      })
      continue
    }
    // A INSTÂNCIA SUPERSEDIDA LEVA OS FILHOS VIVOS JUNTO — e só isso.
    if (seguiuAInstanciaMorta(antes, a, d, opcoes.instanciaSupersedidaId)) continue

    // Uma obrigação que já existia NÃO pode mudar de estado por causa de uma
    // movimentação — nem a da fase de origem, nem a de uma fase atravessada.
    if (d.status !== a.status || d.concluidoEm !== a.concluidoEm) {
      violacoes.push({
        tipo: "OBRIGACAO_ALHEIA_ALTERADA", chave,
        faseMacroKey: a.faseMacroKey, ciclo: a.ciclo, de: a.status, para: d.status,
      })
    }
  }

  for (const [chave, d] of depois.porChave) {
    if (antes.porChave.has(chave)) continue
    if (doDestino(d)) { criadasNoDestino++; continue }
    violacoes.push({
      tipo: "OBRIGACAO_CRIADA_FORA_DO_DESTINO", chave,
      faseMacroKey: d.faseMacroKey, ciclo: d.ciclo, de: null, para: d.status,
    })
  }

  return {
    ok: violacoes.length === 0,
    violacoes,
    resumo: {
      antes: antes.total,
      depois: depois.total,
      criadasNoDestino,
      pendentesAntesPorFase: Object.fromEntries(antes.pendentesPorFase),
      pendentesDepoisPorFase: Object.fromEntries(depois.pendentesPorFase),
    },
  }
}
