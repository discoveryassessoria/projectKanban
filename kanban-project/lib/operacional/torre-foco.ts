// lib/operacional/torre-foco.ts
// ============================================================================
// FOCO DA FAMÍLIA — Bloco I3 (30/09/2026).
//
// Tudo é LEITURA das fontes que já existem — nenhum número recalculado, nada de exemplo:
//   • os 4 números e a tabela vêm das MESMAS linhas da aba Tarefas (`listarTarefasDaTorre`),
//     recortadas pelo processo — por isso batem com ela;
//   • "X de Y certidões recebidas" é o progresso real do Bloco E9 (`progressoRealDoProcesso`,
//     a mesma completude documental da Central);
//   • a LINHA DO TEMPO não é mais montada aqui: é o Histórico do processo (um registro por fato
//     real), o MESMO serviço da aba Histórico — `src/services/historico-processo.ts`, servido por
//     `/api/torre/foco/{id}/historico`. Duas linhas do tempo para a mesma família divergiriam.
// Comentários e "Relatório de controle" reaproveitam /api/comentarios e o motor de Relatórios.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { labelDaFasePorPhaseKey } from '@/src/lib/process-stage/fases-catalog'
import { listarTarefasDaTorre, type LinhaDaTorre } from '@/src/services/torre-tarefas'
import { listarCanceladasDaTorre } from '@/src/services/torre-canceladas'
import { progressoRealDoProcesso, diasNaFaseAtual } from './metricas-processo'
import { pausaVigenteDoProcesso, type PausaDoProcesso } from '@/src/services/processo-pausa'
import { STATUS_DOCUMENTO_INATIVOS } from '@/src/lib/documentos/status-inativos'
import { encerramentosDosDocumentos } from '@/src/services/encerramento-documental'
import { TIPO_DOCUMENTO_LABELS } from '@/src/lib/process-stage/estrutura-operacional'
import type { EncerramentoDoDocumento } from '@/src/lib/process-stage/estrutura-operacional-core'
import { montarPessoasDoProcesso } from '@/src/lib/process-stage/central-operacional-core'
import { pessoasAtivasDaArvore, VINCULO_PROCESSO_ATIVO } from '@/src/lib/genealogia/vinculo-ativo'
import { getFase } from '@/src/lib/process-stage/fases-catalog'
import { visaoGerencialComExtras, type LinhaGerencial } from './tarefa-projecoes'
import { itensPrecisaDeVoce } from './precisa-de-voce'
import { entradaDoRisco } from './torre-processos'
import { riscoDoProcesso, type RiscoCalculado } from './torre-risco'
import { proximaAcaoDoProcesso, prazoCurto } from './torre-proxima-acao'
import { metaDaFase } from './torre-metas'
import { BOLA_NOSSA } from './torre-bola'
import { nivelDeRisco } from './torre-filtros'
import { motivoLegivel, porQuem } from './motivos-legiveis'
import { lerCaminhoDoProcesso, type CaminhoDoProcesso } from './torre-caminho-leitura'
import { lerTravaDoProcesso, type TravaDoProcesso } from './torre-trava'
import { RESULTADOS_QUE_MOVEM_DE_FASE } from './metricas-processo'
import {
  cartaoDaProximaAcao, cartoesDaFase, chaveDoStatus, rotuloDia, rotuloDoStatus, rotuloDuracaoMedia, rotuloMesAno,
  type CartaoSimples, type LinhaDaTabela,
} from './torre-processo-puro'

export interface FocoDaFamilia {
  processoId: number
  familiaId: number | null
  familiaNome: string
  pais: string | null
  codigo: string | null
  faseAtual: { key: string | null; label: string | null; dias: number | null; horas: number | null; desde: string | null; origem: string | null }
  certidoes: { recebidas: number; requeridas: number }
  numeros: { abertas: number; vencidas: number; comCartorio: number; semResponsavel: number }
  tarefas: LinhaDaTorre[]
  /**
   * PROCESSO PAUSADO (Torre nova, M2): `null` = ativo na Torre. Preenchido = a pausa vigente (quem, quando, por quê) — o
   * detalhe do Processo continua acessível e mostra "Pausado"; só a Torre (lista, KPIs, Radar…) o deixa de fora.
   */
  pausa: PausaDoProcesso | null
  /**
   * CANCELAR NUNCA ESCONDE, SÓ MARCA: as certidões CANCELADAS ou NÃO EXIGIDAS não são trabalho (não entram em `tarefas` nem nos
   * 4 números), mas o Foco as MOSTRA, marcadas, com quem/quando/por quê. O Histórico (mesma tela) registra o fato.
   */
  encerradas: CertidaoEncerradaDoFoco[]
}

export interface CertidaoEncerradaDoFoco {
  /** `null` = tarefa cancelada que não tem Documento (a lista da aba Tarefas também a mostra). */
  documentoId: number | null
  titulo: string
  pessoa: string | null
  encerramento: EncerramentoDoDocumento | null
  tipo: 'CANCELADA' | 'NAO_EXIGIDA'
  /** Torre nova (detalhe do Processo) — campos ADITIVOS: a pessoa, a ordem dela na árvore, e a tarefa/fase da certidão (se houve tarefa). */
  pessoaId?: number | null
  ordemArvore?: number | null
  tarefaId?: number | null
  faseMacroKey?: string | null
  /** `true` = certidão inativa (não exigida/cancelada) que NÃO tem tarefa cancelada: fica fora da conta das "canceladas" da aba Tarefas. */
  semTarefa?: boolean
}

/** Os 4 números do Foco — a MESMA definição dos filtros da aba Tarefas (Vencidas / Aguardando terceiros / Sem responsável). */
export function numerosDoFoco(linhas: Array<Pick<LinhaDaTorre, 'atrasada' | 'estadoOperacao' | 'responsavelId'>>) {
  return {
    abertas: linhas.length,
    vencidas: linhas.filter((l) => l.atrasada).length,
    comCartorio: linhas.filter((l) => l.estadoOperacao === 'AGUARDANDO').length,
    semResponsavel: linhas.filter((l) => l.responsavelId == null).length,
  }
}

export async function focoDaFamilia(processoId: number, agora = new Date()): Promise<FocoDaFamilia | null> {
  const proc = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, nome: true, codigo: true, faseAtualKey: true, familiaId: true, arvoreId: true, familia: { select: { nome: true } }, paisCanonico: { select: { countryLabel: true } } },
  })
  if (!proc) return null

  // O detalhe do Processo continua acessível MESMO pausado (`incluirPausados`) — a pausa tira o processo da Torre, não do Foco.
  const [{ linhas }, progresso, dias, pausa] = await Promise.all([
    listarTarefasDaTorre({ processoId }, agora, { incluirPausados: true }),
    progressoRealDoProcesso(processoId),
    diasNaFaseAtual(processoId, agora),
    pausaVigenteDoProcesso(processoId),
  ])
  const rot = (k: string | null) => (k ? labelDaFasePorPhaseKey(k) ?? k : '—')

  // As certidões fora do trabalho (canceladas / não exigidas) do processo: uma leitura em lote, pela mesma fonte da Central.
  const inativos = proc.arvoreId
    ? await prisma.documento.findMany({
        where: { pessoa: { arvoreId: proc.arvoreId }, status: { in: [...STATUS_DOCUMENTO_INATIVOS] } },
        select: { id: true, tipo: true, status: true, pessoaId: true, pessoa: { select: { nome: true, sobrenome: true, numeroLinhagem: true } } },
        orderBy: { id: 'asc' },
      })
    : []
  const idsInativos = inativos.map((d) => d.id)
  const [encerramentos, tarefasDosInativos] = await Promise.all([
    encerramentosDosDocumentos(idsInativos, prisma, agora),
    idsInativos.length ? prisma.tarefa.findMany({ where: { documentoId: { in: idsInativos } }, select: { id: true, documentoId: true, titulo: true, faseMacroKey: true }, orderBy: { id: 'desc' } }) : Promise.resolve([]),
  ])
  const tituloDoDoc = new Map<number, string>()
  const tarefaDoDoc = new Map<number, { id: number; faseMacroKey: string | null }>()
  for (const t of tarefasDosInativos) if (t.documentoId != null && !tituloDoDoc.has(t.documentoId)) { tituloDoDoc.set(t.documentoId, t.titulo.split(' · ')[0].trim()); tarefaDoDoc.set(t.documentoId, { id: t.id, faseMacroKey: t.faseMacroKey }) }
  // AS CANCELADAS = a MESMA consulta da aba Tarefas (`listarCanceladasDaTorre`, src/services/torre-canceladas.ts): o número do card é o tamanho desta lista (L3).
  // As certidões inativas SEM tarefa cancelada (ex.: "não exigida" pela árvore, que nunca teve tarefa) ficam à parte, como "sem tarefa": nunca somadas às canceladas.
  const canceladasDaTorre = await listarCanceladasDaTorre({ processoId }, agora)
  const docsDasCanceladas = new Set(canceladasDaTorre.map((l) => l.documentoId).filter((x): x is number => x != null))
  const encerradasCanceladas: CertidaoEncerradaDoFoco[] = canceladasDaTorre.map((l) => ({
    documentoId: l.documentoId ?? null, titulo: l.titulo.split(' · ')[0].trim(), pessoa: l.pessoaNome ?? l.casalNomes ?? null,
    // quem/quando/por quê: o do documento (traz o "Reabrir" da porta canônica) ou, sem documento, o da própria tarefa (o mesmo log da aba Tarefas).
    encerramento: encerramentos.get(l.documentoId ?? -1) ?? (l.encerramento
      ? { tipo: 'CANCELADA' as const, quando: l.encerramento.quando, quandoRotulo: l.encerramento.quandoRotulo, porId: null, porNome: l.encerramento.porNome, motivo: l.encerramento.motivo, justificativa: null, tarefaReabrivelId: null, observacao: null }
      : null),
    tipo: 'CANCELADA' as const,
    pessoaId: l.pessoaId ?? null, ordemArvore: null, tarefaId: l.taskId, faseMacroKey: l.faseMacroKey ?? null,
  }))
  const encerradasSemTarefa: CertidaoEncerradaDoFoco[] = inativos.filter((d) => !docsDasCanceladas.has(d.id)).map((d) => ({
    documentoId: d.id,
    titulo: tituloDoDoc.get(d.id) ?? (d.tipo ? TIPO_DOCUMENTO_LABELS[d.tipo] ?? String(d.tipo) : `Documento #${d.id}`),
    pessoa: d.pessoa ? [d.pessoa.nome, d.pessoa.sobrenome].filter(Boolean).join(' ') : null,
    encerramento: encerramentos.get(d.id) ?? null,
    tipo: (String(d.status) === 'NAO_EXIGIDO' ? 'NAO_EXIGIDA' : 'CANCELADA') as 'CANCELADA' | 'NAO_EXIGIDA',
    pessoaId: d.pessoaId, ordemArvore: d.pessoa?.numeroLinhagem ?? null,
    tarefaId: tarefaDoDoc.get(d.id)?.id ?? null, faseMacroKey: tarefaDoDoc.get(d.id)?.faseMacroKey ?? null, semTarefa: true,
  }))
  const encerradas: CertidaoEncerradaDoFoco[] = [...encerradasCanceladas, ...encerradasSemTarefa]

  return {
    processoId, familiaId: proc.familiaId, familiaNome: proc.familia?.nome ?? proc.nome,
    pais: proc.paisCanonico?.countryLabel ?? null, codigo: proc.codigo,
    faseAtual: { key: proc.faseAtualKey, label: rot(proc.faseAtualKey), dias: dias.dias, horas: dias.horas, desde: dias.desde, origem: dias.origem },
    certidoes: { recebidas: progresso.completed, requeridas: progresso.required },
    numeros: numerosDoFoco(linhas), tarefas: linhas, pausa, encerradas,
  }
}


// ============================================================================
// O DETALHE DO PROCESSO (Torre nova, frente H, 01/10/2026) — a MESMA fonte do Foco, mais o que a página inteira precisa:
// cabeçalho, próxima ação (derivada), trava (BlockingEngine), previsão, caminho das fases, os cinco cartões e a tabela de
// certidões da fase atual INCLUINDO as canceladas e as não exigidas. O Foco (gaveta) continua lendo `focoDaFamilia`; esta função
// só ACRESCENTA ao mesmo objeto. Nada é gravado; nenhum número é recalculado: as linhas são as da aba Tarefas.
// ============================================================================

export interface PrevisaoDoProcesso { titulo: string; sub: string }

export interface DetalheDoProcesso extends FocoDaFamilia {
  cabecalho: {
    inicial: string
    requerentes: number
    abertoEm: string | null
    /** O risco do processo — a regra ÚNICA `torre-risco.ts` (a mesma do Radar e de Processos). `null` = não calculado (processo pausado). */
    risco: RiscoCalculado | null
    /** O processo tem item no "Precisa de você". */
    noPrecisaDeVoce: boolean
    faseNumero: number | null
    faseTotal: number
  }
  proximaAcao: { titulo: string; detalhe: string; urgente: boolean } | null
  trava: TravaDoProcesso | null
  previsao: PrevisaoDoProcesso
  caminho: CaminhoDoProcesso
  cartoes: CartaoSimples[]
  tabela: LinhaDaTabela[]
  /** Tarefas abertas de fase ANTERIOR (não entram na tabela da fase atual, mas existem — "fase deixada"). */
  deFasesAnteriores: { n: number; fases: string[] }
  geradoEm: string
}

/** O que a tabela precisa saber de cada PESSOA: a geração calculada, a linha reta e o nascimento (regra fixa de ordem das certidões). */
interface InfoDaPessoa { rotulo: string | null; geracao: number | null; linhaReta: boolean | null; nascimento: string | null }
const tipoDoTitulo = (titulo: string): string => titulo.split(' · ')[0].replace(/\s*-\s*Inteiro Teor\s*$/i, '').trim()

/** A linha aberta da Torre → linha da tabela. */
function linhaAberta(l: LinhaDaTorre, info: Map<number, InfoDaPessoa>, faseDe: (key: string | null) => LinhaDaTabela['fase']): LinhaDaTabela {
  const risco = nivelDeRisco(l)
  return {
    chave: `t${l.taskId}`, tarefaId: l.taskId, documentoId: l.documentoId, tipo: 'ABERTA',
    titulo: tipoDoTitulo(l.titulo), pessoaId: l.pessoaId, pessoa: l.pessoaNome ?? l.casalNomes ?? null,
    geracao: l.pessoaId != null ? info.get(l.pessoaId)?.rotulo ?? null : null, geracaoNum: l.geracao, linhaReta: l.linhaReta, pessoaNascimento: l.pessoaNascimento,
    // `passoAtual.ordem` = passos já concluídos; a coluna mostra o passo EM QUE ESTÁ ("1/4" = o primeiro de 4), como o protótipo.
    passo: l.passoCorrente ? { rotulo: l.passoCorrente.label, ordem: l.passoAtual ? Math.min(l.passoAtual.ordem + 1, l.passoAtual.total) : 0, total: l.passoAtual?.total ?? 0 } : null,
    status: chaveDoStatus(l.statusTarefa), statusRotulo: rotuloDoStatus(l.statusTarefa),
    responsavelId: l.responsavelId, responsavelNome: l.responsavelNome,
    iniciouEm: l.iniciouEm, concluidaEm: null, dataPrazo: l.dataPrazo, rotuloDoPrazo: l.rotuloDoPrazo,
    risco, atrasada: l.atrasada, bola: l.bolaCom, encerramentoTexto: null, motivoTexto: null, reabrivel: false,
    podeAtribuir: l.responsavelId == null, fase: faseDe(l.faseMacroKey ?? null),
  }
}

function linhaConcluida(l: LinhaGerencial, info: Map<number, InfoDaPessoa>, fase: LinhaDaTabela['fase']): LinhaDaTabela {
  return {
    chave: `t${l.taskId}`, tarefaId: l.taskId, documentoId: l.documentoId, tipo: 'CONCLUIDA',
    titulo: tipoDoTitulo(l.titulo), pessoaId: l.pessoaId, pessoa: l.pessoaNome ?? l.casalNomes ?? null,
    geracao: l.pessoaId != null ? info.get(l.pessoaId)?.rotulo ?? null : null, geracaoNum: l.geracao, linhaReta: l.linhaReta, pessoaNascimento: l.pessoaNascimento,
    passo: null, status: 'CONCLUIDA', statusRotulo: rotuloDoStatus(l.statusTarefa),
    responsavelId: l.responsavelId, responsavelNome: l.responsavelNome,
    iniciouEm: l.iniciouEm, concluidaEm: l.concluidaEm, dataPrazo: null, rotuloDoPrazo: '',
    risco: null, atrasada: false, bola: null, encerramentoTexto: null, motivoTexto: null, reabrivel: false, podeAtribuir: false, fase,
  }
}

function linhaEncerrada(e: CertidaoEncerradaDoFoco, info: Map<number, InfoDaPessoa>, agora: Date, fase: LinhaDaTabela['fase']): LinhaDaTabela {
  const enc = e.encerramento
  const cancelada = e.tipo === 'CANCELADA'
  const encerramentoTexto = cancelada
    ? `cancelada${enc?.quandoRotulo ? ` ${enc.quandoRotulo}` : ''} ${porQuem(enc?.porNome)}${enc?.motivo ? ` · ${motivoLegivel(enc.motivo)}` : ''}`
    : `não exigida${enc?.quando ? ` desde ${rotuloDia(enc.quando, agora)}` : ''} · ${motivoLegivel(enc?.motivo) ?? 'a árvore deixou de exigir'}`
  const motivoTexto = cancelada
    ? `Cancelada ${porQuem(enc?.porNome)}${enc?.motivo ? ` · ${motivoLegivel(enc.motivo)}` : ''}${enc?.justificativa ? ` (${enc.justificativa})` : ''}`
    : `Não exigida: ${motivoLegivel(enc?.motivo) ?? 'a árvore deixou de exigir'}${enc?.observacao ? `. ${enc.observacao}` : ''}`
  return {
    chave: e.documentoId != null ? `d${e.documentoId}` : `t${e.tarefaId}`, tarefaId: enc?.tarefaReabrivelId ?? e.tarefaId ?? null, documentoId: e.documentoId, tipo: e.tipo,
    titulo: e.titulo, pessoaId: e.pessoaId ?? null, pessoa: e.pessoa,
    geracao: e.pessoaId != null ? info.get(e.pessoaId)?.rotulo ?? null : null,
    geracaoNum: e.pessoaId != null ? info.get(e.pessoaId)?.geracao ?? null : null,
    linhaReta: e.pessoaId != null ? info.get(e.pessoaId)?.linhaReta ?? null : null,
    pessoaNascimento: e.pessoaId != null ? info.get(e.pessoaId)?.nascimento ?? null : null,
    passo: null, status: e.tipo, statusRotulo: cancelada ? 'Cancelada' : 'Não exigida',
    responsavelId: null, responsavelNome: null, iniciouEm: null, concluidaEm: null, dataPrazo: null, rotuloDoPrazo: '',
    risco: null, atrasada: false, bola: null, encerramentoTexto, motivoTexto,
    reabrivel: cancelada && enc?.tarefaReabrivelId != null, podeAtribuir: false, fase, ...(e.semTarefa ? { semTarefa: true } : {}),
  }
}

async function previsaoDoProcesso(a: { processoId: number; paisId: number | null; paisLabel: string | null; arvoreId: number | null; abertoEm: Date; agora: Date }): Promise<PrevisaoDoProcesso> {
  const protocoloKey = getFase('PROTOCOLADO').phaseKey
  const movem = [...RESULTADOS_QUE_MOVEM_DE_FASE]
  const [propria, amostras, docs] = await Promise.all([
    prisma.phaseAdvanceLog.findFirst({ where: { processoId: a.processoId, fasePretendida: protocoloKey, resultado: { in: movem } }, orderBy: { criadoEm: 'asc' }, select: { criadoEm: true } }),
    a.paisId != null
      ? prisma.phaseAdvanceLog.findMany({
          where: { fasePretendida: protocoloKey, resultado: { in: movem }, processoId: { not: a.processoId }, processo: { paisId: a.paisId } },
          orderBy: { criadoEm: 'asc' }, select: { processoId: true, criadoEm: true, processo: { select: { dataInicio: true, createdAt: true } } },
        })
      : Promise.resolve([]),
    a.arvoreId != null
      ? prisma.documento.findMany({
          where: { pessoa: { arvoreId: a.arvoreId }, data_validade: { not: null }, status: { notIn: [...STATUS_DOCUMENTO_INATIVOS] } },
          orderBy: { data_validade: 'asc' }, take: 1, select: { data_validade: true, tipo: true, pessoa: { select: { nome: true, sobrenome: true } } },
        })
      : Promise.resolve([]),
  ])
  const dia = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  if (propria) {
    const dias = Math.max(0, (propria.criadoEm.getTime() - a.abertoEm.getTime()) / 86_400_000)
    return { titulo: `Protocolado em ${dia(propria.criadoEm)}`, sub: `levou ${rotuloDuracaoMedia(dias)} desde a abertura do processo` }
  }
  // A média REAL do país: cada processo que já chegou ao Protocolo conta UMA vez (a 1ª chegada), da abertura até lá.
  const porProcesso = new Map<number, number>()
  for (const l of amostras) {
    if (porProcesso.has(l.processoId) || !l.processo) continue
    const dias = (l.criadoEm.getTime() - (l.processo.dataInicio ?? l.processo.createdAt).getTime()) / 86_400_000
    if (dias >= 0) porProcesso.set(l.processoId, dias)
  }
  const n = porProcesso.size
  if (n === 0) return { titulo: '—', sub: `sem base: nenhum processo${a.paisLabel ? ` de ${a.paisLabel}` : ''} chegou ao Protocolo ainda` }
  const media = [...porProcesso.values()].reduce((s, x) => s + x, 0) / n
  const previsto = new Date(a.abertoEm.getTime() + media * 86_400_000)
  const validade = docs[0]?.data_validade ?? null
  let fraseValidade: string
  if (!validade) fraseValidade = 'validade das certidões não registrada'
  else {
    const quem = docs[0].pessoa ? ` de ${[docs[0].pessoa.nome, docs[0].pessoa.sobrenome].filter(Boolean).join(' ')}` : ''
    const doc = `${docs[0].tipo ? TIPO_DOCUMENTO_LABELS[docs[0].tipo] ?? String(docs[0].tipo) : 'Um documento'}${quem}`
    fraseValidade = validade.getTime() < a.agora.getTime() ? `${doc} venceu em ${dia(validade)}`
      : validade.getTime() < previsto.getTime() ? `${doc} vence em ${dia(validade)}, antes do protocolo previsto`
      : 'nenhuma certidão vence antes disso'
  }
  return {
    titulo: `Protocolo previsto: ${rotuloMesAno(previsto.toISOString())}`,
    sub: `média real ${a.paisLabel ?? 'do país'} ${rotuloDuracaoMedia(media)}${n < 3 ? ` (${n} ${n === 1 ? 'processo' : 'processos'})` : ''} · ${fraseValidade}`,
  }
}

export async function detalheDoProcesso(processoId: number, agora = new Date()): Promise<DetalheDoProcesso | null> {
  const foco = await focoDaFamilia(processoId, agora)
  if (!foco) return null
  const proc = await prisma.processo.findUnique({
    where: { id: processoId }, select: { dataInicio: true, createdAt: true, arvoreId: true, paisId: true, faseAtualKey: true },
  })
  if (!proc) return null
  const faseAtualKey = proc.faseAtualKey

  const [caminho, requerentes, pessoas, unioes, concluidas, itens, previsao] = await Promise.all([
    lerCaminhoDoProcesso(processoId),
    prisma.processoRequerente.count({ where: { processoId, ...VINCULO_PROCESSO_ATIVO } }),
    proc.arvoreId
      ? prisma.pessoa.findMany({
          where: pessoasAtivasDaArvore(proc.arvoreId),
          select: { id: true, nome: true, sobrenome: true, sexo: true, publicCode: true, numeroLinhagem: true, requerente: true, linhaReta: true, paiId: true, maeId: true, data_nasc: true },
        })
      : Promise.resolve([]),
    proc.arvoreId
      ? prisma.uniao.findMany({ where: { OR: [{ pessoa1: { arvoreId: proc.arvoreId } }, { pessoa2: { arvoreId: proc.arvoreId } }] }, select: { id: true, pessoa1Id: true, pessoa2Id: true } })
      : Promise.resolve([]),
    faseAtualKey
      ? visaoGerencialComExtras({ processoId, faseMacroKey: faseAtualKey, status: ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI'], pagina: 1, porPagina: 500 }, agora).then((r) => r.linhas)
      : Promise.resolve([] as LinhaGerencial[]),
    // O risco: o MESMO score do Radar e do "Precisa de você" (`itensPrecisaDeVoce`), só sobre as linhas deste processo.
    foco.pausa ? Promise.resolve([]) : itensPrecisaDeVoce({ agora, linhas: foco.tarefas }),
    previsaoDoProcesso({ processoId, paisId: proc.paisId, paisLabel: foco.pais, arvoreId: proc.arvoreId, abertoEm: proc.dataInicio ?? proc.createdAt, agora }),
  ])
  const cam: CaminhoDoProcesso = caminho ?? { fases: [], numeroDaFaseAtual: null, total: 0, proximaFaseLabel: null }

  // A posição de cada pessoa na árvore ("G1 bisavó") — a GERAÇÃO calculada pela filiação (nunca `numeroLinhagem`) + o motor de parentesco oficial.
  const nascimentoDe = new Map(pessoas.map((p) => [p.id, p.data_nasc ? p.data_nasc.toISOString() : null]))
  const info = new Map<number, InfoDaPessoa>()
  for (const p of montarPessoasDoProcesso(pessoas, unioes)) {
    const g = p.geracaoNaArvore
    const posicao = p.posicao && p.posicao !== '—' ? `${p.posicao}${p.posicaoEm ? ` de ${p.posicaoEm}` : ''}` : null
    info.set(p.pessoaId, {
      rotulo: g != null ? (posicao ? `G${g} ${posicao}` : `G${g}`) : null,
      geracao: g, linhaReta: p.linhaReta, nascimento: nascimentoDe.get(p.pessoaId) ?? null,
    })
  }

  const itensDoProcesso = itens.filter((i) => i.processoId === processoId)
  const metaDias = faseAtualKey ? await metaDaFase(faseAtualKey, proc.paisId) : null
  const abertasParaRisco = foco.tarefas
  const bolaForaRotulo = abertasParaRisco.find((l) => l.bolaCom !== BOLA_NOSSA)?.bolaCom ?? null
  const risco: RiscoCalculado | null = foco.pausa ? null
    : riscoDoProcesso(entradaDoRisco({ linhas: abertasParaRisco, itens: itensDoProcesso, diasNaFase: foco.faseAtual.dias, metaDias, bolaRotulo: bolaForaRotulo }))

  // A tabela: abertas e concluídas DA FASE ATUAL + as certidões canceladas / não exigidas.
  const abertasDaFase = foco.tarefas.filter((l) => faseAtualKey == null || l.faseMacroKey === faseAtualKey)
  const deFasesAnteriores = foco.tarefas.filter((l) => faseAtualKey != null && l.faseMacroKey !== faseAtualKey)
  // A LISTA É DO PROCESSO: TODAS as tarefas abertas, de qualquer fase (a fase mais antiga trava as seguintes), + as concluídas e encerradas da fase atual.
  const ordemDaFase = new Map(cam.fases.map((f) => [f.phaseKey, f.numero]))
  const faseDe = (key: string | null): LinhaDaTabela['fase'] => ({ key, label: key ? labelDaFasePorPhaseKey(key) ?? key : null, ordem: key != null ? ordemDaFase.get(key) ?? 9000 : 9000 })
  const faseDaAtual = faseDe(faseAtualKey ?? null)
  const trabalho: LinhaDaTabela[] = [...foco.tarefas.map((l) => linhaAberta(l, info, faseDe)), ...concluidas.map((l) => linhaConcluida(l, info, faseDaAtual))]
  const faseEhDocumental = trabalho.some((l) => l.documentoId != null)
  // As canceladas / não exigidas do PROCESSO (todas as fases): o card e a lista leem ESTE conjunto (o mesmo da aba Tarefas).
  const encerradasDaFase = foco.encerradas
  void faseEhDocumental
  const tabela = [...trabalho, ...encerradasDaFase.map((e) => linhaEncerrada(e, info, agora, e.faseMacroKey ? faseDe(e.faseMacroKey) : faseDaAtual))]

  // OS CARTÕES (Passo atual · Com quem · Prazo · Cartórios) leem a MESMA lista da tabela (todas as abertas do processo): L3 da Lei da Torre.
  const cartoes = cartoesDaFase({
    linhas: foco.tarefas,
    encerradas: { canceladas: encerradasDaFase.filter((e) => !e.semTarefa).length, naoExigidas: encerradasDaFase.filter((e) => e.semTarefa).length },
    riscoDe: (l) => nivelDeRisco(l),
    // As certidões da fase (abertas e concluídas) com o órgão vinculado no DOCUMENTO — o cartão Cartórios conta vinculadas e faltantes.
    certidoesDaFase: [...foco.tarefas, ...concluidas].map((l) => ({ documentoId: l.documentoId, terceiroNome: l.terceiroNome })),
  })

  const faseLabel = foco.faseAtual.label
  const trava = await lerTravaDoProcesso(processoId, { faseAtualKey, proximaFaseLabel: cam.proximaFaseLabel, certidoes: foco.certidoes })
  const rotulosAnteriores = [...new Set(deFasesAnteriores.map((l) => (l.faseMacroKey ? labelDaFasePorPhaseKey(l.faseMacroKey) ?? l.faseMacroKey : '—')))]

  return {
    ...foco,
    cabecalho: {
      inicial: (foco.familiaNome.replace(/^Família\s+/i, '').trim()[0] ?? foco.familiaNome[0] ?? '?').toUpperCase(),
      requerentes, abertoEm: (proc.dataInicio ?? proc.createdAt).toISOString(),
      risco, noPrecisaDeVoce: itensDoProcesso.length > 0, faseNumero: cam.numeroDaFaseAtual, faseTotal: cam.total,
    },
    proximaAcao: (() => {
      const pa = proximaAcaoDoProcesso(foco.tarefas, null, ordemDaFase, { rotuloDaFase: (k) => labelDaFasePorPhaseKey(k) ?? k, faseAtualLabel: faseLabel })
      return pa ? cartaoDaProximaAcao(pa, prazoCurto(pa.dataPrazo, agora).texto, faseLabel, itensDoProcesso.length > 0) : null
    })(),
    trava, previsao, caminho: cam, cartoes, tabela,
    deFasesAnteriores: { n: deFasesAnteriores.length, fases: rotulosAnteriores },
    geradoEm: agora.toISOString(),
  }
}
