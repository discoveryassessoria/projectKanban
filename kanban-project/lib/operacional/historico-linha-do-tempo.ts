// lib/operacional/historico-linha-do-tempo.ts
// ============================================================================
// O "HISTÓRICO COMPLETO" DA TORRE COMO LINHA DO TEMPO — módulo PURO (sem banco, sem relógio, sem React).
//
// Só LEITURA e só APRESENTAÇÃO: os fatos e os filtros são os de `historico-processo.ts` / `historico-filtros.ts` (a fonte da verdade);
// aqui cada fato vira UMA linha compacta — "22:41 · Marco Rovatti · subiu a prioridade de 12 certidões para alta · em lote" — e entram:
//   • ANTES → DEPOIS de toda alteração ("prazo 30/09 → 15/10", "responsável ninguém → Daniela Brait");
//   • MARCO de fase destacado, com os dias na fase que ficou para trás ("Avançou para Emissão Documental · 12 dias em Genealogia");
//   • UMA linha cinza por dia para os fatos automáticos ("5 fatos automáticos (preparo da fase)");
//   • dias como cabeçalho, com a contagem do dia, e o resumo de uma linha no topo;
//   • "novos desde a última visita";
//   • o CSV na forma de linha do tempo e o PDF "para o cliente" (só andamento, sem nada interno).
// Nenhuma função daqui altera dado nem oferece ação sobre dado.
// ============================================================================
import type { FatoDoHistorico, Mudanca, SubtipoDeFato } from './historico-processo'
import { ROTULO_SUBTIPO } from './historico-processo'
import {
  FILTROS_LIMPOS, ROTULO_AUTOMATICO, dataHoraSP, diaSP, horaSP, passaNosFiltros, rotuloDoDia, rotuloDoMomento, type FiltrosDoHistorico,
} from './historico-filtros'
import { celulaSegura } from './historico-exportar'
import { apresentarCodigos } from './motivos-legiveis'

// ─── FILTROS DA JANELA ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A certidão que a ação "Histórico" da lista de certidões da fase atual passa para a janela. */
export interface CertidaoDoFiltro { documentoId: number | null; tarefaId: number | null; rotulo: string }
export interface FiltrosDaLinhaDoTempo extends FiltrosDoHistorico { certidao: CertidaoDoFiltro | null }

/** Ao abrir: TODO o período, automáticos ocultos, nenhuma certidão. */
export const FILTROS_PADRAO_DA_LINHA: FiltrosDaLinhaDoTempo = { ...FILTROS_LIMPOS, ocultarAutomaticos: true, certidao: null }

const linksDoFato = (f: FatoDoHistorico) => [f.links, ...f.agrupadoDe.map((i) => i.links)]

export function passaNaLinhaDoTempo(f: FatoDoHistorico, fil: FiltrosDaLinhaDoTempo, agora: Date, ignorar: 'quem' | 'tipo' | 'pessoa' | 'automaticos' | null = null): boolean {
  if (!passaNosFiltros(f, fil, agora, ignorar)) return false
  if (fil.certidao) {
    const c = fil.certidao
    const dela = linksDoFato(f).some((l) => (c.documentoId != null && l.documentoId === c.documentoId) || (c.documentoId == null && c.tarefaId != null && l.tarefaId === c.tarefaId))
    if (!dela) return false
  }
  return true
}

/** O número do botão "Filtrar (N)": quantos filtros fogem do padrão (a busca fica sempre à vista e não conta). */
export function filtrosAtivos(fil: FiltrosDaLinhaDoTempo): number {
  return [fil.periodo !== 'todo', fil.quem !== 'todos', fil.tipo !== 'todos', fil.pessoaId !== 'todas', fil.certidao != null, !fil.ocultarAutomaticos].filter(Boolean).length
}

// ─── A LINHA ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ItemDaLinha { hora: string; frase: string; mudanca: string | null; certidao: string | null; pessoa: string | null }
export interface LinhaDoTempo {
  id: string
  quando: string
  hora: string
  quem: string
  quemTipo: 'humano' | 'sistema'
  /** A ação sem o autor: "subiu a prioridade de 12 certidões para alta". */
  texto: string
  /** Contexto curto da mesma linha: "Emissão Documental · em lote". */
  contexto: string | null
  /** Motivo (e justificativa) — vai na mesma linha, em texto mais fraco. */
  motivo: string | null
  /** "prazo 30/09 → 15/10". */
  mudanca: string | null
  marco: boolean
  automatico: boolean
  novo: boolean
  quantidade: number
  itens: ItemDaLinha[]
  /** O que o clique expande: certidões envolvidas, efeito, campos alterados. */
  detalhe: { certidoes: string[]; efeito: string | null; justificativa: string | null; campos: string[] }
  tipo: FatoDoHistorico['tipo']
  subtipo: SubtipoDeFato
}

const RANK_PRIORIDADE: Record<string, number> = { baixa: 0, média: 1, alta: 2, urgente: 3 }

export const textoDaMudanca = (m: Mudanca): string =>
  m.antes != null && m.depois != null ? `${m.campo} ${m.antes} → ${m.depois}` : m.depois != null ? `${m.campo} → ${m.depois}` : m.antes != null ? `${m.campo} ${m.antes} →` : m.campo

function semOAutor(f: FatoDoHistorico): string {
  const n = f.nucleo
  if (f.quem.tipo === 'sistema' && n.startsWith('Sistema ')) return n.slice('Sistema '.length)
  return n.startsWith(`${f.quem.nome} `) ? n.slice(f.quem.nome.length + 1) : n
}

/** O verbo da prioridade pela DIREÇÃO da mudança: "subiu" / "baixou" (ou "alterou" quando o lote mistura). */
function verboDaPrioridade(f: FatoDoHistorico): string {
  const pares = (f.agrupadoDe.length ? f.agrupadoDe.map((i) => i.mudancas[0]) : [f.mudancas[0]]).filter((m): m is Mudanca => !!m && m.antes != null && m.depois != null)
  if (pares.length === 0) return 'alterou'
  const sobe = pares.map((m) => (RANK_PRIORIDADE[m.depois!] ?? 0) - (RANK_PRIORIDADE[m.antes!] ?? 0))
  return sobe.every((d) => d > 0) ? 'subiu' : sobe.every((d) => d < 0) ? 'baixou' : 'alterou'
}

/** Fase de um marco = o "depois" da mudança de fase. */
const faseDoMarco = (f: FatoDoHistorico): { antes: string | null; depois: string | null } => {
  const m = f.mudancas.find((x) => x.campo === 'fase')
  return { antes: m?.antes ?? null, depois: m?.depois ?? null }
}

const DIA_MS = 86_400_000
const diasTexto = (ms: number): string => {
  const d = Math.floor(ms / DIA_MS)
  return d < 1 ? 'menos de 1 dia' : `${d} ${d === 1 ? 'dia' : 'dias'}`
}

/** Para cada marco de fase, quanto tempo o processo ficou na fase que ele deixou (o marco anterior é a entrada nela). */
export function tempoNaFaseDosMarcos(fatos: FatoDoHistorico[]): Map<string, number> {
  const marcos = fatos.filter((f) => f.marco && (f.subtipo === 'abertura' || f.subtipo === 'avanco_fase' || f.subtipo === 'retorno_fase' || f.subtipo === 'movimento_fase'))
    .sort((a, b) => (a.quando < b.quando ? -1 : a.quando > b.quando ? 1 : 0))
  const out = new Map<string, number>()
  let entrada: number | null = null
  for (const m of marcos) {
    const t = Date.parse(m.quando)
    if (m.subtipo !== 'abertura' && entrada != null) out.set(m.id, t - entrada)
    entrada = t
  }
  return out
}

function textoDoMarco(f: FatoDoHistorico, noMarco: Map<string, number>): string {
  const { antes, depois } = faseDoMarco(f)
  const destino = depois ?? 'a próxima fase'
  const dias = noMarco.get(f.id)
  const naFase = dias != null ? ` · ${diasTexto(dias)}${antes ? ` em ${antes}` : ' na fase'}` : ''
  switch (f.subtipo) {
    case 'abertura': return depois ? `Entrou em ${depois}` : 'Abriu o processo'
    case 'retorno_fase': return `Voltou para ${destino}${naFase}`
    case 'movimento_fase': return `Moveu para ${destino}${naFase}`
    default: return /forçad/i.test(f.verbo) ? `Avançou na marra para ${destino}${naFase}` : `Avançou para ${destino}${naFase}`
  }
}

/** Uma linha por fato, com o mesmo texto para a tela, o CSV e o PDF. */
export function linhaDoFato(f: FatoDoHistorico, ctx: { tempoNaFase: Map<string, number>; novos: ReadonlySet<string> }): LinhaDoTempo {
  const humano = f.quem.tipo === 'humano'
  let texto: string
  let contexto = f.contexto
  if (f.marco && (f.subtipo === 'abertura' || f.subtipo === 'avanco_fase' || f.subtipo === 'retorno_fase' || f.subtipo === 'movimento_fase')) {
    texto = textoDoMarco(f, ctx.tempoNaFase)
    contexto = f.subtipo === 'abertura' ? f.contexto : null
  } else if (f.verbo === '' || f.objeto == null) {
    texto = semOAutor(f)
  } else if (f.subtipo === 'prioridade') {
    // Lote: "subiu a prioridade de 12 certidões para alta". Uma só: "subiu a prioridade da certidão X" + o antes → depois ao lado.
    const depois = f.mudancas[0]?.depois ?? null
    texto = f.quantidade > 1
      ? `${verboDaPrioridade(f)} a prioridade de ${f.objeto}${depois ? ` para ${depois}` : ''}`
      : `${verboDaPrioridade(f)} a prioridade ${f.objeto}`
  } else {
    // Quando o antes → depois já diz o que mudou (prazo, canal, responsável), o complemento ("para 15/10/2026 (era 30/09/2026)", "a Daniela") só repetiria.
    const jaNoAntesDepois = f.mudancas.length > 0 && (f.subtipo === 'prazo' || f.subtipo === 'canal' || f.subtipo === 'atribuida' || f.subtipo === 'transferida')
    texto = [f.verbo, f.objeto, jaNoAntesDepois ? null : f.complemento].filter(Boolean).join(' ')
  }
  // "lote" no contexto vem do redator ("Emissão Documental · lote"): vira o "em lote" único da linha.
  const contextoSemLote = contexto ? contexto.split(' · ').filter((x) => x !== 'lote').join(' · ') || null : null
  const partesDeContexto = [contextoSemLote, f.quantidade > 1 ? 'em lote' : null].filter((x): x is string => !!x)
  // O antes → depois vai na linha (menos nos marcos de fase, cujo texto já o diz). No lote de prioridade o "para alta" já está na frase:
  // só sobra o antes → depois quando todas as certidões saíam do mesmo valor.
  const mudanca = f.marco || !f.mudancas.length || (f.subtipo === 'prioridade' && f.quantidade > 1)
    ? null
    : f.mudancas.map(textoDaMudanca).join(' · ')
  const motivo = [f.motivo, f.justificativa ? `“${f.justificativa}”` : null].filter((x): x is string => !!x).join(' · ') || null
  const itens: ItemDaLinha[] = f.agrupadoDe.map((i) => ({ hora: horaSP(i.quando), frase: i.frase, mudanca: i.mudancas.length ? i.mudancas.map(textoDaMudanca).join(' · ') : null, certidao: i.certidao, pessoa: i.pessoa }))
  const certidoes = [...new Set((f.agrupadoDe.length ? f.agrupadoDe.map((i) => [i.certidao, i.pessoa].filter(Boolean).join(' · ')) : [[f.certidao, f.pessoa].filter(Boolean).join(' · ')]).filter(Boolean))]
  return {
    id: f.id, quando: f.quando, hora: horaSP(f.quando), quem: humano ? f.quem.nome : 'Sistema', quemTipo: f.quem.tipo,
    texto: apresentarCodigos(texto), contexto: partesDeContexto.length ? apresentarCodigos(partesDeContexto.join(' · ')) : null,
    motivo: motivo ? apresentarCodigos(motivo) : null, mudanca, marco: f.marco, automatico: f.automatico, novo: ctx.novos.has(f.id), quantidade: f.quantidade, itens,
    detalhe: {
      certidoes, efeito: f.efeito ? apresentarCodigos(f.efeito) : null, justificativa: f.justificativa,
      campos: f.mudancas.map(textoDaMudanca),
    },
    tipo: f.tipo, subtipo: f.subtipo,
  }
}

/** A linha numa só frase (CSV, PDF, busca): "22:41 · Marco Rovatti · subiu a prioridade de 12 certidões para alta · em lote · prazo 30/09 → 15/10 · motivo". */
export function fraseDaLinha(l: LinhaDoTempo, comData = false, rotuloDaData?: string): string {
  return [comData ? rotuloDaData : null, l.hora, l.quem, l.texto, l.contexto, l.mudanca, l.motivo ? `motivo: ${l.motivo}` : null].filter((x): x is string => !!x).join(' · ')
}

// ─── DIAS, AUTOMÁTICOS, RESUMO E "NOVOS" ────────────────────────────────────────────────────────────────────────────────

export interface DiaDaLinha {
  dia: string
  rotulo: string
  /** Fatos que o dia mostra (os automáticos ficam na linha cinza, a menos que estejam visíveis). */
  linhas: LinhaDoTempo[]
  /** A linha cinza do dia: "5 fatos automáticos (preparo da fase)" + os fatos que ela expande. `null` = nenhum automático no dia. */
  automaticos: { texto: string; linhas: LinhaDoTempo[] } | null
  /** "K fatos" do dia (visíveis + automáticos). */
  contagem: number
}

export interface ResumoDaLinha { fatos: number; desde: string | null; pessoas: number; cancelamentos: number; ultimo: string | null; novos: number; novosDesde: string | null; texto: string }

export interface VisaoDaLinhaDoTempo { dias: DiaDaLinha[]; resumo: ResumoDaLinha; mostrando: number; total: number }

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`
const dataCurta = (iso: string) => { const [, m, d] = diaSP(iso).split('-'); return `${d}/${m}` }

const descricaoDosAutomaticos = (fs: FatoDoHistorico[]): string => [...new Set(fs.map((f) => ROTULO_AUTOMATICO[f.subtipo] ?? ROTULO_SUBTIPO[f.subtipo].toLowerCase()))].join(', ')

export function novosDesde(fatos: FatoDoHistorico[], ultimaVisita: string | null): Set<string> {
  // Sem visita anterior não há "novo": a primeira abertura não marca o histórico inteiro.
  if (!ultimaVisita) return new Set()
  const corte = Date.parse(ultimaVisita)
  return new Set(fatos.filter((f) => Date.parse(f.quando) > corte).map((f) => f.id))
}

export function montarLinhaDoTempo(fatos: FatoDoHistorico[], fil: FiltrosDaLinhaDoTempo, agora: Date, ultimaVisita: string | null): VisaoDaLinhaDoTempo {
  const tempoNaFase = tempoNaFaseDosMarcos(fatos)
  const novos = novosDesde(fatos, ultimaVisita)
  const doFiltro = fatos.filter((f) => passaNaLinhaDoTempo(f, fil, agora, 'automaticos'))
  const visiveis = doFiltro.filter((f) => !(fil.ocultarAutomaticos && f.automatico))
  const linhaDe = (f: FatoDoHistorico) => linhaDoFato(f, { tempoNaFase, novos })

  const porDia = new Map<string, FatoDoHistorico[]>()
  for (const f of doFiltro) { const d = diaSP(f.quando); const l = porDia.get(d); if (l) l.push(f); else porDia.set(d, [f]) }
  const dias: DiaDaLinha[] = [...porDia.keys()].sort().reverse().map((dia) => {
    const doDia = porDia.get(dia)!
    const auto = doDia.filter((f) => f.automatico)
    const normais = doDia.filter((f) => !f.automatico)
    // Automáticos: UMA linha cinza por dia. Ocultos (padrão) ficam recolhidos nela; "mostrar" os põe abertos na própria linha.
    const nAuto = auto.reduce((s, f) => s + f.quantidade, 0)
    return {
      dia, rotulo: rotuloDoDia(dia, agora),
      linhas: normais.map(linhaDe),
      automaticos: auto.length ? { texto: `${plural(nAuto, 'fato automático', 'fatos automáticos')} (${descricaoDosAutomaticos(auto)})`, linhas: auto.map(linhaDe) } : null,
      contagem: doDia.length,
    }
  })

  const humanos = new Set(doFiltro.filter((f) => f.quem.tipo === 'humano' && f.quem.id != null).map((f) => f.quem.id))
  const ultimo = doFiltro.reduce<FatoDoHistorico | null>((m, f) => (!m || f.quando > m.quando ? f : m), null)
  const primeiro = doFiltro.reduce<FatoDoHistorico | null>((m, f) => (!m || f.quando < m.quando ? f : m), null)
  const cancelamentos = doFiltro.filter((f) => f.subtipo === 'cancelada').reduce((s, f) => s + f.quantidade, 0)
  const nNovos = doFiltro.filter((f) => novos.has(f.id)).length
  const resumo: ResumoDaLinha = {
    fatos: doFiltro.length, desde: primeiro ? dataCurta(primeiro.quando) : null, pessoas: humanos.size, cancelamentos,
    ultimo: ultimo ? rotuloDoMomento(ultimo.quando, agora).replace(', ', ' ') : null, novos: nNovos, novosDesde: ultimaVisita ? dataCurta(ultimaVisita) : null, texto: '',
  }
  resumo.texto = [
    plural(resumo.fatos, 'fato', 'fatos'),
    resumo.desde ? `desde ${resumo.desde}` : null,
    plural(resumo.pessoas, 'pessoa', 'pessoas'),
    plural(resumo.cancelamentos, 'cancelamento', 'cancelamentos'),
    resumo.ultimo ? `último: ${resumo.ultimo}` : null,
    resumo.novosDesde && resumo.novos > 0 ? `${plural(resumo.novos, 'novo', 'novos')} desde ${resumo.novosDesde}` : null,
  ].filter((x): x is string => !!x).join(' · ')
  return { dias, resumo, mostrando: visiveis.length, total: fatos.length }
}

// ─── CSV (a mesma linha do tempo) ────────────────────────────────────────────────────────────────────────────────────────

export const CABECALHO_DO_CSV_DA_LINHA = ['Data e hora', 'Quem', 'Fato', 'Antes → depois', 'Motivo', 'Marco', 'Automático', 'Qtd', 'Itens do lote'] as const

export function csvDaLinhaDoTempo(fatos: FatoDoHistorico[], novos: ReadonlySet<string> = new Set()): string {
  const tempoNaFase = tempoNaFaseDosMarcos(fatos)
  const linhas = fatos.map((f) => {
    const l = linhaDoFato(f, { tempoNaFase, novos })
    return [
      dataHoraSP(f.quando), l.quem, [l.texto, l.contexto].filter(Boolean).join(' · '), l.mudanca ?? '', l.motivo ?? '', l.marco ? 'sim' : '', l.automatico ? 'sim' : 'não',
      String(l.quantidade), l.itens.map((i) => `${i.hora} ${[i.certidao, i.pessoa].filter(Boolean).join(' · ')}${i.mudanca ? ` (${i.mudanca})` : ''}`.trim()).join(' | '),
    ]
  })
  const corpo = [[...CABECALHO_DO_CSV_DA_LINHA].map(celulaSegura).join(';'), ...linhas.map((l) => l.map(celulaSegura).join(';'))].join('\r\n')
  return `﻿${corpo}\r\n`
}

/** O PDF interno: título, resumo e, por dia, as linhas (as mesmas do CSV). */
export function blocosDoPdf(visao: VisaoDaLinhaDoTempo): Array<{ tipo: 'dia'; texto: string } | { tipo: 'linha'; hora: string; texto: string; marco: boolean }> {
  const out: Array<{ tipo: 'dia'; texto: string } | { tipo: 'linha'; hora: string; texto: string; marco: boolean }> = []
  for (const d of visao.dias) {
    out.push({ tipo: 'dia', texto: `${d.rotulo} · ${plural(d.contagem, 'fato', 'fatos')}` })
    for (const l of [...d.linhas, ...(d.automaticos?.linhas ?? [])]) out.push({ tipo: 'linha', hora: l.hora, marco: l.marco, texto: [l.quem, l.texto, l.contexto, l.mudanca, l.motivo ? `motivo: ${l.motivo}` : null].filter(Boolean).join(' · ') })
  }
  return out
}

// ─── PDF "PARA O CLIENTE" ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Os tipos de fato (subtipos) que ENTRAM no PDF do cliente: só ANDAMENTO — abertura, avanço de fase, registro localizado, certidão pedida /
 * confirmada pelo cartório / recebida / validada, protocolo, e (por etapa concluída) apostilada e traduzida. Tudo o mais é interno e FICA FORA
 * (inclusive o RETORNO de fase: aparece na janela interna, não no PDF do cliente).
 */
export const SUBTIPOS_NO_PDF_DO_CLIENTE: readonly SubtipoDeFato[] = [
  'abertura', 'avanco_fase', 'movimento_fase', 'localizada', 'solicitada', 'confirmacao_pedido', 'recebida', 'validada', 'protocolo',
]
/** 'etapa_concluida' entra SÓ quando a etapa é de apostila ou de tradução (o resto é rotina interna). */
const RE_APOSTILA = /apostil/i
const RE_TRADUCAO = /traduç|traduc|traduz/i

export const SUBTIPOS_FORA_DO_PDF_DO_CLIENTE: readonly SubtipoDeFato[] = (Object.keys(ROTULO_SUBTIPO) as SubtipoDeFato[]).filter((s) => !SUBTIPOS_NO_PDF_DO_CLIENTE.includes(s))

export interface LinhaDoCliente { quando: string; dia: string; frase: string }

function etapaDoCliente(f: FatoDoHistorico): 'apostilada' | 'traduzida' | null {
  if (f.subtipo !== 'etapa_concluida') return null
  const alvo = `${f.objeto ?? ''} ${f.nucleo}`
  return RE_APOSTILA.test(alvo) ? 'apostilada' : RE_TRADUCAO.test(alvo) ? 'traduzida' : null
}

export function fraseDoCliente(f: FatoDoHistorico): string | null {
  const etapa = etapaDoCliente(f)
  if (!SUBTIPOS_NO_PDF_DO_CLIENTE.includes(f.subtipo) && !etapa) return null
  const n = f.quantidade
  const quem = f.pessoa ? ` · ${f.pessoa}` : ''
  const cert = n > 1 ? `${n} certidões${quem}` : `${f.certidao ?? 'Certidão'}${quem}`
  const { depois } = faseDoMarco(f)
  switch (etapa ?? f.subtipo) {
    case 'abertura': return 'Processo aberto'
    case 'avanco_fase': return `O processo avançou para a fase ${depois ?? 'seguinte'}`
    case 'movimento_fase': return `O processo passou para a fase ${depois ?? 'indicada'}`
    case 'localizada': {
      // "Registro de nascimento de Erminio Salvarani localizado" — só a certidão e a pessoa (o fato não guarda cartório nem cidade).
      if (n > 1) return `${n} registros localizados${f.pessoa ? ` · ${f.pessoa}` : ''}`
      const tipo = /^Certid[ãa]o de ([^\s-]+)/i.exec(f.certidao ?? '')?.[1]?.toLowerCase()
      return `Registro${tipo ? ` de ${tipo}` : ''}${f.pessoa ? ` de ${f.pessoa}` : ''} localizado`
    }
    case 'solicitada': return `${cert} — solicitada${n > 1 ? 's' : ''}`
    case 'confirmacao_pedido': return `${cert} — pedido confirmado pelo cartório`
    case 'recebida': return `${cert} — recebida${n > 1 ? 's' : ''}`
    case 'validada': return `${cert} — validada${n > 1 ? 's' : ''}`
    case 'protocolo': return `${cert} — protocolo informado`
    case 'apostilada': return `${cert} — apostilada${n > 1 ? 's' : ''}`
    case 'traduzida': return `${cert} — traduzida${n > 1 ? 's' : ''}`
    default: return null
  }
}

/** Só andamento, sem nome de ninguém da equipe, sem motivo, prioridade, atribuição ou cancelamento. Mais antigo primeiro. */
export function linhasDoCliente(fatos: FatoDoHistorico[]): LinhaDoCliente[] {
  return fatos
    .map((f) => { const frase = fraseDoCliente(f); return frase ? { quando: f.quando, dia: diaSP(f.quando), frase } : null })
    .filter((x): x is LinhaDoCliente => x != null)
    .sort((a, b) => (a.quando < b.quando ? -1 : a.quando > b.quando ? 1 : 0))
}

export interface CabecalhoDoCliente { titulo: string; subtitulo: string }
export function cabecalhoDoCliente(a: { familiaNome: string | null; faseAtual: string | null; geradoEm: Date }): CabecalhoDoCliente {
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(a.geradoEm)
  return { titulo: `Andamento do processo — família ${a.familiaNome ?? '—'}`, subtitulo: `Fase atual: ${a.faseAtual ?? '—'} · posição em ${data}` }
}

