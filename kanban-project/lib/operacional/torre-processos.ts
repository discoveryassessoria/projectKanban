// lib/operacional/torre-processos.ts
// ============================================================================
// RADAR E PROCESSOS DA TORRE — a CONSOLIDAÇÃO POR PROCESSO que as duas telas compartilham (Torre nova, frente Radar + Processos).
// Só leitura, tudo das fontes que já existem — SEM teto de processos (o `take: 300` saiu) e SEM consulta por processo (N+1):
//   • as linhas de tarefa: as MESMAS da aba Tarefas (`listarTarefasDaTorre`);
//   • a pontuação de cada processo: o MESMO "Precisa de você" (`itensPrecisaDeVoce`) — a maior pontuação entre os itens;
//   • o RISCO: a regra ÚNICA `torre-risco.ts` (no ritmo · atenção · parado · crítico) — esta função só monta a ENTRADA;
//   • quando entrou na fase / dias na fase: lote (`torre-fase-dados.ts`), as mesmas fontes de `entradaNaFase`;
//   • a META de tempo da fase (benchmark de exibição; sem meta, sem comparação): lida em `torre-fase-dados.ts`;
//   • a PRÓXIMA AÇÃO: derivada das tarefas abertas da fase (`torre-proxima-acao.ts`);
//   • as colunas do Radar: as fases ATIVAS do cadastro (`CatalogoFase`) na ordem padrão, SEM as terminais (a fase final de todo
//     macrofluxo em que nenhum processo ativo está — processo ali já está concluído); a fase que o macrofluxo do tipo do processo
//     não tem aparece como "não se aplica" (nada de fase inventada);
//   • "sem passos": fase futura com achado aberto CAD-012/WF-004 do Saúde (a "parede à frente").
// O "progresso" (certidões prontas "a de b") é a FONTE ÚNICA `documentacaoRequeridaDoProcesso` — pesada por processo —, por isso NÃO
// vai nesta lista leve: a tela pede só o das linhas da página (`certidoesDosProcessos`).
// ============================================================================
import { VINCULO_PROCESSO_ATIVO } from '@/src/lib/genealogia/vinculo-ativo'
import { prisma } from '@/lib/prisma'
import { achadosVigentesDaParede } from '@/lib/saude/parede-a-frente'
import { labelDaFasePorPhaseKey } from '@/src/lib/process-stage/fases-catalog'
import { documentacaoRequeridaDoProcesso } from '@/src/lib/process-stage/documentacao-requerida'
import { ordensDeFase } from '@/src/services/documento-operacao'
import { listarTarefasDaTorre, type LinhaDaTorre } from '@/src/services/torre-tarefas'
import { itensPrecisaDeVoce, type ItemPrecisaDeVoceTorre } from './precisa-de-voce'
import { lerLinhasOperacionais } from './avisos-sino'
import type { LinhaGerencial } from './tarefa-projecoes'
import { STATUS_ATIVOS } from './tarefa-canonica'
import { BOLA_NOSSA, BOLA_CLIENTE, BOLA_PADRAO_DO_TERCEIRO, VALORES_DE_BOLA, type BolaCom } from './torre-bola'
import { ONDE_PROCESSO_ATIVO_E_NA_TORRE, ONDE_PROCESSO_NA_TORRE, idsDeProcessosForaDaTorre, semProcessosForaDaTorre } from '@/src/services/processo-pre-contrato'
import { PHASEKEY_A_INICIAR } from '@/src/lib/process-stage/fase-pre-contrato'
import type { Prisma } from '@prisma/client'
import { entradasNaFaseEmLote, concluidasDaFaseEmLote, tempoDesde, metasDaTorre, metaDaFaseDoPais } from './torre-fase-dados'
import {
  riscoDoProcesso, baldeDoRadar, situacaoDaFase, ehGrave, type NivelDeRisco, type EntradaDoRisco, type SituacaoDaFase,
} from './torre-risco'
import { proximaAcaoDoProcesso, prazoCurto, type ProximaAcao, type PrazoCurto } from './torre-proxima-acao'

/** O balde do Radar (3 cores). O nível completo (4) está em `ProcessoDaTorre.nivelDeRisco`. */
export type RiscoDoProcesso = 'ok' | 'atencao' | 'critico'
export type { NivelDeRisco, SituacaoDaFase }

/**
 * "Processo ativo na Torre" = não concluído, não pausado E fora de "Aguardando fechamento" (`a_iniciar`). UMA definição: a lista
 * (Radar/Processos) e a foto diária (`processosAtivos`) leem esta. Em `AND` para nunca ser sobrescrita por chave repetida de quem a usa.
 */
export const ONDE_PROCESSO_ATIVO_DA_TORRE: Prisma.ProcessoWhereInput = ONDE_PROCESSO_ATIVO_E_NA_TORRE

export interface ColunaDoRadar { key: string; label: string; condicional: boolean }

export interface CelulaDoRadar {
  /** feita = fase já passou · atual = onde o processo está · futura · na = o macrofluxo deste tipo não tem a fase */
  estado: 'feita' | 'atual' | 'futura' | 'na'
  /** Só na atual: com quem está a bola e há quantos dias. */
  bola?: string
  dias?: number | null
  horas?: number | null
  risco?: RiscoDoProcesso
  /** Só na atual: o nível completo e o motivo legível (tooltip). */
  nivel?: NivelDeRisco
  motivo?: string
  /** Só nas futuras: a fase não tem passo executável (achado aberto CAD-012/WF-004). */
  semPassos?: boolean
}

/** Um passo da fase com tarefas abertas (dos processos que estão nela). */
export interface PassoDoProcesso {
  /** Chave estável do agrupamento (o rótulo do passo). */
  chave: string
  label: string
  /** Ordem aproximada do passo no roteiro (quanto já ficou para trás) — só ordena as caixas. */
  ordem: number
  /** Tarefas abertas COM responsável neste passo. */
  n: number
  /** Dessas, as que esperam terceiro/cliente. */
  aguardando: number
  /** Dessas esperas, as que passaram da meta da fase (dias esperando > meta). Sem meta → 0. */
  acimaDaMeta: number
}

/** O resumo das tarefas da FASE ATUAL do processo — o insumo do cartão "Onde estão as certidões". */
export interface TarefasDaFase {
  abertas: number
  /** Abertas SEM responsável (a caixa vermelha). */
  semResponsavel: number
  /** Concluídas com sucesso na fase (cancelada ≠ concluída). */
  concluidas: number
  passos: PassoDoProcesso[]
  /** Alguma tarefa da fase nasce de documento (certidão)? Decide o substantivo ("certidões" × "tarefas"). */
  ehCertidao: boolean
}

export interface ProximaAcaoDoProcesso extends Omit<ProximaAcao, 'dataPrazo'> {
  dataPrazo: string | null
  prazo: PrazoCurto
}

export interface ProcessoDaTorre {
  processoId: number
  familiaId: number | null
  familiaNome: string
  pais: string | null
  codigo: string | null
  faseAtual: { key: string | null; label: string | null }
  diasNaFase: number | null
  /** Quando entrou na fase atual (de registro real) — `null` = sem registro, a tela mostra "—". */
  naFase: { desde: string | null; origem: string | null; dias: number | null; horas: number | null }
  /** Meta de tempo da fase para o país do processo (só exibição); `null` = sem meta cadastrada. */
  metaDias: number | null
  bola: { rotulo: string; dias: number | null }
  /** O balde do Radar (parado e crítico = 'critico'). */
  risco: RiscoDoProcesso
  /** O nível completo da regra única (`torre-risco.ts`). */
  nivelDeRisco: NivelDeRisco
  motivoDoRisco: string
  /** A coluna "Situação" de Processos: ok · at · pa · sd. */
  situacao: SituacaoDaFase
  semDono: boolean
  scoreMaximo: number
  requerentes: number
  numeros: { abertas: number; vencidas: number; comCartorio: number; semResponsavel: number }
  /** Derivada das tarefas abertas da fase; `null` = nenhuma tarefa elegível (a tela mostra "—"). */
  proximaAcao: ProximaAcaoDoProcesso | null
  tarefasDaFase: TarefasDaFase
  celulas: CelulaDoRadar[]
}

/**
 * DE QUEM É A BOLA no processo — a MESMA função de bola da tarefa (`torre-bola.ts`), agregada pela regra do protótipo:
 * metade ou mais das tarefas abertas esperando TERCEIRO (cartório, tradutor, juízo, consulado) → a bola é do terceiro dominante
 * (o mais frequente; empate pela ordem de `VALORES_DE_BOLA`); senão metade ou mais esperando o CLIENTE → Cliente; senão Nossa.
 * Linha SEM `bolaCom` (leitor antigo) cai no critério de antes: `esperandoDe` → Cartório / Cliente / Nossa.
 */
export function bolaDoProcesso(linhas: Array<Pick<LinhaDaTorre, 'estadoOperacao' | 'esperandoDe' | 'esperandoHaDias'> & { bolaCom?: BolaCom }>): { rotulo: string; dias: number | null } {
  if (linhas.length === 0) return { rotulo: BOLA_NOSSA, dias: null }
  const maxDias = (ls: typeof linhas) => { const d = ls.map((l) => l.esperandoHaDias).filter((x): x is number => x != null); return d.length ? Math.max(...d) : null }
  const bolaDe = (l: (typeof linhas)[number]): BolaCom =>
    l.bolaCom ?? (l.esperandoDe === 'terceiro' ? BOLA_PADRAO_DO_TERCEIRO : l.esperandoDe === 'cliente' ? BOLA_CLIENTE : BOLA_NOSSA)
  const comTerceiro = linhas.filter((l) => { const b = bolaDe(l); return b !== BOLA_NOSSA && b !== BOLA_CLIENTE })
  const comCliente = linhas.filter((l) => bolaDe(l) === BOLA_CLIENTE)
  if (comTerceiro.length * 2 >= linhas.length) {
    const por = new Map<BolaCom, number>()
    for (const l of comTerceiro) por.set(bolaDe(l), (por.get(bolaDe(l)) ?? 0) + 1)
    const dominante = VALORES_DE_BOLA.filter((v) => por.has(v)).sort((a, b) => (por.get(b) ?? 0) - (por.get(a) ?? 0))[0]
    return { rotulo: dominante, dias: maxDias(comTerceiro) }
  }
  if (comCliente.length * 2 >= linhas.length) return { rotulo: BOLA_CLIENTE, dias: maxDias(comCliente) }
  return { rotulo: BOLA_NOSSA, dias: null }
}

/**
 * As fases ATIVAS do cadastro, na ordem padrão (todas — a poda das terminais é `colunasDoRadar`). SEM "Aguardando fechamento"
 * (`a_iniciar`): o processo nela está FORA do Radar/Processos/funil, então ela não é coluna nem botão de fase (o funil mostra o
 * contador dela numa linha PRÓPRIA, fora do total — `contarAguardandoFechamento`).
 */
export async function fasesDoRadar(): Promise<ColunaDoRadar[]> {
  const fases = await prisma.catalogoFase.findMany({ where: { ativo: true, phaseKey: { not: PHASEKEY_A_INICIAR } }, orderBy: [{ ordemPadrao: 'asc' }, { id: 'asc' }], select: { phaseKey: true, label: true, conditionalPadrao: true } })
  return fases.map((f) => ({ key: f.phaseKey, label: f.label, condicional: f.conditionalPadrao }))
}

/**
 * AS COLUNAS DO RADAR = as fases do cadastro MENOS as TERMINAIS: a fase que é a última de TODO macrofluxo em que aparece e onde
 * nenhum processo ativo está (processo que chega lá está concluído — não é "ativo", então a coluna só teria "—"). Nunca poda
 * uma coluna onde há processo ativo. Pura.
 */
export function colunasDoRadar(
  todas: ColunaDoRadar[], ordensPorTipo: ReadonlyMap<number, ReadonlyMap<string, number>>, fasesComProcessoAtivo: ReadonlySet<string>,
): ColunaDoRadar[] {
  return todas.filter((c) => {
    if (fasesComProcessoAtivo.has(c.key)) return true
    const ordens = [...ordensPorTipo.values()].filter((o) => o.has(c.key))
    if (ordens.length === 0) return true // fase que nenhum macrofluxo usa: não é "terminal", segue o cadastro
    return !ordens.every((o) => o.get(c.key) === Math.max(...o.values()))
  })
}

/**
 * AS COLUNAS DO RADAR / BOTÕES DE FASE de hoje — a MESMA poda de `processosDaTorre`, em 3 consultas pequenas (sem ler tarefas), para
 * quem só precisa da lista de fases (os botões da aba Processos).
 */
export async function colunasVisiveisDaTorre(): Promise<ColunaDoRadar[]> {
  const [todas, ativos, tiposEmUso] = await Promise.all([
    fasesDoRadar(),
    prisma.processo.groupBy({ by: ['faseAtualKey'], where: ONDE_PROCESSO_ATIVO_DA_TORRE }),
    prisma.processo.groupBy({ by: ['tipoProcessoMotorId'], where: ONDE_PROCESSO_ATIVO_DA_TORRE }),
  ])
  const tipos = tiposEmUso.map((t) => t.tipoProcessoMotorId).filter((x): x is number => x != null)
  const ordens = await Promise.all(tipos.map((t) => ordensDeFase(t)))
  return colunasDoRadar(todas, new Map(tipos.map((t, i) => [t, ordens[i]] as const)), new Set(ativos.map((a) => a.faseAtualKey).filter((x): x is string => x != null)))
}

async function fasesSemPassos(agora: Date): Promise<Set<string>> {
  // A MESMA leitura do "Precisa de você": só o achado que a verificação de hoje ainda acusa (limite alto: aqui é um conjunto de fases, não uma lista de decisões).
  const achados = await achadosVigentesDaParede(prisma, agora, { limite: 500 })
  const fases = new Set<string>()
  for (const a of achados) {
    const e = (a.evidencia ?? {}) as { fase?: string; phaseKey?: string }
    const k = e.fase ?? e.phaseKey
    if (k) fases.add(k)
  }
  return fases
}

// ─── A ENTRADA DA REGRA DE RISCO — a MESMA montagem para a lista, o Radar e o conjunto "em risco" ─────────────────────────────

/** Tarefa da fase ATUAL do processo (ou sem fase): não é de fase anterior ("fase deixada") nem futura. */
export const daFaseAtual = (l: Pick<LinhaGerencial, 'faseAnteriorAFaseAtual' | 'faseFutura'>): boolean => !l.faseAnteriorAFaseAtual && !l.faseFutura

type LinhaDeRisco = Pick<LinhaGerencial, 'atrasada' | 'diasParaPrazo' | 'responsavelId' | 'acompanhamentoVencido' | 'estadoOperacao' | 'esperandoDe' | 'esperandoHaDias' | 'statusTarefa' | 'cobrancasSemResposta'>

/**
 * MONTA a entrada de `riscoDoProcesso` a partir das tarefas ABERTAS do processo e dos itens do "Precisa de você". Pura.
 *   • score = a maior pontuação entre os itens do processo;
 *   • sinais = fatos de TODAS as tarefas abertas (é o que o score soma);
 *   • semDono = há trabalho na fase atual e nenhuma tarefa dela tem responsável;
 *   • bolaForaHaDias = a maior espera externa, na fase atual, entre as tarefas COM o acompanhamento vencido (a "parada").
 */
export function entradaDoRisco(args: {
  linhas: Array<LinhaDeRisco & Pick<LinhaGerencial, 'faseAnteriorAFaseAtual' | 'faseFutura'>>
  itens: Array<Pick<ItemPrecisaDeVoceTorre, 'tipo' | 'score'>>
  diasNaFase: number | null; metaDias: number | null; bolaRotulo?: string | null
}): EntradaDoRisco {
  const { linhas, itens } = args
  const daFase = linhas.filter(daFaseAtual)
  const espera = (l: LinhaDeRisco) => l.estadoOperacao === 'AGUARDANDO' || l.esperandoDe != null
  const paradas = daFase.filter((l) => espera(l) && l.acompanhamentoVencido && l.esperandoHaDias != null)
  return {
    scoreMaximo: itens.reduce((m, i) => Math.max(m, i.score), 0),
    semDono: daFase.length > 0 && daFase.every((l) => l.responsavelId == null),
    diasNaFase: args.diasNaFase,
    metaDias: args.metaDias,
    bolaForaHaDias: paradas.length ? Math.max(...paradas.map((l) => l.esperandoHaDias as number)) : null,
    bolaRotulo: args.bolaRotulo ?? null,
    sinais: {
      atrasadas: linhas.filter((l) => l.atrasada).length,
      semResponsavel: linhas.filter((l) => l.responsavelId == null).length,
      acompanhamentoVencido: linhas.filter((l) => l.acompanhamentoVencido).length,
      cobrancasSemResposta: linhas.some((l) => (l.cobrancasSemResposta ?? 0) >= 2),
      faseDeixada: itens.some((i) => i.tipo === 'FASE_DEIXADA'),
      divergencia: itens.some((i) => i.tipo === 'DIVERGENCIA'),
      bloqueadas: linhas.filter((l) => l.statusTarefa === 'BLOQUEADA').length,
      vencemEmBreve: linhas.filter((l) => !l.atrasada && l.diasParaPrazo != null && l.diasParaPrazo >= 0 && l.diasParaPrazo <= 1).length,
    },
  }
}

const porProcesso = <T extends { processoId: number | null }>(xs: T[]): Map<number, T[]> => {
  const m = new Map<number, T[]>()
  for (const x of xs) if (x.processoId != null) { const l = m.get(x.processoId); if (l) l.push(x); else m.set(x.processoId, [x]) }
  return m
}

/**
 * Os processos GRAVES (crítico ou parado, pela regra ÚNICA `torre-risco.ts`) — o conjunto do cartão "em risco" da Visão geral, da
 * foto diária e do filtro "Críticas" do Radar. Sem metas nem dias na fase: elas só movem atenção, nunca o balde grave.
 */
export async function processosCriticos(agora = new Date()): Promise<Set<number>> {
  const [lidas, foraDaTorre] = await Promise.all([lerLinhasOperacionais(agora), idsDeProcessosForaDaTorre()])
  const itens = await itensPrecisaDeVoce({ agora, linhas: lidas })
  const linhas = semProcessosForaDaTorre(lidas, foraDaTorre).filter((l) => STATUS_ATIVOS.includes(l.statusTarefa))
  const linhasPorProcesso = porProcesso(linhas)
  const itensPorProcesso = porProcesso(itens)
  const graves = new Set<number>()
  for (const [id, is] of itensPorProcesso) {
    const r = riscoDoProcesso(entradaDoRisco({ linhas: linhasPorProcesso.get(id) ?? [], itens: is, diasNaFase: null, metaDias: null }))
    if (ehGrave(r.nivel)) graves.add(id)
  }
  // Processo sem item no Precisa de você não tem score — mas pode estar "parado" (cobrança vencida pura não gera item): olha as linhas.
  for (const [id, ls] of linhasPorProcesso) {
    if (graves.has(id) || itensPorProcesso.has(id)) continue
    if (ehGrave(riscoDoProcesso(entradaDoRisco({ linhas: ls, itens: [], diasNaFase: null, metaDias: null })).nivel)) graves.add(id)
  }
  return graves
}

/** Anota cada linha com `processoEmRisco` — para o cartão "Processos em risco" e o filtro dele. */
export function anotarRisco<T extends { processoId: number | null }>(linhas: T[], criticos: Set<number>): Array<T & { processoEmRisco: boolean }> {
  return linhas.map((l) => ({ ...l, processoEmRisco: l.processoId != null && criticos.has(l.processoId) }))
}

// ─── AS TAREFAS DA FASE (insumo do passo dominante e do cartão por passo) ─────────────────────────────────────────────────────

const rotuloDoPassoDaLinha = (l: Pick<LinhaDaTorre, 'passoCorrente' | 'etapaAtual'>): string => l.passoCorrente?.label ?? l.etapaAtual ?? 'Sem passo'

export function tarefasDaFaseDoProcesso(linhasDaFase: LinhaDaTorre[], concluidas: number, metaDias: number | null): TarefasDaFase {
  const semResp = linhasDaFase.filter((l) => l.responsavelId == null)
  const comResp = linhasDaFase.filter((l) => l.responsavelId != null)
  const porPasso = new Map<string, PassoDoProcesso>()
  for (const l of comResp) {
    const label = rotuloDoPassoDaLinha(l)
    const p = porPasso.get(label) ?? { chave: label, label, ordem: l.passoAtual?.ordem ?? 0, n: 0, aguardando: 0, acimaDaMeta: 0 }
    p.n++
    if (l.estadoOperacao === 'AGUARDANDO' || l.esperandoDe != null) {
      p.aguardando++
      if (metaDias != null && l.esperandoHaDias != null && l.esperandoHaDias > metaDias) p.acimaDaMeta++
    }
    p.ordem = Math.max(p.ordem, l.passoAtual?.ordem ?? 0)
    porPasso.set(label, p)
  }
  return {
    abertas: linhasDaFase.length, semResponsavel: semResp.length, concluidas,
    passos: [...porPasso.values()].sort((a, b) => a.ordem - b.ordem || a.label.localeCompare(b.label, 'pt-BR')),
    ehCertidao: linhasDaFase.some((l) => l.documentoId != null),
  }
}

// ─── A CONSOLIDAÇÃO ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function processosDaTorre(agora = new Date(), linhasEntrada?: LinhaDaTorre[]): Promise<{ colunas: ColunaDoRadar[]; processos: ProcessoDaTorre[] }> {
  const [todasAsColunas, linhas, semPassos, metas, procs, itens] = await Promise.all([
    fasesDoRadar(),
    linhasEntrada ? Promise.resolve(linhasEntrada) : listarTarefasDaTorre({}, agora).then((r) => r.linhas),
    fasesSemPassos(agora),
    metasDaTorre(),
    prisma.processo.findMany({
      // PROCESSO ATIVO DA TORRE: não concluído E não pausado (filtro canônico — o mesmo de `listarTarefasDaTorre`). SEM TETO.
      where: ONDE_PROCESSO_ATIVO_DA_TORRE,
      orderBy: { id: 'asc' },
      select: {
        id: true, nome: true, codigo: true, faseAtualKey: true, tipoProcessoMotorId: true, familiaId: true, paisId: true, dataInicio: true, createdAt: true,
        familia: { select: { nome: true } }, paisCanonico: { select: { countryLabel: true } },
        _count: { select: { requerentes: { where: VINCULO_PROCESSO_ATIVO } } },
      },
    }),
    itensPrecisaDeVoce({ agora }),
  ])
  const tipos = [...new Set(procs.map((p) => p.tipoProcessoMotorId).filter((x): x is number => x != null))]
  const ordensLidas = await Promise.all(tipos.map((t) => ordensDeFase(t)))
  const ordensPorTipo = new Map(tipos.map((t, i) => [t, ordensLidas[i]] as const))
  const [entradas, concluidas] = await Promise.all([entradasNaFaseEmLote(procs, ordensPorTipo), concluidasDaFaseEmLote(procs)])
  const colunas = colunasDoRadar(todasAsColunas, ordensPorTipo, new Set(procs.map((p) => p.faseAtualKey).filter((x): x is string => x != null)))

  const linhasPorProcesso = porProcesso(linhas)
  const itensPorProcesso = porProcesso(itens)

  const processos: ProcessoDaTorre[] = procs.map((p) => {
    const ls = linhasPorProcesso.get(p.id) ?? []
    const is = itensPorProcesso.get(p.id) ?? []
    const daFase = ls.filter(daFaseAtual)
    const entrada = entradas.get(p.id) ?? { faseKey: p.faseAtualKey ?? '', desde: null, origem: null }
    const tempo = tempoDesde(entrada.desde, agora)
    const metaDias = p.faseAtualKey ? metaDaFaseDoPais(metas, p.faseAtualKey, p.paisId) : null
    const bola = bolaDoProcesso(daFase)
    const r = riscoDoProcesso(entradaDoRisco({ linhas: ls, itens: is, diasNaFase: tempo.dias, metaDias, bolaRotulo: bola.rotulo }))
    const prox = proximaAcaoDoProcesso(daFase, null)
    const ordens = p.tipoProcessoMotorId != null ? ordensPorTipo.get(p.tipoProcessoMotorId) : undefined
    const ordemAtual = p.faseAtualKey ? ordens?.get(p.faseAtualKey) : undefined
    const celulas: CelulaDoRadar[] = colunas.map((c): CelulaDoRadar => {
      const ordem = ordens?.get(c.key)
      if (ordem == null) return { estado: 'na' }
      if (c.key === p.faseAtualKey) return { estado: 'atual', bola: bola.rotulo, dias: tempo.dias, horas: tempo.horas, risco: baldeDoRadar(r.nivel), nivel: r.nivel, motivo: r.motivo }
      if (ordemAtual != null && ordem < ordemAtual) return { estado: 'feita' }
      return { estado: 'futura', semPassos: semPassos.has(c.key) }
    })
    return {
      processoId: p.id, familiaId: p.familiaId, familiaNome: p.familia?.nome ?? p.nome, pais: p.paisCanonico?.countryLabel ?? null, codigo: p.codigo,
      faseAtual: { key: p.faseAtualKey, label: p.faseAtualKey ? labelDaFasePorPhaseKey(p.faseAtualKey) ?? p.faseAtualKey : null },
      diasNaFase: tempo.dias, naFase: { desde: entrada.desde, origem: entrada.origem, dias: tempo.dias, horas: tempo.horas }, metaDias, bola,
      risco: baldeDoRadar(r.nivel), nivelDeRisco: r.nivel, motivoDoRisco: r.motivo, situacao: situacaoDaFase(r.nivel, r.semDono), semDono: r.semDono, scoreMaximo: r.scoreMaximo,
      requerentes: p._count.requerentes,
      numeros: {
        abertas: ls.length, vencidas: ls.filter((l) => l.atrasada).length,
        comCartorio: ls.filter((l) => l.estadoOperacao === 'AGUARDANDO').length, semResponsavel: ls.filter((l) => l.responsavelId == null).length,
      },
      proximaAcao: prox ? { ...prox, prazo: prazoCurto(prox.dataPrazo, agora) } : null,
      tarefasDaFase: tarefasDaFaseDoProcesso(daFase, concluidas.get(p.id) ?? 0, metaDias),
      celulas,
    }
  })
  // A ordem de entrega é a do Radar "mais grave primeiro" (balde vermelho → atenção → no ritmo; pontuação; nome); as telas reordenam a seu modo.
  const peso: Record<RiscoDoProcesso, number> = { critico: 0, atencao: 1, ok: 2 }
  processos.sort((a, b) => peso[a.risco] - peso[b.risco] || b.scoreMaximo - a.scoreMaximo || a.familiaNome.localeCompare(b.familiaNome, 'pt-BR'))
  return { colunas, processos }
}

// ─── O "a de b" DAS CERTIDÕES — só para quem a tela mostra (a fonte única é pesada por processo) ───────────────────────────

export interface CertidoesDoProcesso { processoId: number; aplicavel: boolean; recebidas: number; requeridas: number; percentual: number }

/** `documentacaoRequeridaDoProcesso` (a FONTE ÚNICA de Geral/Documentos/Central/Torre/Foco) para os processos pedidos — em blocos de 4 (o pool de conexões é pequeno). */
export async function certidoesDosProcessos(processoIds: number[]): Promise<CertidoesDoProcesso[]> {
  const ids = [...new Set(processoIds)]
  const saida: CertidoesDoProcesso[] = []
  for (let i = 0; i < ids.length; i += 4) {
    saida.push(...(await Promise.all(ids.slice(i, i + 4).map(async (id) => {
      const c = await documentacaoRequeridaDoProcesso(id)
      return { processoId: id, aplicavel: c.aplicavel, recebidas: c.recebidos, requeridas: c.requeridos, percentual: c.percentual }
    }))))
  }
  return saida
}
