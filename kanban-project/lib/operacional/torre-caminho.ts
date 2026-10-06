// lib/operacional/torre-caminho.ts
// ============================================================================
// O CAMINHO DO PROCESSO (Torre nova, frente H, 01/10/2026) — "Caminho do processo" do Detalhe: as fases do Workflow Macro do
// processo, cada uma com seu estado (Concluída · Atual · Futura · Condicional · Pulada), quando entrou, quando saiu e o que foi
// feito nela.
//
// FONTES (nenhuma nova): as fases e a ordem = `FaseMacro` do Workflow Macro do tipo+modalidade do processo (a MESMA lista do
// avanço e de `ordensDeFase`); o nome = o CADASTRO (`labelDaFasePorPhaseKey`, nunca literal no código); "entrou/saiu" = o log
// de transição (`PhaseAdvanceLog`, os resultados de `RESULTADOS_QUE_MOVEM_DE_FASE`) e, na falta dele, a abertura do processo
// (1ª fase) ou a criação do workflow da fase — NUNCA "agora" nem palpite (sem registro = `null`, a tela escreve "—");
// "condicional" = `FaseMacro.conditional` + a decisão da Análise (`requerRetificacao`), a regra de `proximaFaseDoCaminho`.
//
// DIVERGÊNCIA REGISTRADA (INVENTARIO D02): o protótipo desenha 8 fases fixas; aqui o caminho tem tantas colunas quantas o
// Workflow Macro REAL do processo tem (a Itália/Espanha de hoje têm 10: inclui Emissão retificada e Aguardando protocolo) — esconder
// uma fase onde o processo pode estar seria esconder o estado real.
//
// ESTE módulo é PURO (importável pela tela): `montarCaminho`, `textosDaFase`, `passagensPelasFases`. O leitor do banco
// (`lerCaminhoDoProcesso`) mora em `torre-caminho-leitura.ts` — só o servidor o importa.
// ============================================================================
import { rotuloQuando } from './torre-processo-puro'
import { FUSO_OPERACIONAL } from './tempo-operacional'

export type EstadoDaFaseNoCaminho = 'concluida' | 'atual' | 'futura' | 'condicional' | 'pulada' | 'reaberta'

export interface FaseCadastrada { phaseKey: string; ordem: number; label: string; conditional: boolean; required: boolean }
export interface PassagemPelaFase { entradaEm: string | null; saidaEm: string | null }
export interface TarefasDaFase { total: number; concluidas: number; semResponsavel: number; abertas: number; responsaveis: Array<{ nome: string; n: number }> }

export interface FaseDoCaminho {
  phaseKey: string
  /** 1, 2, 3… na ordem do Workflow Macro. */
  numero: number
  label: string
  estado: EstadoDaFaseNoCaminho
  /** Só em `pulada`: por quê (a condicional que a Análise não pediu × a fase não deixou registro nenhum). */
  motivoPulada: 'NAO_FOI_PRECISO' | 'SEM_REGISTRO' | null
  entradaEm: string | null
  saidaEm: string | null
  tarefas: TarefasDaFase
  /** Só em `reaberta`: a fase JÁ ANTERIOR à atual cuja instância voltou a ATIVO (passo "Localizar registro" aberto) — quando e quanto falta. */
  reaberta: { em: string | null; progresso: number | null } | null
}

const VAZIAS: TarefasDaFase = { total: 0, concluidas: 0, semResponsavel: 0, abertas: 0, responsaveis: [] }

export function montarCaminho(a: {
  fases: FaseCadastrada[]
  faseAtualKey: string | null
  /** A decisão da Análise: `true` = pediu Retificação (as fases condicionais entram); `false`/`null` = não pediu / ainda não decidiu. */
  requerRetificacao: boolean | null
  passagens: ReadonlyMap<string, PassagemPelaFase>
  tarefas: ReadonlyMap<string, TarefasDaFase>
  /** A MESMA fonte da barra de fases: fase cuja instância mais recente está ATIVA (aberta) — `em` = quando foi reaberta, `progresso` = a projeção. */
  reabertas?: ReadonlyMap<string, { em: string | null; progresso: number | null }>
}): FaseDoCaminho[] {
  const fases = [...a.fases].sort((x, y) => x.ordem - y.ordem)
  const idxAtual = a.faseAtualKey ? fases.findIndex((f) => f.phaseKey === a.faseAtualKey) : -1
  return fases.map((f, i) => {
    const passagem = a.passagens.get(f.phaseKey) ?? { entradaEm: null, saidaEm: null }
    const tarefas = a.tarefas.get(f.phaseKey) ?? VAZIAS
    const condicionalDispensada = f.conditional && a.requerRetificacao !== true
    let estado: EstadoDaFaseNoCaminho
    let motivoPulada: FaseDoCaminho['motivoPulada'] = null
    const reaberta = idxAtual >= 0 && i < idxAtual ? a.reabertas?.get(f.phaseKey) ?? null : null
    if (idxAtual === i) estado = 'atual'
    else if (reaberta) estado = 'reaberta'
    else if (idxAtual >= 0 && i < idxAtual) {
      if (condicionalDispensada) { estado = 'pulada'; motivoPulada = 'NAO_FOI_PRECISO' }
      else if (passagem.entradaEm == null && tarefas.total === 0 && i > 0) { estado = 'pulada'; motivoPulada = 'SEM_REGISTRO' }
      else estado = 'concluida'
    } else estado = condicionalDispensada ? 'condicional' : 'futura'
    return { phaseKey: f.phaseKey, numero: i + 1, label: f.label, estado, motivoPulada, entradaEm: passagem.entradaEm, saidaEm: passagem.saidaEm, tarefas, reaberta }
  })
}

const dataHora = (iso: string): string => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('pt-BR', { timeZone: FUSO_OPERACIONAL, day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('pt-BR', { timeZone: FUSO_OPERACIONAL, hour: '2-digit', minute: '2-digit', hour12: false })}`
}

/** Quem tocou a fase: "sem responsável" · "Daniela Brait" · "Daniela Brait +2". */
function quem(t: TarefasDaFase, aberta: boolean): string {
  if (aberta && t.semResponsavel > 0 && t.semResponsavel === t.abertas) return 'sem responsável'
  const r = t.responsaveis
  if (r.length === 0) return aberta ? 'sem responsável' : ''
  return r.length === 1 ? r[0].nome : `${r[0].nome} +${r.length - 1}`
}

/**
 * Os 3 textos de cada coluna do caminho (título · linha 2 · linha 3). `tempoNaFase` = o "8 h"/"3 d" de `textoTempoNaFase` (só na atual);
 * `certidoes` = "recebidas de requeridas" da fase atual (a completude documental real). PURA.
 */
export function textosDaFase(f: FaseDoCaminho, agora: Date, extra: { tempoNaFase?: string; certidoes?: { recebidas: number; requeridas: number } } = {}): { l1: string; l2: string; l3: string | null } {
  const titulo = `${f.numero} · ${f.label}`
  switch (f.estado) {
    case 'concluida': {
      const t = f.tarefas
      const datas = f.entradaEm ? `${dataHora(f.entradaEm)}${f.saidaEm ? ` → ${dataHora(f.saidaEm)}` : ''}` : 'sem registro de datas'
      const feito = t.total > 0 ? `${t.concluidas} de ${t.total} concluídas${quem(t, false) ? ` · ${quem(t, false)}` : ''}` : 'sem tarefas nesta fase'
      return { l1: `${titulo} ✓`, l2: datas, l3: feito }
    }
    case 'atual': {
      const t = f.tarefas
      const desde = f.entradaEm ? `desde ${rotuloQuando(f.entradaEm, agora, true)}${extra.tempoNaFase && extra.tempoNaFase !== '—' ? ` · ${extra.tempoNaFase}` : ''}` : 'sem registro de quando entrou'
      const c = extra.certidoes
      const quemTxt = t.abertas > 0 ? quem(t, true) : ''
      const andamento = c && c.requeridas > 0 ? `${c.recebidas} de ${c.requeridas} recebidas` : t.total > 0 ? `${t.concluidas} de ${t.total} concluídas` : 'sem tarefas nesta fase'
      return { l1: `${titulo} · atual`, l2: desde, l3: `${andamento}${quemTxt ? ` · ${quemTxt}` : ''}` }
    }
    case 'reaberta': {
      // FONTE ÚNICA DE FASE: igual à barra de fases — a instância voltou a ATIVO, então a fase está EM ANDAMENTO (nunca "concluída ✓").
      const r = f.reaberta
      const pct = r?.progresso != null ? `${r.progresso}% · ` : ''
      const quando = r?.em ? `reaberta ${rotuloQuando(r.em, agora, true)}` : 'reaberta'
      const t = f.tarefas
      return { l1: `${titulo} · em andamento`, l2: `${pct}${quando}`, l3: t.abertas > 0 ? `${t.abertas} ${t.abertas === 1 ? 'tarefa aberta' : 'tarefas abertas'}${quem(t, true) ? ` · ${quem(t, true)}` : ''}` : null }
    }
    case 'condicional': return { l1: titulo, l2: 'só se preciso', l3: null }
    case 'pulada': return { l1: titulo, l2: f.motivoPulada === 'NAO_FOI_PRECISO' ? 'pulada · não foi preciso' : 'pulada · sem registro de passagem', l3: null }
    default: return { l1: titulo, l2: 'futura', l3: null }
  }
}

// ─── LEITURA ─────────────────────────────────────────────────────────────────


/** Entrada/saída de cada fase a partir do log de transição, da abertura do processo e das instâncias de workflow — PURA. */
export function passagensPelasFases(a: {
  fases: Array<{ phaseKey: string }>
  logs: Array<{ faseAtual: string | null; fasePretendida: string | null; criadoEm: Date }>
  instancias: Array<{ faseMacroKey: string; createdAt: Date }>
  abertoEm: Date
  faseAtualKey: string | null
}): Map<string, PassagemPelaFase> {
  const logs = [...a.logs].sort((x, y) => x.criadoEm.getTime() - y.criadoEm.getTime())
  const mapa = new Map<string, PassagemPelaFase>()
  for (const [i, f] of a.fases.entries()) {
    const entradas = logs.filter((l) => l.fasePretendida === f.phaseKey)
    const ultima = entradas[entradas.length - 1]?.criadoEm ?? null
    let entrada: Date | null = ultima
    if (!entrada && i === 0) entrada = a.abertoEm // a 1ª fase do macrofluxo: o processo nasceu nela
    if (!entrada) {
      const inst = a.instancias.filter((x) => x.faseMacroKey === f.phaseKey).sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())[0]
      entrada = inst?.createdAt ?? null
    }
    let saida: Date | null = null
    if (entrada && f.phaseKey !== a.faseAtualKey) {
      saida = logs.find((l) => l.faseAtual === f.phaseKey && l.criadoEm.getTime() > entrada!.getTime())?.criadoEm ?? null
    }
    mapa.set(f.phaseKey, { entradaEm: entrada?.toISOString() ?? null, saidaEm: saida?.toISOString() ?? null })
  }
  // Fase concluída sem log de saída: a saída é a entrada da próxima fase que veio depois (registro real, não palpite).
  for (const [i, f] of a.fases.entries()) {
    const p = mapa.get(f.phaseKey)!
    if (p.entradaEm && !p.saidaEm && f.phaseKey !== a.faseAtualKey) {
      const proxima = a.fases.slice(i + 1).map((g) => mapa.get(g.phaseKey)?.entradaEm).find((d) => d && Date.parse(d) > Date.parse(p.entradaEm!))
      if (proxima) mapa.set(f.phaseKey, { ...p, saidaEm: proxima })
    }
  }
  return mapa
}

