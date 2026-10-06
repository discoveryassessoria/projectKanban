// lib/operacional/subtarefa-corrente.ts
// ============================================================================
// A SUBTAREFA CORRENTE DE UM PASSO E O ACOMPANHAMENTO VENCIDO — REGRA ÚNICA.
//
// ACHADO REAL (30/09/2026, processo 651, #3864/#3866/#3868/#3869/#3870/#3871):
// o rótulo da tela ("Atrasada há 2 dias", `acompanhamentoPasso`) e o sinal
// `acompanhamentoVencido` (Torre: visão, KPI "Cobranças vencidas", Operação,
// avisos) eram calculados em DOIS lugares que escolhiam a subtarefa
// diferente:
//   • `progressoPorSubtarefa` (tarefa-projecoes.ts): a CORRENTE = primeira
//     alcançável não encerrada, em QUALQUER status (inclusive DISPONIVEL,
//     "a iniciar");
//   • `estadosTemporaisDasOperacoes` (proximo-acontecimento.ts): só a
//     subtarefa em `AGUARDANDO_EXTERNO`.
// Uma subtarefa "a iniciar" com `proximoAcompanhamentoEm` no passado mostrava
// o rótulo vermelho e NÃO entrava em "Acompanhamentos vencidos".
//
// Este módulo é PURO (exceto `definicoesDasSubtarefas`, que só recebe o leitor
// por parâmetro): as duas leituras importam DAQUI.
// ============================================================================
import type { Prisma, PrismaClient } from '@prisma/client'
import { diasEntreDiasOperacionais } from './tempo-operacional'
import { lerVersaoPublicada, type VersaoPublicada } from '@/src/services/versao-publicada'

type Leitor = PrismaClient | Prisma.TransactionClient

/** Estados de `SubtaskExecution` em que a subtarefa já não é "corrente". */
export const SUBTAREFA_ENCERRADA_STATUS: ReadonlySet<string> = new Set(['CONCLUIDO', 'CANCELADO', 'INVALIDADO', 'FALHOU'])

export interface DefinicaoDeSubtarefa { label: string; dependeDe: string[] }

/**
 * A CORRENTE é a alcançável de menor ordem — NUNCA só "menor ordem entre as
 * não-encerradas" (hotfix Cibils 26/09/2026): uma subtarefa cuja dependência
 * ainda não concluiu jamais é "atual". `dependeDe` é a fonte de
 * alcançabilidade; `ordem` é só desempate/display.
 */
export function escolherSubtarefaCorrente<E extends { subtaskKey: string; status: string }>(
  execs: E[],
  defs: Map<string, { dependeDe: string[] }> | undefined,
  ordens: Map<string, number> | undefined,
): E | null {
  const concluidasKeys = new Set(execs.filter((e) => e.status === 'CONCLUIDO').map((e) => e.subtaskKey))
  return execs
    .filter((e) => !SUBTAREFA_ENCERRADA_STATUS.has(e.status))
    .filter((e) => (defs?.get(e.subtaskKey)?.dependeDe ?? []).every((dep) => concluidasKeys.has(dep)))
    .sort((a, b) => (ordens?.get(a.subtaskKey) ?? 0) - (ordens?.get(b.subtaskKey) ?? 0))[0] ?? null
}

/**
 * ACOMPANHAMENTO VENCIDO — a regra ÚNICA, POR DIA no fuso operacional: a data
 * de acompanhamento é hoje ou já passou. É exatamente
 * `atrasado || venceHoje` do rótulo (`estadoTemporalSubtarefa` →
 * `nucleoTemporal`: dias < 0 = "Atrasada há N dias", dias === 0 = "Vence
 * hoje") — a mesma matemática (`diasEntreDiasOperacionais`), então o rótulo e
 * o sinal nunca divergem. Sem data ⇒ nunca vencido.
 */
export function acompanhamentoVenceuNoDia(data: Date | string | null | undefined, agora: Date): boolean {
  if (data == null) return false
  const d = data instanceof Date ? data : new Date(data)
  if (Number.isNaN(d.getTime())) return false
  return diasEntreDiasOperacionais(d, agora) <= 0
}

/**
 * `ordem`/`dependeDe`/rótulo de cada subtarefa ATIVA do passo, pela definição
 * CONGELADA da versão que a instância registrou (`lerVersaoPublicada`) — nunca
 * a definição viva. Em lote: uma consulta para as instâncias, uma por par
 * (definição, versão) distinto.
 */
export async function definicoesDasSubtarefas(
  db: Leitor,
  passos: Array<{ stepInstanceId: number; stepKey: string; workflowInstanceId: number | null }>,
  cache: CacheDeLeitura = criarCacheDeLeitura(db),
): Promise<Map<number, { ordens: Map<string, number>; defs: Map<string, DefinicaoDeSubtarefa> }>> {
  const saida = new Map<number, { ordens: Map<string, number>; defs: Map<string, DefinicaoDeSubtarefa> }>()
  const instanciaIds = [...new Set(passos.map((p) => p.workflowInstanceId).filter((x): x is number => x != null))]
  if (instanciaIds.length === 0) return saida
  const instancias = await cache.instancias(instanciaIds)
  const instanciaPorId = new Map(instancias.map((i) => [i.id, i]))
  const pares = new Map<string, { workflowDefinitionId: number; workflowVersion: number }>()
  for (const i of instancias) {
    if (i.workflowDefinitionId == null || i.workflowVersion == null) continue
    pares.set(`${i.workflowDefinitionId}:${i.workflowVersion}`, { workflowDefinitionId: i.workflowDefinitionId, workflowVersion: i.workflowVersion })
  }
  const versoes = new Map(await Promise.all(
    [...pares.entries()].map(async ([chave, p]) => [chave, await cache.versao(p.workflowDefinitionId, p.workflowVersion)] as const),
  ))
  for (const p of passos) {
    if (p.workflowInstanceId == null) continue
    const inst = instanciaPorId.get(p.workflowInstanceId)
    if (!inst?.workflowDefinitionId || inst.workflowVersion == null) continue
    const passo = versoes.get(`${inst.workflowDefinitionId}:${inst.workflowVersion}`)?.passos.find((x) => x.key === p.stepKey)
    const ativas = passo?.subtarefas?.filter((s) => s.ativo !== false) ?? []
    if (ativas.length === 0) continue
    saida.set(p.stepInstanceId, {
      ordens: new Map(ativas.map((s) => [s.key, s.ordem])),
      defs: new Map(ativas.map((s) => [s.key, { label: s.label, dependeDe: s.dependeDe ?? [] }])),
    })
  }
  return saida
}

// ============================================================================
// O CACHE DE LEITURA DE UMA REQUISIÇÃO (Torre, D2, 30/09/2026).
//
// ACHADO: a visão gerencial lia as MESMAS linhas em várias funções — as
// instâncias de workflow e as versões congeladas (progresso por subtarefa E
// definições das subtarefas), as execuções vigentes (idem), o cadastro de
// rótulos dos passos (rótulo da etapa E rótulo do próximo acontecimento), os
// passos e as pessoas (nome E linhagem) — e cada uma esperava a anterior.
// Com ~130 ms por ida ao banco, cada leitura repetida ou em série é tempo puro.
//
// Isto NÃO é cache entre requisições nem fonte nova: vive o tempo de UMA
// chamada, guarda a PROMESSA por chave (duas funções que pedem a mesma linha ao
// mesmo tempo fazem UMA consulta) e consulta só o que ainda não foi pedido.
// Nenhuma regra mora aqui — quem decide o que fazer com a linha é quem a pede.
// ============================================================================
export type InstanciaLida = { id: number; workflowDefinitionId: number | null; workflowVersion: number | null }
export type PassoLido = {
  id: number; stepKey: string; snapshot: Prisma.JsonValue; stepDefinitionId: number | null; ordem: number
  createdAt: Date; prazo: Date | null; startedAt: Date | null; metadata: Prisma.JsonValue
}
export type ExecucaoLida = {
  id: number; stepInstanceId: number; subtaskKey: string; status: string; criadoEm: Date; startedAt: Date | null
  previstoPara: Date | null; proximoAcompanhamentoEm: Date | null; escalada: boolean
}
export type ContatoLido = { subtaskExecutionId: number; resultado: string }
export type PessoaLida = { id: number; nome: string; sobrenome: string | null; numeroLinhagem: number | null; linhaReta: boolean; data_nasc: Date | null; arvoreId: number | null }

export interface CacheDeLeitura {
  instancias(ids: number[]): Promise<InstanciaLida[]>
  versao(workflowDefinitionId: number, workflowVersion: number): Promise<VersaoPublicada | null>
  passos(ids: number[]): Promise<PassoLido[]>
  execucoes(stepInstanceIds: number[]): Promise<ExecucaoLida[]>
  /** Todos os contatos das execuções vigentes desses passos (ordem crescente de id). A chave é o CONJUNTO. */
  contatos(stepInstanceIds: number[]): Promise<ContatoLido[]>
  rotulosDeDefinicao(ids: number[]): Promise<Array<{ id: number; label: string }>>
  pessoas(ids: number[]): Promise<PessoaLida[]>
}

/** Uma consulta por LOTE do que falta; o que já foi pedido (mesmo em andamento) é reaproveitado. `agrupar` = várias linhas por chave. */
function carregadorPorChave<K, R>(buscar: (faltam: K[]) => Promise<R[]>, chaveDe: (r: R) => K) {
  const memo = new Map<K, Promise<R[]>>()
  return async (ids: K[]): Promise<R[]> => {
    const unicos = [...new Set(ids)]
    const faltam = unicos.filter((id) => !memo.has(id))
    if (faltam.length > 0) {
      const lote = buscar(faltam).then((rows) => {
        const porChave = new Map<K, R[]>()
        for (const r of rows) { const k = chaveDe(r); const a = porChave.get(k); if (a) a.push(r); else porChave.set(k, [r]) }
        return porChave
      })
      for (const id of faltam) memo.set(id, lote.then((m) => m.get(id) ?? []))
    }
    return (await Promise.all(unicos.map((id) => memo.get(id)!))).flat()
  }
}

export function criarCacheDeLeitura(db: Leitor): CacheDeLeitura {
  const instancias = carregadorPorChave<number, InstanciaLida>(
    (ids) => db.phaseWorkflowInstance.findMany({ where: { id: { in: ids } }, select: { id: true, workflowDefinitionId: true, workflowVersion: true } }),
    (r) => r.id,
  )
  const versoes = new Map<string, Promise<VersaoPublicada | null>>()
  const passos = carregadorPorChave<number, PassoLido>(
    (ids) => db.phaseWorkflowStepInstance.findMany({
      where: { id: { in: ids } },
      select: { id: true, stepKey: true, snapshot: true, stepDefinitionId: true, ordem: true, createdAt: true, prazo: true, startedAt: true, metadata: true },
    }),
    (r) => r.id,
  )
  const execucoes = carregadorPorChave<number, ExecucaoLida>(
    (ids) => db.subtaskExecution.findMany({
      where: { stepInstanceId: { in: ids }, supersededAt: null },
      select: {
        id: true, stepInstanceId: true, subtaskKey: true, status: true, criadoEm: true, startedAt: true,
        previstoPara: true, proximoAcompanhamentoEm: true, escalada: true,
      },
    }),
    (r) => r.stepInstanceId,
  )
  const contatosMemo = new Map<string, Promise<ContatoLido[]>>()
  const rotulos = carregadorPorChave<number, { id: number; label: string }>(
    (ids) => db.phaseInternalWorkflowStep.findMany({ where: { id: { in: ids } }, select: { id: true, label: true } }),
    (r) => r.id,
  )
  const pessoas = carregadorPorChave<number, PessoaLida>(
    (ids) => db.pessoa.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true, sobrenome: true, numeroLinhagem: true, linhaReta: true, data_nasc: true, arvoreId: true } }),
    (r) => r.id,
  )
  return {
    instancias: (ids) => (ids.length ? instancias(ids) : Promise.resolve([])),
    versao: (workflowDefinitionId, workflowVersion) => {
      const chave = `${workflowDefinitionId}:${workflowVersion}`
      let p = versoes.get(chave)
      if (!p) { p = lerVersaoPublicada(workflowDefinitionId, workflowVersion, db); versoes.set(chave, p) }
      return p
    },
    passos: (ids) => (ids.length ? passos(ids) : Promise.resolve([])),
    execucoes: (ids) => (ids.length ? execucoes(ids) : Promise.resolve([])),
    // Direto na tabela de contatos, pela execução vigente do passo — UMA consulta que não espera as execuções
    // (antes: execuções → contagem por grupo → contatos, três idas em série; a contagem é o tamanho da lista).
    contatos: (ids) => {
      if (ids.length === 0) return Promise.resolve([])
      const chave = [...new Set(ids)].sort((a, b) => a - b).join(',')
      let p = contatosMemo.get(chave)
      if (!p) {
        p = db.contatoTerceiro.findMany({
          where: { estornadoEm: null, subtaskExecution: { stepInstanceId: { in: [...new Set(ids)] }, supersededAt: null } },
          orderBy: { id: 'asc' },
          select: { subtaskExecutionId: true, resultado: true },
        })
        contatosMemo.set(chave, p)
      }
      return p
    },
    rotulosDeDefinicao: (ids) => (ids.length ? rotulos(ids) : Promise.resolve([])),
    pessoas: (ids) => (ids.length ? pessoas(ids) : Promise.resolve([])),
  }
}
