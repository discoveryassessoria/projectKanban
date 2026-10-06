// scripts/torre-historico-linha-do-tempo.test.ts
// ============================================================================
// O "HISTÓRICO COMPLETO" DA TORRE COMO LINHA DO TEMPO — o que não pode regredir. Módulos PUROS, sem banco.
//   lote vira UM fato · antes → depois · marco de fase visível (com os dias na fase) · automáticos numa linha cinza por dia · resumo e
//   concordância · "novos desde a última visita" · filtros (padrão, contagem, certidão) · NENHUM botão de ação · PDF do cliente sem fato
//   interno · nenhum código interno na tela.
// ============================================================================
import { readFileSync } from "node:fs"
import { montarFatos, type ContextoDoHistorico, type LinhaCrua, type FatoDoHistorico } from "../lib/operacional/historico-processo"
import {
  FILTROS_PADRAO_DA_LINHA, montarLinhaDoTempo, linhaDoFato, tempoNaFaseDosMarcos, novosDesde, filtrosAtivos, csvDaLinhaDoTempo, blocosDoPdf,
  linhasDoCliente, cabecalhoDoCliente, SUBTIPOS_NO_PDF_DO_CLIENTE, SUBTIPOS_FORA_DO_PDF_DO_CLIENTE, passaNaLinhaDoTempo, type FiltrosDaLinhaDoTempo,
} from "../lib/operacional/historico-linha-do-tempo"
import { MOTIVO_EM_PORTUGUES, motivoLegivel, apresentarCodigos, porQuem, codigosSemTraducao, ehCodigoInterno } from "../lib/operacional/motivos-legiveis"
import { apresentarTextoDoHistorico } from "../lib/operacional/historico-apresentacao"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)

const FASES: Record<string, string> = { genealogia: "Genealogia", emissao_documental: "Emissão Documental" }
const tarefas: ContextoDoHistorico["tarefas"] = {}
const documentos: ContextoDoHistorico["documentos"] = {}
const passos: ContextoDoHistorico["passos"] = {}
for (let i = 0; i < 12; i++) {
  tarefas[100 + i] = { titulo: `Certidão de nascimento - Inteiro Teor · Pessoa ${i}`, documentoId: 200 + i, necessidadeId: null, pessoaId: 10 + i, faseMacroKey: "emissao_documental", statusTarefa: "EM_ANDAMENTO", responsavelId: null }
  documentos[200 + i] = { rotulo: null, pessoaId: 10 + i, necessidadeId: null, status: "PENDENTE" }
  passos[300 + i] = { stepKey: i === 7 ? "localizar_registro" : "solicitar_certidao", titulo: "Solicitar certidão", faseMacroKey: "emissao_documental", documentoId: 200 + i, necessidadeId: null, pessoaId: 10 + i }
}
const ctx = (): ContextoDoHistorico => ({
  processo: { id: 1, nome: "Salvarani", pais: "Itália", requerentes: 2, familiaId: 9 },
  usuarios: { 1: "Marco Rovatti", 2: "Daniela Brait" },
  pessoas: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [10 + i, `Pessoa ${i}`])),
  tarefas: structuredClone(tarefas), documentos: structuredClone(documentos), necessidades: {}, passos: structuredClone(passos),
  rotuloDaFase: (k) => (k ? FASES[k] ?? null : null),
})
const T = (iso: string, plusSeg = 0) => new Date(Date.parse(iso) + plusSeg * 1000).toISOString()
let seq = 0
const log = (acao: string, p: { entidade?: string; entidadeId?: number | null; usuarioId?: number | null; quando: string; detalhes?: Record<string, unknown>; descricao?: string }): LinhaCrua =>
  ({ fonte: "LOG", id: ++seq, acao, entidade: p.entidade ?? "Tarefa", entidadeId: p.entidadeId ?? null, descricao: p.descricao ?? acao, detalhes: p.detalhes ?? null, criadoEm: p.quando, usuarioId: p.usuarioId ?? null })
const AGORA = new Date("2026-10-05T15:00:00.000Z")
const D0 = "2026-10-04T22:41:10.000Z" // 19:41 em São Paulo
const novos = new Set<string>()
const linha = (f: FatoDoHistorico, fs: FatoDoHistorico[] = [f]) => linhaDoFato(f, { tempoNaFase: tempoNaFaseDosMarcos(fs), novos })
const FILTRO: FiltrosDaLinhaDoTempo = FILTROS_PADRAO_DA_LINHA

async function main() {
  secao("1) AÇÃO EM LOTE = UM FATO (identificador do lote, ou mesmo usuário + ação + mesmo minuto)")
  const prio = Array.from({ length: 12 }, (_, i) => log("TAREFA_PRIORIDADE_ALTERADA", { entidadeId: 100 + i, usuarioId: 1, quando: T(D0, i), detalhes: { tarefaId: 100 + i, de: "MEDIA", para: "ALTA" } }))
  const emSequencia = montarFatos(prio, ctx())
  ok("modo padrão (aba Histórico) NÃO muda: prioridade segue um fato por certidão", emSequencia.fatos.length === 12)
  const r = montarFatos(prio, ctx(), { agrupar: "minuto" })
  ok("12 alterações no mesmo minuto, mesmo usuário e mesma ação → UM fato com a contagem", r.fatos.length === 1 && r.fatos[0].quantidade === 12 && r.fatos[0].agrupadoDe.length === 12)
  const lp = linha(r.fatos[0])
  ok("a frase: 'subiu a prioridade de 12 certidões para alta · em lote'", lp.texto === "subiu a prioridade de 12 certidões para alta" && /em lote/.test(lp.contexto ?? ""), `${lp.quem} · ${lp.texto} · ${lp.contexto}`)
  ok("'ver as N' no detalhe: os 12 itens", lp.itens.length === 12 && lp.detalhe.certidoes.length === 12)
  const dois = montarFatos([...prio.slice(0, 6), ...prio.slice(6).map((l) => ({ ...l, criadoEm: T(D0, 120) }) as LinhaCrua)], ctx(), { agrupar: "minuto" })
  ok("minutos diferentes, sem lote → fatos diferentes", dois.fatos.length === 2 && dois.fatos.map((f) => f.quantidade).sort().join() === "6,6")
  const outroUsuario = montarFatos([prio[0], { ...prio[1], usuarioId: 2 } as LinhaCrua], ctx(), { agrupar: "minuto" })
  ok("outro usuário no mesmo minuto → não junta", outroUsuario.fatos.length === 2)
  const doLote = montarFatos(Array.from({ length: 6 }, (_, i) => log("TAREFA_ATRIBUIDA", { entidadeId: 100 + i, usuarioId: 1, quando: T(D0, i * 150), detalhes: { tarefaId: 100 + i, de: null, para: 2, loteId: "lote-abc" } })), ctx(), { agrupar: "minuto" })
  ok("o identificador do lote junta mesmo em minutos diferentes", doLote.fatos.length === 1 && doLote.fatos[0].quantidade === 6 && doLote.fatos[0].lote === "lote-abc")
  const canc = montarFatos(Array.from({ length: 3 }, (_, i) => log("TAREFA_CANCELADA", { entidadeId: 100 + i, usuarioId: 1, quando: T(D0, i), detalhes: { tarefaId: 100 + i, motivo: "Motivo: Documento não necessário" } })), ctx(), { agrupar: "minuto" })
  ok("cancelamento em lote vira UM fato ('cancelou 3 certidões')", canc.fatos.length === 1 && canc.fatos[0].quantidade === 3 && /3 certidões/.test(canc.fatos[0].objeto ?? ""))
  const prazo = montarFatos(Array.from({ length: 4 }, (_, i) => log("TAREFA_PRAZO_ALTERADO", { entidadeId: 100 + i, usuarioId: 1, quando: T(D0, i), detalhes: { tarefaId: 100 + i, de: "2026-09-30T15:00:00Z", para: "2026-10-15T15:00:00Z" } })), ctx(), { agrupar: "minuto" })
  ok("prazo em lote: um fato, e o antes → depois comum aparece na linha", prazo.fatos.length === 1 && linha(prazo.fatos[0]).mudanca === "prazo 30/09 → 15/10", String(linha(prazo.fatos[0]).mudanca))

  secao("2) TODA ALTERAÇÃO MOSTRA ANTES → DEPOIS")
  const um = montarFatos([log("TAREFA_PRAZO_ALTERADO", { entidadeId: 100, usuarioId: 1, quando: D0, detalhes: { tarefaId: 100, de: "2026-09-30T15:00:00Z", para: "2026-10-15T15:00:00Z", motivo: "cartório pediu mais tempo" } })], ctx(), { agrupar: "minuto" }).fatos[0]
  ok("prazo 30/09 → 15/10", linha(um).mudanca === "prazo 30/09 → 15/10")
  ok("o motivo vai na MESMA linha, em texto mais fraco (campo próprio)", linha(um).motivo === "cartório pediu mais tempo")
  const resp = montarFatos([log("TAREFA_ATRIBUIDA", { entidadeId: 100, usuarioId: 1, quando: D0, detalhes: { tarefaId: 100, de: null, para: 2 } })], ctx(), { agrupar: "minuto" }).fatos[0]
  ok("responsável ninguém → Daniela Brait", linha(resp).mudanca === "responsável ninguém → Daniela Brait", String(linha(resp).mudanca))
  const troca = montarFatos([log("TAREFA_TRANSFERIDA", { entidadeId: 100, usuarioId: 1, quando: D0, detalhes: { tarefaId: 100, de: 1, para: 2 } })], ctx(), { agrupar: "minuto" }).fatos[0]
  ok("transferência: responsável Marco Rovatti → Daniela Brait", linha(troca).mudanca === "responsável Marco Rovatti → Daniela Brait")
  const fase = montarFatos([{ fonte: "FASE", id: ++seq, faseAtual: "genealogia", fasePretendida: "emissao_documental", resultado: "AVANCADO", origem: "advance", solicitadoPorId: 1, forcado: false, justificativa: null, criadoEm: D0 }], ctx(), { agrupar: "minuto" }).fatos[0]
  ok("fase Genealogia → Emissão Documental (dado estruturado)", fase.mudancas[0]?.campo === "fase" && fase.mudancas[0].antes === "Genealogia" && fase.mudancas[0].depois === "Emissão Documental")
  const p1 = montarFatos([prio[0]], ctx(), { agrupar: "minuto" }).fatos[0]
  ok("prioridade de uma certidão: 'prioridade média → alta' ao lado", linha(p1).mudanca === "prioridade média → alta" && /^subiu a prioridade/.test(linha(p1).texto), `${linha(p1).texto} · ${linha(p1).mudanca}`)
  ok("prioridade que desce diz 'baixou'", linha(montarFatos([log("TAREFA_PRIORIDADE_ALTERADA", { entidadeId: 100, usuarioId: 1, quando: D0, detalhes: { tarefaId: 100, de: "ALTA", para: "BAIXA" } })], ctx(), { agrupar: "minuto" }).fatos[0]).texto.startsWith("baixou a prioridade"))

  secao("3) MUDANÇA DE FASE É MARCO — nunca escondida como automática")
  const abertura = log("PROCESSO_INICIALIZADO_V2", { entidade: "Processo", entidadeId: 1, usuarioId: 1, quando: T(D0, -12 * 86400), detalhes: { primeiraFase: "genealogia" } })
  const avanco: LinhaCrua = { fonte: "FASE", id: ++seq, faseAtual: "genealogia", fasePretendida: "emissao_documental", resultado: "AVANCADO", origem: "advance", solicitadoPorId: null, forcado: false, justificativa: null, criadoEm: D0 }
  const rf = montarFatos([abertura, avanco], ctx(), { agrupar: "minuto" })
  const marcoAvanco = rf.fatos.find((f) => f.subtipo === "avanco_fase")!, marcoAbertura = rf.fatos.find((f) => f.subtipo === "abertura")!
  ok("o avanço feito pelo SISTEMA não é automático (marco)", marcoAvanco.marco && !marcoAvanco.automatico)
  const tf = tempoNaFaseDosMarcos(rf.fatos)
  ok("'Entrou em Genealogia'", linha(marcoAbertura, rf.fatos).texto === "Entrou em Genealogia", linha(marcoAbertura, rf.fatos).texto)
  ok("'Avançou para Emissão Documental · 12 dias em Genealogia'", linha(marcoAvanco, rf.fatos).texto === "Avançou para Emissão Documental · 12 dias em Genealogia", linha(marcoAvanco, rf.fatos).texto)
  ok("o marco vem marcado como destaque na linha", linha(marcoAvanco, rf.fatos).marco === true && tf.get(marcoAvanco.id) != null)
  const marra = montarFatos([{ ...avanco, id: ++seq, resultado: "FORCADO", forcado: true, solicitadoPorId: 1, justificativa: "Cliente já entregou tudo; a trava é do sistema" }], ctx(), { agrupar: "minuto" }).fatos[0]
  const lm = linha(marra)
  ok("avanço 'na marra' mostra a justificativa", /^Avançou na marra para Emissão Documental/.test(lm.texto) && /Cliente já entregou tudo/.test(lm.motivo ?? ""), `${lm.texto} · ${lm.motivo}`)

  secao("4) AUTOMÁTICOS: UMA LINHA CINZA POR DIA")
  const preparos = Array.from({ length: 5 }, (_, i) => log("FASE_MATERIALIZADA", { entidade: "PROCESSO", entidadeId: 1, quando: T(D0, i), detalhes: { estado: "MATERIALIZADO", escopo: "NECESSIDADE", faseMacroKey: "genealogia", passosTotais: 3 + i, ciclo: 1 } }))
  const humano = log("TAREFA_CANCELADA", { entidadeId: 100, usuarioId: 1, quando: T(D0, 600), detalhes: { tarefaId: 100, motivo: "Motivo: Documento não necessário" } })
  const ra = montarFatos([...preparos, humano], ctx(), { agrupar: "minuto" })
  const va = montarLinhaDoTempo(ra.fatos, FILTRO, AGORA, null)
  ok("padrão: automáticos ocultos — uma linha cinza com a contagem e o que são", va.dias.length === 1 && va.dias[0].automaticos?.texto === "5 fatos automáticos (preparo da fase)", va.dias[0].automaticos?.texto ?? "")
  ok("a linha cinza expande nos 5 fatos; a lista do dia só tem o fato humano", va.dias[0].automaticos?.linhas.length === 5 && va.dias[0].linhas.length === 1)
  const vb = montarLinhaDoTempo(ra.fatos, { ...FILTRO, ocultarAutomaticos: false }, AGORA, null)
  ok("sem ocultar: os automáticos continuam numa linha só por dia (agora com os 5 dentro)", vb.dias[0].automaticos?.linhas.length === 5 && vb.dias[0].contagem === 6)

  secao("5) DIAS, RESUMO DE UMA LINHA E CONCORDÂNCIA")
  const cancel8 = montarFatos(Array.from({ length: 8 }, (_, i) => log("TAREFA_CANCELADA", { entidadeId: 100 + i, usuarioId: 1, quando: T(D0, i * 120), detalhes: { tarefaId: 100 + i, motivo: `Motivo: m${i}` } })), ctx(), { agrupar: "minuto" })
  const vr = montarLinhaDoTempo(cancel8.fatos, FILTRO, AGORA, null)
  ok("resumo: 'N fatos · desde 04/10 · 1 pessoa · 8 cancelamentos · último: …'", /^8 fatos · desde 04\/10 · 1 pessoa · 8 cancelamentos · último: /.test(vr.resumo.texto), vr.resumo.texto)
  ok("concordância: '1 pessoa' (nunca '1 pessoa atuaram') e '2 pessoas'", !/atuaram/.test(vr.resumo.texto) && /2 pessoas/.test(montarLinhaDoTempo(montarFatos([log("TAREFA_CANCELADA", { entidadeId: 100, usuarioId: 1, quando: D0, detalhes: { tarefaId: 100 } }), log("TAREFA_CANCELADA", { entidadeId: 101, usuarioId: 2, quando: T(D0, 300), detalhes: { tarefaId: 101 } })], ctx(), { agrupar: "minuto" }).fatos, FILTRO, AGORA, null).resumo.texto))
  const front = readFileSync("src/components/historico/HistoricoDoProcesso.tsx", "utf8")
  ok("a aba Histórico (componente antigo) também concorda: 'pessoa atuou' / 'pessoas atuaram'", /pessoa atuou/.test(front) && /pessoas atuaram/.test(front) && !/atuaram\{/.test(front))
  ok("cabeçalho do dia com a contagem do dia", vr.dias[0].contagem === 8 && /4 de outubro/.test(vr.dias[0].rotulo))

  secao("6) NOVO DESDE A ÚLTIMA VISITA")
  const tres = montarFatos([log("TAREFA_CANCELADA", { entidadeId: 100, usuarioId: 1, quando: "2026-10-01T15:00:00Z", detalhes: { tarefaId: 100 } }), ...[0, 1, 2].map((i) => log("TAREFA_CANCELADA", { entidadeId: 101 + i, usuarioId: 1, quando: T("2026-10-03T15:00:00Z", i * 120), detalhes: { tarefaId: 101 + i, motivo: `m${i}` } }))], ctx(), { agrupar: "minuto" })
  const vn = montarLinhaDoTempo(tres.fatos, FILTRO, AGORA, "2026-10-02T12:00:00.000Z")
  ok("fatos posteriores à última visita vêm marcados (3) e o antigo não", vn.dias.flatMap((d) => d.linhas).filter((l) => l.novo).length === 3 && vn.dias.flatMap((d) => d.linhas).filter((l) => !l.novo).length === 1)
  ok("o resumo diz '3 novos desde 02/10'", /3 novos desde 02\/10/.test(vn.resumo.texto), vn.resumo.texto)
  ok("sem visita anterior (primeira vez) nada é 'novo'", novosDesde(tres.fatos, null).size === 0 && !/novos? desde/.test(montarLinhaDoTempo(tres.fatos, FILTRO, AGORA, null).resumo.texto))
  const rota = readFileSync("src/lib/historico-rota.ts", "utf8")
  ok("a última visita é guardada por usuário E processo (e atualizada a cada visita, fora da lista de fatos)", /acao: ACAO_DE_VISITA, entidade: 'Processo', entidadeId: processoId, usuarioId/.test(rota) && /registrarVisita/.test(rota) && /HISTORICO_VISITADO/.test(readFileSync("lib/operacional/historico-processo.ts", "utf8")))

  secao("7) FILTROS: padrão, contagem e a certidão")
  ok("padrão: todo o período, automáticos ocultos, nenhum filtro ativo", FILTRO.periodo === "todo" && FILTRO.ocultarAutomaticos && filtrosAtivos(FILTRO) === 0)
  ok("o botão 'Filtrar (N)' conta só o que foge do padrão (a busca não conta)", filtrosAtivos({ ...FILTRO, busca: "x" }) === 0 && filtrosAtivos({ ...FILTRO, periodo: "7d", quem: "sistema", ocultarAutomaticos: false }) === 3)
  const certidaoX: FiltrosDaLinhaDoTempo = { ...FILTRO, certidao: { documentoId: 200, tarefaId: 100, rotulo: "Nascimento · Pessoa 0" } }
  ok("'Histórico' da certidão: só os fatos dela (inclusive dentro de um lote)", prio.length === 12 && r.fatos.filter((f) => passaNaLinhaDoTempo(f, certidaoX, AGORA)).length === 1 && cancel8.fatos.filter((f) => passaNaLinhaDoTempo(f, certidaoX, AGORA)).length === 1 && cancel8.fatos.filter((f) => passaNaLinhaDoTempo(f, { ...certidaoX, certidao: { documentoId: 299, tarefaId: null, rotulo: "x" } }, AGORA)).length === 0)
  ok("a busca está sempre à vista; período/quem/tipo/pessoa ficam atrás de 'Filtrar'", /aria-label="Buscar no histórico"/.test(readFileSync("src/components/torre/HistoricoLinhaDoTempo.tsx", "utf8")) && /\{painel && \(/.test(readFileSync("src/components/torre/HistoricoLinhaDoTempo.tsx", "utf8")))
  const certidoes = readFileSync("src/components/torre/ProcessoCertidoes.tsx", "utf8")
  ok("cada certidão da lista tem 'Histórico' (abre a janela já filtrada nela)", (certidoes.match(/onHistorico\(l\)/g) ?? []).length >= 2 && /certidao: \{ documentoId: l\.documentoId/.test(readFileSync("src/components/torre/TorreProcessoPagina.tsx", "utf8")))

  secao("8) SÓ LEITURA: nenhuma ação que altere dado dentro do histórico")
  const comp = readFileSync("src/components/torre/HistoricoLinhaDoTempo.tsx", "utf8")
  ok("sem 'Reabrir' e afins (reabrir, atribuir, cancelar, excluir, apagar)", !/reabrir|Reabrir|Atribuir|atribuir|Cancelar|excluir|Excluir|apagar/.test(comp))
  const chamadas = [...comp.matchAll(/(?:api\([^)]*"POST"|method: "(?:POST|PUT|PATCH|DELETE)")/g)].map((m) => m[0])
  ok("as únicas escritas são a visita e o registro de exportação (nenhuma sobre o processo)", chamadas.length === 2 && comp.includes('"POST", { visita: true }') && comp.includes("formato: paraCliente"))
  const pagina = readFileSync("src/components/torre/TorreProcessoPagina.tsx", "utf8")
  ok("a janela usa a linha do tempo (o componente com 'Reabrir certidão' saiu daqui)", /<HistoricoLinhaDoTempo/.test(pagina) && !/<HistoricoDoProcesso/.test(pagina))

  secao("9) EXPORTAÇÃO: CSV e PDF respeitam os filtros, no formato de linha do tempo")
  const csv = csvDaLinhaDoTempo(cancel8.fatos.filter((f) => passaNaLinhaDoTempo(f, certidaoX, AGORA))).replace(/^﻿/, "").split("\r\n").filter(Boolean)
  ok("CSV: cabeçalho de linha do tempo e só a linha filtrada", csv[0].startsWith('"Data e hora";"Quem";"Fato";"Antes → depois"') && csv.length === 2 && /cancelou/.test(csv[1]) && /Marco Rovatti/.test(csv[1]))
  ok("CSV: lote leva a contagem e os itens", (() => { const l = csvDaLinhaDoTempo(r.fatos).split("\r\n")[1]; return /"12"/.test(l) && (l.match(/ \| /g) ?? []).length === 11 })())
  ok("PDF (interno): os mesmos blocos — dia e linhas do filtro", (() => { const b = blocosDoPdf(montarLinhaDoTempo(cancel8.fatos, FILTRO, AGORA, null)); return b[0].tipo === "dia" && b.filter((x) => x.tipo === "linha").length === 8 })())
  ok("o servidor aplica os MESMOS filtros no CSV (passaNaLinhaDoTempo) e o PDF sai dos fatos filtrados da tela", /passaNaLinhaDoTempo/.test(rota) && /fatosFiltrados/.test(comp))

  secao("10) PDF PARA O CLIENTE — só andamento, nada interno")
  const interno = montarFatos([
    log("TAREFA_PRIORIDADE_ALTERADA", { entidadeId: 100, usuarioId: 1, quando: T(D0, 1), detalhes: { tarefaId: 100, de: "MEDIA", para: "ALTA", motivo: "cliente pressionou" } }),
    log("TAREFA_ATRIBUIDA", { entidadeId: 101, usuarioId: 1, quando: T(D0, 200), detalhes: { tarefaId: 101, de: null, para: 2 } }),
    log("TAREFA_CANCELADA", { entidadeId: 102, usuarioId: 2, quando: T(D0, 400), detalhes: { tarefaId: 102, motivo: "Motivo: erro interno de cadastro" } }),
    log("TAREFA_PRAZO_ALTERADO", { entidadeId: 103, usuarioId: 1, quando: T(D0, 600), detalhes: { tarefaId: 103, de: "2026-09-30T15:00:00Z", para: "2026-10-15T15:00:00Z", motivo: "equipe sem fôlego" } }),
    { fonte: "SOLICITACAO", id: ++seq, documentoId: 204, tarefaId: 104, canal: "EMAIL", destinatarioNome: null, orgaoNome: "Cartório de Roma", criadoPorId: 2, criadoEm: T(D0, 800) },
    { fonte: "SUBTAREFA", id: ++seq, stepInstanceId: 305, subtaskKey: "receber_certidao", completedAt: T(D0, 1000), executadoPorId: 1, resultado: null },
    { fonte: "SUBTAREFA", id: ++seq, stepInstanceId: 306, subtaskKey: "conferir_validar_certidao", completedAt: T(D0, 1200), executadoPorId: 1, resultado: null },
    { fonte: "PASSO", id: ++seq, stepInstanceId: 307, completedAt: T(D0, 1100), executadoPorId: 2 },
    log("PROCESS_PHASE_ROLLED_BACK", { entidade: "Processo", entidadeId: 1, usuarioId: 1, quando: T(D0, 1300), detalhes: { deFase: "emissao_documental", paraFase: "genealogia", justificativa: "faltou conferir um documento da equipe" } }),
    avanco,
  ], ctx(), { agrupar: "minuto" })
  const cli = linhasDoCliente(interno.fatos)
  const texto = cli.map((c) => c.frase).join("\n")
  ok("entram: pedido, recebida, validada, registro localizado e avanço de fase", cli.length === 5 && /solicitada/.test(texto) && /recebida/.test(texto) && /validada/.test(texto) && /avançou para a fase Emissão Documental/.test(texto), texto.replace(/\n/g, " | "))
  ok("'Registro localizado' ENTRA, com texto de cliente: só a certidão e a pessoa", cli.some((c) => c.frase === "Registro de nascimento de Pessoa 7 localizado"), cli.map((c) => c.frase).join(" | "))
  ok("'Retorno de fase' FICA FORA do PDF do cliente (e continua na janela interna)", !/voltou|retorn|Genealogia/i.test(texto) && interno.fatos.some((f) => f.subtipo === "retorno_fase") && linha(interno.fatos.find((f) => f.subtipo === "retorno_fase")!).texto.startsWith("Voltou para Genealogia"))
  ok("nada do registro localizado vaza nome da equipe nem motivo interno", !/Daniela|Brait|equipe|faltou conferir/i.test(texto))
  ok("ficam fora: prioridade, atribuição, cancelamento interno, prazo e os motivos", !/priorid|atribu|cancel|prazo|erro interno|pressionou|fôlego/i.test(texto))
  ok("nenhum nome da equipe (Marco, Daniela) nem cartório no texto", !/Marco|Daniela|Rovatti|Brait|Cartório de Roma/.test(texto))
  const cab = cabecalhoDoCliente({ familiaNome: "Salvarani", faseAtual: "Emissão Documental", geradoEm: AGORA })
  ok("cabeçalho: nome da família, fase atual e a data", cab.titulo === "Andamento do processo — família Salvarani" && cab.subtitulo === "Fase atual: Emissão Documental · posição em 05/10/2026", `${cab.titulo} | ${cab.subtitulo}`)
  ok("a lista do que entra e do que fica fora está declarada (e não se sobrepõe)", SUBTIPOS_NO_PDF_DO_CLIENTE.every((s) => !SUBTIPOS_FORA_DO_PDF_DO_CLIENTE.includes(s)) && ["prioridade", "atribuida", "cancelada", "prazo", "cobranca", "comentario", "retorno_fase"].every((s) => SUBTIPOS_FORA_DO_PDF_DO_CLIENTE.includes(s as never)))
  ok("a lista final: localizada entra, retorno_fase fica fora", SUBTIPOS_NO_PDF_DO_CLIENTE.includes("localizada") && !SUBTIPOS_NO_PDF_DO_CLIENTE.includes("retorno_fase") && SUBTIPOS_FORA_DO_PDF_DO_CLIENTE.includes("retorno_fase") && !SUBTIPOS_FORA_DO_PDF_DO_CLIENTE.includes("localizada"))
  console.log("   entram:", SUBTIPOS_NO_PDF_DO_CLIENTE.join(", "), "(+ etapa de apostila/tradução)")
  console.log("   ficam fora:", SUBTIPOS_FORA_DO_PDF_DO_CLIENTE.join(", "))

  secao("11) CÓDIGO INTERNO NUNCA NA TELA")
  ok("'por o Sistema · CAUSA_REMOVIDA' → 'pelo sistema · causa removida da árvore'", `${porQuem(null)} · ${motivoLegivel("CAUSA_REMOVIDA")}` === "pelo sistema · causa removida da árvore" && porQuem("o Sistema") === "pelo sistema" && porQuem("Marco Rovatti") === "por Marco Rovatti")
  ok("todo código do mapa vira texto sem MAIÚSCULAS_COM_SUBLINHADO", Object.entries(MOTIVO_EM_PORTUGUES).every(([k, v]) => !ehCodigoInterno(v) && !/_/.test(v) && v.length > 0 && k !== v))
  ok("os códigos que existem no banco de produção estão traduzidos", ["CAUSA_REMOVIDA", "SUBSTITUIDA_PELA_TORRE", "CORRECAO_DE_FASE", "OUTRO_AUTORIZADO", "ERRO_OPERACIONAL", "PROCESSO_JA_EM_ANDAMENTO", "RETORNO_PARA_REGULARIZACAO", "CORRECAO_CADASTRO", "AUDITORIA_INTEGRAL_FASES", "TESTE", "TEST_DELETE_SERVICE"].every((c) => c in MOTIVO_EM_PORTUGUES))
  ok("os códigos do código-fonte também (espera, bloqueio, reabertura, avanço forçado, cadastro removido)", ["AGUARDANDO_TERCEIRO", "ESPERA_EXTERNA", "BLOQUEIO", "REABERTURA", "AVANCO_FORCADO_PELA_TORRE", "CADASTRO_REMOVIDO", "NAO_EXIGIDA_PELA_ARVORE", "OPERACAO_ADMINISTRATIVA"].every((c) => c in MOTIVO_EM_PORTUGUES))
  ok("código sem tradução nunca aparece cru (vira o próprio nome, sem sublinhado) e é listado", motivoLegivel("MOTIVO_NOVO_QUALQUER") === "motivo novo qualquer" && apresentarCodigos("x · MOTIVO_NOVO_QUALQUER") === "x · motivo novo qualquer" && codigosSemTraducao("x · MOTIVO_NOVO_QUALQUER").join() === "MOTIVO_NOVO_QUALQUER")
  ok("texto de gente passa intacto (sigla e frase não são código)", motivoLegivel("Documento não necessário") === "Documento não necessário" && apresentarCodigos("CRC, PDF e SLA") === "CRC, PDF e SLA")
  ok("o texto do histórico passa pela tradução ('… · CAUSA_REMOVIDA' e 'estava NAO_INICIADA')", apresentarTextoDoHistorico("cancelada · CAUSA_REMOVIDA (estava NAO_INICIADA)", {}) === "cancelada · causa removida da árvore (estava a iniciar)")
  const cancSis = montarFatos([log("TAREFA_CANCELADA", { entidadeId: 100, usuarioId: null, quando: D0, detalhes: { tarefaId: 100, motivo: "CAUSA_REMOVIDA" } })], ctx(), { agrupar: "minuto" }).fatos[0]
  ok("cancelamento do sistema na linha do tempo: sem código, sem 'por o Sistema'", !/[A-Z]{3,}_[A-Z]/.test(`${linha(cancSis).texto} ${linha(cancSis).motivo}`) && /causa removida da árvore|exigência deixou de existir/.test(String(linha(cancSis).motivo)), `${linha(cancSis).quem} · ${linha(cancSis).texto} · ${linha(cancSis).motivo}`)
  const foco = readFileSync("lib/operacional/torre-foco.ts", "utf8"), enc = readFileSync("src/services/encerramento-documental.ts", "utf8")
  ok("a lista de certidões e o histórico usam a MESMA tabela (porQuem / motivoLegivel)", /porQuem\(enc\?\.porNome\)/.test(foco) && /motivoLegivel\(enc\.motivo\)/.test(foco) && /motivoLegivel\(composto\.motivo\)/.test(enc) && !/o Sistema/.test(foco))
  ok("a aba Tarefas não diz mais 'por Sistema'", !/por \$\{e\?\.porNome \?\? "Sistema"\}/.test(readFileSync("src/components/torre/TorreTarefas.tsx", "utf8")))

  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) console.log(falhas.join("\n"))
  process.exit(falhou ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
