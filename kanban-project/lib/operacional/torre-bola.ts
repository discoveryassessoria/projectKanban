// lib/operacional/torre-bola.ts
// ============================================================================
// "BOLA COM" — a FUNÇÃO ÚNICA da Torre nova (Etapa A, 01/10/2026). Radar, Processos, Tarefas, Terceiros e Foco
// usam ESTA e só esta: de quem é a vez de uma tarefa, desde quando, e quando cobrar.
//
// Valores: Nossa · Cartório · Cliente · Tradutor · Juízo · Consulado.
//   • Cliente   — a tarefa espera o cliente (`esperandoDe === 'cliente'`, status AGUARDANDO_CLIENTE);
//   • terceiro  — a tarefa espera um terceiro (`esperandoDe === 'terceiro'` OU a subtarefa corrente está em espera
//                 externa, `estadoOperacao === 'AGUARDANDO'` — a MESMA definição do cartão "Aguardando terceiros").
//                 O rótulo vem do CADASTRO: a categoria da organização (`CategoriaOrganizacao.rotuloBola`) do órgão
//                 da tarefa. Órgão sem categoria, ou categoria sem rótulo, cai em "Cartório" — nunca um chute;
//   • Nossa     — o resto: o trabalho está com a equipe (inclusive sem responsável: a bola é nossa, só que sem responsável —
//                 quem mostra "Sem responsável" é a coluna do responsável, não a bola).
// "Bola nossa" × "Bola com terceiro" = `Nossa` × qualquer outro valor (Cliente conta como terceiro).
//
// DESDE QUANDO (`bolaDesde`) é o início do estado de espera ATUAL, só de registro real:
//   1. `esperandoDesde` da linha (auditoria da transição para AGUARDANDO_TERCEIRO/CLIENTE);
//   2. `SubtaskExecution.enviadoEm` da subtarefa em espera externa;
//   3. `SolicitacaoDocumento.dataEnvio` do pedido;
//   4. nada disso existe → `null` (a tela mostra "—"; registro antigo NÃO é preenchido por suposição).
// Para `Nossa`, `bolaDesde` é `null` (não há registro de "desde quando a bola voltou").
//
// PEDIDA EM (`pedidaEm`) = `SolicitacaoDocumento.dataEnvio` (o pedido mais recente da tarefa), senão o `enviadoEm`
// da subtarefa. COBRAR EM (`cobrarEm`) = o próximo acompanhamento REGISTRADO (`SubtaskExecution.proximoAcompanhamentoEm`,
// que a régua do cadastro reagenda a cada cobrança); quando o registro não define, o PADRÃO de 7 DIAS CORRIDOS após a
// última cobrança (`ContatoTerceiro.registradoEm`) ou, sem cobrança, após o pedido — e `cobrarEmPadrao: true` avisa que
// a data é o padrão, não um registro. Sem pedido nem acompanhamento → `null`.
// O prazo da tarefa NUNCA muda por causa disto: "cobrar em" não é prazo (decisão do protótipo e CLAUDE.md 35.6).
//
// UMA LEITURA EM LOTE (`lerBolaEmLote`): 4 consultas constantes, qualquer que seja o nº de linhas (sem N+1).
// A parte PURA (`montarBola`, `bolaDaLinha`, `cobrarEmDe`, `categoriaDoTerceiro`) não toca no banco.
// ============================================================================
// SEM `import { prisma }` estático: o módulo é importável pela TELA (Radar, Processos, Tarefas, Terceiros) para os valores e as funções
// puras; só `lerBolaEmLote` toca no banco, e carrega o cliente sob demanda (mesma disciplina de `torre-kpis.ts`).
import type { PrismaClient, Prisma } from '@prisma/client'

type Leitor = PrismaClient | Prisma.TransactionClient

/** O vocabulário FECHADO do que uma categoria de organização pode produzir como "bola com" (Gerenciamento › Categorias de Organização). */
export const ROTULOS_DE_TERCEIRO = ['Cartório', 'Tradutor', 'Juízo', 'Consulado'] as const
export type RotuloDeTerceiro = (typeof ROTULOS_DE_TERCEIRO)[number]
export const BOLA_NOSSA = 'Nossa' as const
export const BOLA_CLIENTE = 'Cliente' as const
/** Órgão sem categoria, ou categoria sem rótulo: a bola está com o cartório. */
export const BOLA_PADRAO_DO_TERCEIRO: RotuloDeTerceiro = 'Cartório'
export type BolaCom = typeof BOLA_NOSSA | typeof BOLA_CLIENTE | RotuloDeTerceiro
/** Todos os valores possíveis da bola, na ordem em que a Torre os lista. */
export const VALORES_DE_BOLA: readonly BolaCom[] = [BOLA_NOSSA, 'Cartório', BOLA_CLIENTE, 'Tradutor', 'Juízo', 'Consulado']
/** Cobrança sem prazo registrado: 7 dias corridos depois da última cobrança (ou do pedido). */
export const DIAS_PADRAO_DA_COBRANCA = 7

export const ehRotuloDeTerceiro = (v: unknown): v is RotuloDeTerceiro => typeof v === 'string' && (ROTULOS_DE_TERCEIRO as readonly string[]).includes(v)

/** "Bola nossa" ou "Bola com terceiro" — a partição de 2 lados do Radar e dos Processos. */
export const ladoDaBola = (b: BolaCom): 'nossa' | 'terceiro' => (b === BOLA_NOSSA ? 'nossa' : 'terceiro')
export const rotuloDoLado = (b: BolaCom): 'Bola nossa' | 'Bola com terceiro' => (b === BOLA_NOSSA ? 'Bola nossa' : 'Bola com terceiro')

// ─── PURO ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** O que da LINHA decide a bola (subconjunto de `LinhaDaTorre`). */
export interface LinhaParaBola {
  estadoOperacao: 'FILA' | 'AGUARDANDO' | 'CONCLUIDA'
  esperandoDe: 'terceiro' | 'cliente' | null
  esperandoDesde?: string | null
}

/**
 * Entre as categorias do órgão, o rótulo que vale: a de MENOR ordem que declara um rótulo válido (categoria inativa ou sem
 * rótulo não conta). `null` = o cadastro não diz — quem chama cai em `BOLA_PADRAO_DO_TERCEIRO`.
 */
export function categoriaDoTerceiro(categorias: Array<{ ordem: number; rotuloBola: string | null; ativo?: boolean }>): RotuloDeTerceiro | null {
  const validas = categorias
    .filter((c) => c.ativo !== false && ehRotuloDeTerceiro(c.rotuloBola))
    .sort((a, b) => a.ordem - b.ordem)
  return (validas[0]?.rotuloBola as RotuloDeTerceiro | undefined) ?? null
}

/** DE QUEM É A BOLA nesta linha. `rotuloDoTerceiro` = a categoria do órgão da tarefa (ou `null`). */
export function bolaDaLinha(l: LinhaParaBola, rotuloDoTerceiro: RotuloDeTerceiro | null): BolaCom {
  if (l.esperandoDe === 'cliente') return BOLA_CLIENTE
  if (l.esperandoDe === 'terceiro' || l.estadoOperacao === 'AGUARDANDO') return rotuloDoTerceiro ?? BOLA_PADRAO_DO_TERCEIRO
  return BOLA_NOSSA
}

/** QUANDO COBRAR: o acompanhamento registrado; senão o padrão de 7 dias corridos após a última cobrança/o pedido. */
export function cobrarEmDe(a: { proximoAcompanhamentoEm: Date | null; ultimaCobrancaEm: Date | null; pedidaEm: Date | null }): { data: Date | null; padrao: boolean } {
  if (a.proximoAcompanhamentoEm) return { data: a.proximoAcompanhamentoEm, padrao: false }
  // A base é o fato MAIS RECENTE entre a última cobrança e o pedido (uma cobrança de uma espera antiga não adia o pedido novo).
  const datas = [a.ultimaCobrancaEm, a.pedidaEm].filter((d): d is Date => d != null)
  if (datas.length === 0) return { data: null, padrao: false }
  const base = new Date(Math.max(...datas.map((d) => d.getTime())))
  return { data: new Date(base.getTime() + DIAS_PADRAO_DA_COBRANCA * 86_400_000), padrao: true }
}

/** Os campos aditivos que a Torre acrescenta a cada linha. Datas em ISO; `null` = sem registro ("—"). */
export interface CamposDaBola {
  bolaCom: BolaCom
  bolaDesde: string | null
  /** O rótulo de terceiro do ÓRGÃO da tarefa (Cartório, Tradutor, Juízo, Consulado); `null` = a tarefa não tem órgão. */
  categoriaTerceiro: RotuloDeTerceiro | null
  pedidaEm: string | null
  cobrarEm: string | null
  /** `true` = `cobrarEm` é o padrão de 7 dias (nenhum acompanhamento registrado), não uma data registrada. */
  cobrarEmPadrao: boolean
}

/** O que a leitura em lote junta por tarefa (tudo `null` quando não há registro). */
export interface FatosDaBola {
  categorias: Array<{ ordem: number; rotuloBola: string | null; ativo?: boolean }> | null
  temOrgao: boolean
  solicitacaoEnviadaEm: Date | null
  subtarefaEnviadaEm: Date | null
  proximoAcompanhamentoEm: Date | null
  ultimaCobrancaEm: Date | null
}

const FATOS_VAZIOS: FatosDaBola = { categorias: null, temOrgao: false, solicitacaoEnviadaEm: null, subtarefaEnviadaEm: null, proximoAcompanhamentoEm: null, ultimaCobrancaEm: null }

/** Junta a linha e os fatos nos campos da bola — a regra inteira, sem banco. */
export function montarBola(l: LinhaParaBola, f: FatosDaBola = FATOS_VAZIOS): CamposDaBola {
  const rotulo = f.temOrgao ? categoriaDoTerceiro(f.categorias ?? []) ?? BOLA_PADRAO_DO_TERCEIRO : null
  const bolaCom = bolaDaLinha(l, f.temOrgao ? rotulo : null)
  const pedida = f.solicitacaoEnviadaEm ?? f.subtarefaEnviadaEm
  const desdeRegistrado = l.esperandoDesde ? new Date(l.esperandoDesde) : null
  const desde = bolaCom === BOLA_NOSSA ? null : (desdeRegistrado && !Number.isNaN(desdeRegistrado.getTime()) ? desdeRegistrado : null) ?? f.subtarefaEnviadaEm ?? f.solicitacaoEnviadaEm
  // Só faz sentido cobrar quando a bola está com outro; com a bola nossa não há o que cobrar.
  const cobrar = bolaCom === BOLA_NOSSA ? { data: null, padrao: false } : cobrarEmDe({ proximoAcompanhamentoEm: f.proximoAcompanhamentoEm, ultimaCobrancaEm: f.ultimaCobrancaEm, pedidaEm: pedida })
  return {
    bolaCom,
    bolaDesde: desde?.toISOString() ?? null,
    categoriaTerceiro: rotulo,
    pedidaEm: pedida?.toISOString() ?? null,
    cobrarEm: cobrar.data?.toISOString() ?? null,
    cobrarEmPadrao: cobrar.padrao,
  }
}

// ─── LEITURA EM LOTE ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface EntradaDaLeitura extends LinhaParaBola {
  taskId: number
  /** `Tarefa.orgaoId` (ou o do documento) — quem resolve o rótulo de terceiro. */
  orgaoId: number | null
  /** `Tarefa.workflowStepInstanceId` — de onde sai a subtarefa em espera externa. */
  passoId: number | null
}

/**
 * A BOLA DE TODAS AS LINHAS, de uma vez: 4 consultas (categorias dos órgãos · solicitações · subtarefas em espera
 * externa · última cobrança), disparadas juntas — o nº de consultas NÃO cresce com o nº de linhas.
 */
export async function lerBolaEmLote(entradas: EntradaDaLeitura[], leitor?: Leitor): Promise<Map<number, CamposDaBola>> {
  const db = leitor ?? (await import('@/lib/prisma')).prisma
  const saida = new Map<number, CamposDaBola>()
  if (entradas.length === 0) return saida
  const unicos = <T,>(xs: Array<T | null>): T[] => [...new Set(xs.filter((x): x is T => x != null))]
  const orgaoIds = unicos(entradas.map((e) => e.orgaoId))
  const passoIds = unicos(entradas.map((e) => e.passoId))
  const tarefaIds = entradas.map((e) => e.taskId)

  const [categoriasDosOrgaos, solicitacoes, subtarefas, cobrancas] = await Promise.all([
    orgaoIds.length
      ? db.organizacaoCategoria.findMany({ where: { orgaoId: { in: orgaoIds } }, select: { orgaoId: true, categoria: { select: { ordem: true, rotuloBola: true, ativo: true } } } })
      : Promise.resolve([]),
    db.solicitacaoDocumento.findMany({
      where: { tarefaId: { in: tarefaIds }, status: { not: 'CANCELADA' } },
      select: { tarefaId: true, dataEnvio: true }, orderBy: { dataEnvio: 'desc' },
    }),
    passoIds.length
      ? db.subtaskExecution.findMany({
          where: { stepInstanceId: { in: passoIds }, supersededAt: null, status: 'AGUARDANDO_EXTERNO' },
          select: { stepInstanceId: true, enviadoEm: true, proximoAcompanhamentoEm: true },
        })
      : Promise.resolve([]),
    db.contatoTerceiro.groupBy({ by: ['tarefaId'], where: { tarefaId: { in: tarefaIds } }, _max: { registradoEm: true } }),
  ])

  const categoriasPorOrgao = new Map<number, Array<{ ordem: number; rotuloBola: string | null; ativo: boolean }>>()
  for (const c of categoriasDosOrgaos) categoriasPorOrgao.set(c.orgaoId, [...(categoriasPorOrgao.get(c.orgaoId) ?? []), c.categoria])
  const solicitacaoPorTarefa = new Map<number, Date>()
  for (const s of solicitacoes) if (s.tarefaId != null && !solicitacaoPorTarefa.has(s.tarefaId)) solicitacaoPorTarefa.set(s.tarefaId, s.dataEnvio) // desc: a primeira é a mais recente
  const subtarefaPorPasso = new Map<number, { enviadoEm: Date | null; proximoAcompanhamentoEm: Date | null }>()
  for (const s of subtarefas) subtarefaPorPasso.set(s.stepInstanceId, { enviadoEm: s.enviadoEm, proximoAcompanhamentoEm: s.proximoAcompanhamentoEm })
  const cobrancaPorTarefa = new Map(cobrancas.map((c) => [c.tarefaId, c._max.registradoEm]))

  for (const e of entradas) {
    const sub = e.passoId != null ? subtarefaPorPasso.get(e.passoId) : undefined
    saida.set(e.taskId, montarBola(e, {
      categorias: e.orgaoId != null ? categoriasPorOrgao.get(e.orgaoId) ?? [] : null,
      temOrgao: e.orgaoId != null,
      solicitacaoEnviadaEm: solicitacaoPorTarefa.get(e.taskId) ?? null,
      subtarefaEnviadaEm: sub?.enviadoEm ?? null,
      proximoAcompanhamentoEm: sub?.proximoAcompanhamentoEm ?? null,
      ultimaCobrancaEm: cobrancaPorTarefa.get(e.taskId) ?? null,
    }))
  }
  return saida
}
