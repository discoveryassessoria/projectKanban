// scripts/historico-processo-puro.test.ts
// ============================================================================
// HISTÓRICO DO PROCESSO — os módulos PUROS (Torre de Controle, seção 4 — 30/09/2026). Sem banco.
//
//   node scripts/ci/gate-build.mjs --so historico-processo-puro
//
// `lib/operacional/historico-processo.ts`  linhas cruas → FATOS redigidos (classificar · dedupe · agrupar · redigir)
// `lib/operacional/historico-filtros.ts`   filtros · dia (fuso America/Sao_Paulo) · contadores · rodapé · query
// `lib/operacional/historico-exportar.ts`  CSV seguro
// ============================================================================
import {
  montarFatos, lerMotivoComposto, JANELA_DE_GRUPO_MS, type ContextoDoHistorico, type LinhaCrua, type FatoDoHistorico,
} from "../lib/operacional/historico-processo"
import {
  montarVisao, filtrarFatos, FILTROS_PADRAO, FILTROS_LIMPOS, diaSP, horaSP, rotuloDoDia, rotuloDoMomento, filtrosDaQuery, queryDosFiltros, type FiltrosDoHistorico,
} from "../lib/operacional/historico-filtros"
import { csvDoHistorico, celulaSegura, linhasDaExportacao, nomeDoArquivo } from "../lib/operacional/historico-exportar"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)

// ─── contexto fixo: Marco (1), Daniela (2); Helena (10), Maria (11), Edison (12) ───
const FASES: Record<string, string> = { genealogia: "Genealogia", emissao_documental: "Emissão Documental", analise_documental: "Análise Documental" }
const tarefas: ContextoDoHistorico["tarefas"] = {}
const documentos: ContextoDoHistorico["documentos"] = {}
const passos: ContextoDoHistorico["passos"] = {}
const nomesCert = ["nascimento", "casamento", "óbito"]
// 9 obrigações: tarefa 100+i · documento 200+i · passo 300+i — 0-2 Helena, 3-5 Maria, 6-8 Edison
for (let i = 0; i < 9; i++) {
  const pessoaId = 10 + Math.floor(i / 3), nome = ["Helena Peres Nás", "Maria del Consuelo Perez Alvarez", "Edison Nás Antão"][Math.floor(i / 3)]
  tarefas[100 + i] = { titulo: `Certidão de ${nomesCert[i % 3]} - Inteiro Teor · ${nome}`, documentoId: 200 + i, necessidadeId: null, pessoaId, faseMacroKey: "emissao_documental", statusTarefa: "EM_ANDAMENTO", responsavelId: 2 }
  documentos[200 + i] = { rotulo: null, pessoaId, necessidadeId: null, status: "PENDENTE" }
  passos[300 + i] = { stepKey: "solicitar_certidao", titulo: "Solicitar certidão", faseMacroKey: "emissao_documental", documentoId: 200 + i, necessidadeId: null, pessoaId }
}
const ctx = (extra: Partial<ContextoDoHistorico> = {}): ContextoDoHistorico => ({
  processo: { id: 1, nome: "Antão", pais: "Espanha", requerentes: 4, familiaId: 9 },
  usuarios: { 1: "Marco Rovatti", 2: "Daniela Brait" },
  pessoas: { 10: "Helena Peres Nás", 11: "Maria del Consuelo Perez Alvarez", 12: "Edison Nás Antão" },
  tarefas: structuredClone(tarefas), documentos: structuredClone(documentos), necessidades: {}, passos: structuredClone(passos),
  rotuloDaFase: (k) => (k ? FASES[k] ?? null : null),
  ...extra,
})
const T = (iso: string, plusSeg = 0) => new Date(Date.parse(iso) + plusSeg * 1000).toISOString()
let seq = 0
const log = (acao: string, p: { entidade?: string; entidadeId?: number | null; usuarioId?: number | null; quando: string; detalhes?: Record<string, unknown>; descricao?: string }): LinhaCrua => ({ fonte: "LOG", id: ++seq, acao, entidade: p.entidade ?? "Tarefa", entidadeId: p.entidadeId ?? null, descricao: p.descricao ?? acao, detalhes: p.detalhes ?? null, criadoEm: p.quando, usuarioId: p.usuarioId ?? null })
const sub = (passo: number, key: string, quando: string, por: number | null): LinhaCrua => ({ fonte: "SUBTAREFA", id: ++seq, stepInstanceId: passo, subtaskKey: key, completedAt: quando, executadoPorId: por, resultado: null })
const frases = (fs: FatoDoHistorico[]) => fs.flatMap((f) => [f.frase, ...f.agrupadoDe.map((i) => i.frase)])

const D0 = "2026-09-30T15:15:09.000Z" // 12:15 em São Paulo

async function main() {
  // ════════════════════════════════════════════════════════════════════════
  secao("1) Motivo e Justificativa — o texto composto do modal de cancelamento")
  const m1 = lerMotivoComposto("Motivo: Documento não necessário · Justificativa: Documento não foi localizado e não trava o avanço · do processo")
  ok("separa Motivo e Justificativa (a justificativa pode conter ' · ')", m1.motivo === "Documento não necessário" && m1.justificativa === "Documento não foi localizado e não trava o avanço · do processo" && m1.estruturado)
  const m2 = lerMotivoComposto("Operação cancelada: Motivo: Cliente desistiu · Justificativa: Pediu por e-mail · Impacto: cobrança suspensa · SLA das etapas ativas: NÃO cancelado")
  ok("aceita o prefixo de Documento.motivoBloqueio e lê Impacto e SLA", m2.motivo === "Cliente desistiu" && m2.justificativa === "Pediu por e-mail" && m2.impacto === "cobrança suspensa" && m2.slaNaoCancelado)
  const m3 = lerMotivoComposto("substituída pela Torre de Controle")
  ok("texto simples (porta de tarefa) vira só o Motivo", m3.motivo === "substituída pela Torre de Controle" && m3.justificativa === null && !m3.estruturado)
  ok("vazio/nulo não inventa nada", lerMotivoComposto(null).motivo === null && lerMotivoComposto("  ").motivo === null)

  // ════════════════════════════════════════════════════════════════════════
  secao("2) Cancelamento — hora · quem · certidão e de quem · fase/passo · motivo · justificativa · efeito")
  {
    const c = ctx()
    c.tarefas[103].statusTarefa = "CANCELADA"
    const r = montarFatos([log("TAREFA_CANCELADA", { entidadeId: 103, usuarioId: 1, quando: D0, detalhes: { tarefaId: 103, documentoId: 203, stepInstanceId: 303, faseMacroKey: "emissao_documental", de: "NAO_INICIADA", responsavelId: 2, motivo: "Motivo: Documento não necessário · Justificativa: Documento não foi localizado e não trava o avanço do processo" } })], c)
    const f = r.fatos[0]
    ok("uma linha, um fato", r.fatos.length === 1 && f.tipo === "CERTIDAO" && f.subtipo === "cancelada" && !f.automatico)
    ok("frase completa", f.frase === "Marco Rovatti cancelou a Certidão de nascimento - Inteiro Teor · Maria del Consuelo Perez Alvarez (Emissão Documental · passo Solicitar certidão). Motivo: Documento não necessário. Justificativa: “Documento não foi localizado e não trava o avanço do processo”. Efeito: saiu de “A iniciar” (responsável: Daniela Brait) · continua na pasta como Cancelada", f.frase)
    ok("campos estruturados: certidão, pessoa, fase, passo, motivo, justificativa, efeito", f.certidao === "Certidão de nascimento - Inteiro Teor" && f.pessoa === "Maria del Consuelo Perez Alvarez" && f.fase === "Emissão Documental" && f.passo === "Solicitar certidão" && f.motivo === "Documento não necessário" && f.justificativa === "Documento não foi localizado e não trava o avanço do processo" && /continua na pasta como Cancelada/.test(f.efeito ?? ""))
    ok("links: tarefa, documento e pessoa", f.links.tarefaId === 103 && f.links.documentoId === 203 && f.links.pessoaId === 11)
    ok("'Reabrir certidão': tarefa ainda CANCELADA + cancelamento de uma pessoa ⇒ sim", f.reabrivel?.tarefaId === 103)
    const cb = ctx()
    ok("tarefa que já foi reaberta (não está CANCELADA) ⇒ sem Reabrir", montarFatos([log("TAREFA_CANCELADA", { entidadeId: 103, usuarioId: 1, quando: D0, detalhes: { tarefaId: 103 } })], cb).fatos[0].reabrivel === null)
    const cc = ctx(); cc.tarefas[103].statusTarefa = "CANCELADA"
    const dois = montarFatos([log("TAREFA_CANCELADA", { entidadeId: 103, usuarioId: 1, quando: T(D0, -86400), detalhes: { tarefaId: 103, motivo: "primeiro" } }), log("TAREFA_CANCELADA", { entidadeId: 103, usuarioId: 1, quando: D0, detalhes: { tarefaId: 103, motivo: "segundo" } })], cc)
    ok("dois cancelamentos da mesma tarefa: só o ÚLTIMO oferece Reabrir", dois.fatos.filter((x) => x.reabrivel).length === 1 && dois.fatos.find((x) => x.reabrivel)?.motivo === "segundo")
    const auto = montarFatos([log("TAREFA_CANCELADA", { entidadeId: 103, usuarioId: null, quando: D0, detalhes: { motivo: "CAUSA_REMOVIDA", origem: "RECONCILIADOR" } })], cc).fatos[0]
    ok("cancelamento do SISTEMA (causa removida): automático, frase legível, sem Reabrir", auto.automatico && auto.reabrivel === null && /^Sistema retirou do trabalho a Certidão de nascimento/.test(auto.frase) && !/CAUSA_REMOVIDA/.test(auto.frase), auto.frase)
    const adm = montarFatos([log("TAREFA_CANCELADA", { entidadeId: 103, usuarioId: 1, quando: D0, detalhes: { tarefaId: 103, motivo: "substituída pela Torre de Controle", codigo: "SUBSTITUIDA_PELA_TORRE" } })], (() => { const x = ctx(); x.tarefas[103] = { titulo: "Atribuir tarefas — Salvarani", documentoId: null, necessidadeId: null, pessoaId: null, faseMacroKey: null, statusTarefa: "CANCELADA", responsavelId: null }; return x })()).fatos[0]
    ok("tarefa administrativa (sem certidão) não finge ser certidão", adm.tipo === "TAREFA" && /cancelou a tarefa “Atribuir tarefas — Salvarani”/.test(adm.frase), adm.frase)
  }

  // ════════════════════════════════════════════════════════════════════════
  secao("3) Atribuição em LOTE agrupada")
  {
    const c = ctx()
    const at = (i: number, por: number, para: number, seg: number) => log("TAREFA_ATRIBUIDA", { entidadeId: 100 + i, usuarioId: por, quando: T("2026-09-29T18:22:00.000Z", seg), detalhes: { tarefaId: 100 + i, de: null, para, motivo: "atribuição em lote pela Torre para Daniela Brait" } })
    const lote = Array.from({ length: 9 }, (_, i) => at(i, 1, 2, i * 2))
    const r = montarFatos(lote, c)
    ok("9 atribuições seguidas pela mesma pessoa ao mesmo destino ⇒ UM cartão", r.fatos.length === 1 && r.fatos[0].quantidade === 9)
    ok("'Marco Rovatti atribuiu 9 certidões a Daniela Brait (Emissão Documental · lote)'", /^Marco Rovatti atribuiu 9 certidões a Daniela Brait \(Emissão Documental · lote\)/.test(r.fatos[0].frase), r.fatos[0].frase)
    ok("'Ver as 9': cada item com a sua certidão e link", r.fatos[0].agrupadoDe.length === 9 && r.fatos[0].agrupadoDe.every((i) => i.links.tarefaId != null && /Certidão de/.test(i.frase)))
    ok("o motivo comum sobe ao cartão", r.fatos[0].motivo === "atribuição em lote pela Torre para Daniela Brait")
    const misto = montarFatos([at(0, 1, 2, 0), at(1, 1, 1, 1), at(2, 2, 2, 2)], c)
    ok("destino ou autor diferente ⇒ cartões separados", misto.fatos.length === 3)
    const espaco = montarFatos([at(0, 1, 2, 0), at(1, 1, 2, JANELA_DE_GRUPO_MS / 1000 + 60)], c)
    ok(`intervalo maior que ${JANELA_DE_GRUPO_MS / 60000} min quebra a sequência`, espaco.fatos.length === 2)
    ok("atribuição única mantém a frase completa", /^Daniela Brait atribuiu a Certidão de nascimento - Inteiro Teor · Helena Peres Nás a Daniela Brait/.test(montarFatos([at(0, 2, 2, 0)], c).fatos[0].frase))
    ok("TAREFAS_REDISTRIBUIDAS (resumo do lote) é mecânica: não duplica o lote", montarFatos([...lote, log("TAREFAS_REDISTRIBUIDAS", { entidadeId: 0, usuarioId: 1, quando: T("2026-09-29T18:22:00.000Z", 30) })], c).fatos.length === 1)
  }

  // ════════════════════════════════════════════════════════════════════════
  secao("4) Validações em sequência pela mesma pessoa e pessoa agrupam")
  {
    const c = ctx()
    const r = montarFatos([0, 1, 2].map((i) => sub(300 + i, "conferir_validar_certidao", T("2026-09-29T20:45:00.000Z", i * 40), 2)), c)
    ok("3 validações de Helena por Daniela ⇒ 'Daniela Brait validou 3 certidões de Helena Peres Nás (Nascimento, Casamento, Óbito · Emissão Documental)'", r.fatos.length === 1 && r.fatos[0].frase === "Daniela Brait validou 3 certidões de Helena Peres Nás (Nascimento, Casamento, Óbito · Emissão Documental)", r.fatos[0]?.frase)
    const duas = montarFatos([sub(300, "conferir_validar_certidao", T(D0), 2), sub(303, "conferir_validar_certidao", T(D0, 5), 2)], c)
    ok("pessoas diferentes ⇒ dois cartões", duas.fatos.length === 2)
    const outros = montarFatos([sub(300, "conferir_validar_certidao", T(D0), 2), sub(301, "conferir_validar_certidao", T(D0, 5), 1)], c)
    ok("quem valida diferente ⇒ dois cartões", outros.fatos.length === 2)
    const unica = montarFatos([sub(300, "conferir_validar_certidao", T(D0), 2)], c).fatos[0]
    ok("validação única: 'Daniela Brait validou a Certidão … (Emissão Documental)'", /^Daniela Brait validou a Certidão de nascimento - Inteiro Teor · Helena Peres Nás \(Emissão Documental\)$/.test(unica.frase), unica.frase)
    const rec = montarFatos([sub(300, "receber_certidao", T(D0), 2), sub(301, "receber_certidao", T(D0, 3), 2)], c)
    ok("recebimentos também agrupam ('recebeu 2 certidões de Helena')", rec.fatos.length === 1 && /^Daniela Brait recebeu 2 certidões de Helena Peres Nás/.test(rec.fatos[0].frase))
  }

  // ════════════════════════════════════════════════════════════════════════
  secao("5) Eventos técnicos viram linha legível (automática) ou somem — nunca crus")
  {
    const c = ctx()
    const tecnicos: LinhaCrua[] = [
      log("registral_linhagem_recalculada", { entidade: "Processo", entidadeId: 1, quando: T(D0, 0), descricao: "Linhagem recalculada: LINHA_COMPLETA_COMPROVADA · 5 inconsistência(s) · motivo=documento_alterado" }),
      log("registral_linhagem_recalculada", { entidade: "Processo", entidadeId: 1, quando: T(D0, 1), descricao: "Linhagem recalculada: LINHA_COMPLETA_COMPROVADA · 5 inconsistência(s) · motivo=documento_alterado" }),
      log("registral_reconciliacao_documental", { entidade: "Processo", entidadeId: 1, quando: T(D0, 2), detalhes: { necessidadesAvaliadas: 21, necessidadesAtendidas: 0 } }),
      log("FASE_MATERIALIZADA", { entidade: "PROCESSO", entidadeId: 1, quando: T(D0, 3), detalhes: { estado: "MATERIALIZADO", escopo: "NECESSIDADE", faseMacroKey: "genealogia", passosTotais: 13, ciclo: 1 } }),
      log("TAREFA_REANCORADA", { entidadeId: 100, quando: T(D0, 4), detalhes: { tarefaId: 100 } }),
      log("PASSO_DUPLICADO_SUPERSEDIDO", { entidade: "PhaseWorkflowStepInstance", entidadeId: 300, quando: T(D0, 5) }),
      log("ALGUMA_ACAO_QUE_NINGUEM_CADASTROU", { entidadeId: 100, quando: T(D0, 6) }),
      { fonte: "WORKFLOW", id: ++seq, tipo: "PASSO_INSTANCIADO", entityType: "step_instance", entityId: null, tarefaId: null, stepInstanceId: 300, dados: null, criadoEm: T(D0, 7) },
    ]
    const r = montarFatos(tecnicos, c)
    const fs = frases(r.fatos)
    ok("linhagem recalculada ⇒ UMA linha legível, automática, agrupada ('2 vezes')", fs.includes("Sistema recalculou a linhagem da árvore 2 vezes") && r.fatos.find((f) => f.subtipo === "linhagem")?.automatico === true)
    ok("reconciliação documental ⇒ frase legível com os números", fs.includes("Sistema conferiu 21 exigências documentais com os registros da árvore (0 atendidas)"))
    ok("'Materialização (ciclo 1) — MATERIALIZADO' ⇒ 'Sistema preparou a fase Genealogia com 13 certidões (a partir da árvore)'", fs.includes("Sistema preparou a fase Genealogia com 13 certidões (a partir da árvore)"))
    ok("nenhum texto cru: registral_*, MATERIALIZADO, CODIGO_EM_CAIXA_ALTA", !fs.some((t) => /registral_|MATERIALIZADO|\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b/.test(t)), fs.join(" | "))
    ok("mecânica interna (REANCORADA, PASSO_*) é DESCARTADA e contada", r.descartados["Tarefa:TAREFA_REANCORADA"] === 1 && r.descartados["PhaseWorkflowStepInstance:PASSO_DUPLICADO_SUPERSEDIDO"] === 1 && r.descartados["WorkflowEvento:PASSO_INSTANCIADO"] === 1)
    ok("código desconhecido NÃO vaza: fica em 'naoClassificados' (para diagnóstico), fora dos fatos", r.naoClassificados["Tarefa:ALGUMA_ACAO_QUE_NINGUEM_CADASTROU"] === 1 && !fs.some((t) => /ALGUMA_ACAO/.test(t)))
    ok("todos os fatos técnicos são 'automáticos'", r.fatos.every((f) => f.automatico))
  }

  // ════════════════════════════════════════════════════════════════════════
  secao("6) Um fato, um registro — dedupe (nada de 'Tarefa concluída' + 'Passo concluído')")
  {
    const c = ctx()
    const fim = T("2026-09-29T20:45:00.000Z")
    const linhas: LinhaCrua[] = [
      sub(300, "conferir_validar_certidao", fim, 2),
      { fonte: "PASSO", id: ++seq, stepInstanceId: 300, completedAt: T(fim, 0.5), executadoPorId: 2 },
      { fonte: "WORKFLOW", id: ++seq, tipo: "PASSO_CONCLUIDO", entityType: "step_instance", entityId: null, tarefaId: null, stepInstanceId: 300, dados: null, criadoEm: T(fim, 0.6) },
      { fonte: "WORKFLOW", id: ++seq, tipo: "TAREFA_CONCLUIDA", entityType: "tarefa", entityId: 100, tarefaId: 100, stepInstanceId: null, dados: { para: "CONCLUIDO_RECEBIDO" }, criadoEm: T(fim, 0.7) },
      log("TAREFA_CONCLUIDA", { entidadeId: 100, usuarioId: 2, quando: T(fim, 1), detalhes: { tarefaId: 100 } }),
    ]
    const r = montarFatos(linhas, c)
    ok("tarefa concluída + passo concluído + execução do passo + validação ⇒ UM fato (a validação, com quem fez)", r.fatos.length === 1 && r.fatos[0].subtipo === "validada" && r.fatos[0].quem.nome === "Daniela Brait", r.fatos.map((f) => f.frase).join(" | "))
    ok("nenhuma frase diz 'Tarefa concluída' nem 'Passo concluído'", !frases(r.fatos).some((t) => /Tarefa conclu|Passo conclu|Etapa conclu/i.test(t)))
    const so = montarFatos([{ fonte: "PASSO", id: ++seq, stepInstanceId: 301, completedAt: fim, executadoPorId: 2 }, { fonte: "WORKFLOW", id: ++seq, tipo: "PASSO_CONCLUIDO", entityType: "step_instance", entityId: null, tarefaId: null, stepInstanceId: 301, dados: null, criadoEm: fim }], ctx())
    ok("passo SEM subtarefas concluído por uma pessoa ⇒ UM fato 'concluiu a etapa …'", so.fatos.length === 1 && /^Daniela Brait concluiu a etapa Solicitar certidão/.test(so.fatos[0].frase), so.fatos[0]?.frase)
    const reab = montarFatos([
      log("STEP_EXECUTION_REOPENED", { entidade: "PhaseWorkflowStepInstance", entidadeId: 300, usuarioId: 1, quando: D0, detalhes: { justificativa: "teste de fase", identidade: { documentoId: 200, pessoaNome: "Helena Peres Nás", stepTitulo: "Solicitar certidão", faseMacroKey: "emissao_documental" } } }),
      log("SUBTAREFA_REABERTA", { entidade: "SubtaskExecution", entidadeId: 418, usuarioId: 1, quando: T(D0, 0.3), detalhes: { subtaskKey: "conferir_validar_certidao", stepInstanceId: 300, passoReaberto: true } }),
    ], ctx())
    ok("reabrir etapa + reabrir subtarefa (mesma pessoa, mesma etapa, segundos) ⇒ UM fato 'reabriu', com o motivo", reab.fatos.length === 1 && reab.fatos[0].subtipo === "reaberta" && reab.fatos[0].motivo === "teste de fase", reab.fatos[0]?.frase)
    const necs = ctx({ necessidades: { 50: { rotulo: "Certidão de casamento - Inteiro Teor · Maria del Consuelo Perez Alvarez", pessoaId: 11 } } })
    necs.tarefas[103] = { ...necs.tarefas[103], necessidadeId: 50, statusTarefa: "CANCELADA" }
    const comNec = montarFatos([
      log("TAREFA_CANCELADA", { entidadeId: 103, usuarioId: 1, quando: D0, detalhes: { tarefaId: 103, motivo: "Motivo: Documento não necessário" } }),
      { fonte: "NECESSIDADE", id: ++seq, necessidadeId: 50, tipo: "DISPENSADA", descricao: null, dados: { motivo: "Motivo: Documento não necessário" }, criadoEm: T(D0, -0.2) },
    ], necs)
    ok("o evento da necessidade (DISPENSADA) que acompanha o cancelamento é ABSORVIDO por ele", comNec.fatos.length === 1 && comNec.fatos[0].subtipo === "cancelada")
    const solo = montarFatos([{ fonte: "NECESSIDADE", id: ++seq, necessidadeId: 50, tipo: "DISPENSADA", descricao: null, dados: { motivo: "necessidade removida pela árvore: pessoa deixou de ser casada" }, criadoEm: D0 }], necs)
    ok("sem outro fato por perto, a dispensa aparece sozinha (automática) e legível", solo.fatos.length === 1 && solo.fatos[0].automatico && /^Sistema dispensou a exigência de Certidão de casamento/.test(solo.fatos[0].frase), solo.fatos[0]?.frase)
    const aberturas = montarFatos([log("criou", { entidade: "PROCESSO", entidadeId: 1, usuarioId: 1, quando: D0 }), log("PROCESSO_INICIALIZADO_V2", { entidade: "PROCESSO", entidadeId: 1, usuarioId: 1, quando: T(D0, 1), detalhes: { primeiraFase: "genealogia" } })], ctx())
    ok("abertura: 'criou' e 'PROCESSO_INICIALIZADO_V2' descrevem o mesmo ato ⇒ UM fato, com país · requerentes · fase inicial", aberturas.fatos.length === 1 && aberturas.fatos[0].frase === "Marco Rovatti abriu o processo Antão (Espanha · 4 requerentes · fase inicial Genealogia)", aberturas.fatos[0]?.frase)
    ok("o marco 'abriu o processo' nunca é 'automático', mesmo feito pelo Sistema", montarFatos([log("PROCESSO_INICIALIZADO_V2", { entidade: "PROCESSO", entidadeId: 1, usuarioId: null, quando: D0 })], ctx()).fatos[0].automatico === false)
    const fase = montarFatos([
      { fonte: "FASE", id: ++seq, faseAtual: "genealogia", fasePretendida: "emissao_documental", resultado: "AVANCADO", origem: "reconciliacao-manual", solicitadoPorId: null, forcado: false, justificativa: null, criadoEm: T(D0, 0.1) },
      { fonte: "WORKFLOW", id: ++seq, tipo: "FASE_AVANCADA", entityType: "fase", entityId: 1, tarefaId: null, stepInstanceId: null, dados: { de: "genealogia", para: "emissao_documental" }, criadoEm: D0 },
      { fonte: "FASE", id: ++seq, faseAtual: "emissao_documental", fasePretendida: "analise_documental", resultado: "BLOQUEADO", origem: "advance", solicitadoPorId: null, forcado: false, justificativa: null, criadoEm: T(D0, 100) },
    ], ctx())
    ok("avanço de fase: PhaseAdvanceLog + WorkflowEvento = UM fato; tentativa BLOQUEADA não é fato", fase.fatos.length === 1 && fase.fatos[0].frase === "Sistema avançou o processo de Genealogia para Emissão Documental" && fase.fatos[0].automatico === false, fase.fatos.map((f) => f.frase).join(" | "))
  }

  // ════════════════════════════════════════════════════════════════════════
  secao("7) Cobrança, prazo, bloqueio, comentário — frases completas")
  {
    const c = ctx()
    const r = montarFatos([
      { fonte: "CONTATO", id: ++seq, tarefaId: 100, documentoId: 200, orgaoNome: "Santos - 1º Subdistrito", canal: "TELEFONE", resultado: "EM_BUSCA", observacao: "pediu para ligar amanhã", registradoPorId: 2, criadoEm: T(D0, 0) },
      log("TAREFA_PRAZO_ALTERADO", { entidadeId: 101, usuarioId: 1, quando: T(D0, 100), detalhes: { de: "2026-10-20T12:00:00.000Z", para: "2026-10-08T15:00:00.000Z", motivo: "cartório prometeu antes" } }),
      log("TAREFA_BLOQUEADA", { entidadeId: 102, usuarioId: 2, quando: T(D0, 200), detalhes: { motivo: "falta a certidão de casamento dos pais" } }),
      { fonte: "COMENTARIO", id: ++seq, tarefaId: 100, familiaId: null, autorId: 1, texto: "Ligar para @[Daniela Brait](2) amanhã cedo.", criadoEm: T(D0, 300) },
      { fonte: "SOLICITACAO", id: ++seq, documentoId: 200, tarefaId: 100, canal: "CRC", destinatarioNome: null, orgaoNome: "Santos - 1º Subdistrito", criadoPorId: 2, criadoEm: T(D0, -500) },
    ], c)
    const por = (s: string) => r.fatos.find((f) => f.subtipo === s)!
    ok("cobrança: 'Daniela Brait ligou para o cartório Santos … sobre a Certidão … — telefone, em busca'", /^Daniela Brait ligou para o cartório Santos - 1º Subdistrito sobre a Certidão de nascimento - Inteiro Teor · Helena Peres Nás — telefone, em busca/.test(por("cobranca").frase) && por("cobranca").justificativa === "pediu para ligar amanhã", por("cobranca").frase)
    ok("repactuação: 'repactuou o prazo da Certidão … para 08/10/2026 (era 20/10/2026). Motivo: …'", /^Marco Rovatti repactuou o prazo da Certidão de casamento - Inteiro Teor · Helena Peres Nás para 08\/10\/2026 \(era 20\/10\/2026\) \(Emissão Documental\)\. Motivo: cartório prometeu antes$/.test(por("prazo").frase), por("prazo").frase)
    ok("bloqueio com motivo", /^Daniela Brait bloqueou a Certidão de óbito - Inteiro Teor · Helena Peres Nás \(Emissão Documental\)\. Motivo: falta a certidão de casamento dos pais$/.test(por("bloqueada").frase), por("bloqueada").frase)
    ok("comentário: a menção vira @nome, sem o id", /comentou na Certidão de nascimento - Inteiro Teor · Helena Peres Nás “Ligar para @Daniela Brait amanhã cedo\.”/.test(por("comentario").frase), por("comentario").frase)
    ok("pedido: 'solicitou a Certidão … a Santos por CRC'", /^Daniela Brait solicitou a Certidão de nascimento - Inteiro Teor · Helena Peres Nás a Santos - 1º Subdistrito por CRC/.test(por("solicitada").frase))
    ok("esperar o cartório nunca diz que o prazo pausou", !frases(montarFatos([{ fonte: "WORKFLOW", id: ++seq, tipo: "TAREFA_BLOQUEADA", entityType: "tarefa", entityId: 100, tarefaId: 100, stepInstanceId: null, dados: { motivoCodigo: "AGUARDANDO_TERCEIRO", justificativa: "aguardando o terceiro" }, criadoEm: D0 }], c).fatos).some((t) => /paus/i.test(t)))
  }

  // ════════════════════════════════════════════════════════════════════════
  secao("8) Dia (Hoje/Ontem), fuso America/Sao_Paulo e hora — sem diferença de hidratação")
  const AGORA = new Date("2026-09-30T18:00:00.000Z") // quarta, 15:00 em SP
  ok("hoje: 'Hoje · quarta-feira, 30 de setembro'", rotuloDoDia("2026-09-30", AGORA) === "Hoje · quarta-feira, 30 de setembro")
  ok("ontem: 'Ontem · terça-feira, 29 de setembro'", rotuloDoDia("2026-09-29", AGORA) === "Ontem · terça-feira, 29 de setembro")
  ok("outro dia do ano: sem 'Hoje/Ontem'; outro ano: com o ano", rotuloDoDia("2026-09-14", AGORA) === "segunda-feira, 14 de setembro" && rotuloDoDia("2025-12-25", AGORA) === "quinta-feira, 25 de dezembro de 2025")
  ok("01/10 às 02:30 UTC ainda é 30/09 às 23:30 em São Paulo", diaSP("2026-10-01T02:30:00.000Z") === "2026-09-30" && horaSP("2026-10-01T02:30:00.000Z") === "23:30")
  ok("30/09 às 02:59 UTC é 29/09 às 23:59 em São Paulo", diaSP("2026-09-30T02:59:00.000Z") === "2026-09-29" && horaSP("2026-09-30T02:59:00.000Z") === "23:59")
  ok("12:15 em São Paulo = 15:15 UTC", horaSP("2026-09-30T15:15:09.000Z") === "12:15")
  ok("'hoje, 12:15' · 'ontem, 18:00' · '14/09, 09:00'", rotuloDoMomento("2026-09-30T15:15:00.000Z", AGORA) === "hoje, 12:15" && rotuloDoMomento("2026-09-29T21:00:00.000Z", AGORA) === "ontem, 18:00" && rotuloDoMomento("2026-09-14T12:00:00.000Z", AGORA) === "14/09, 09:00")

  // ════════════════════════════════════════════════════════════════════════
  secao("9) Filtros, dias, contadores e rodapé — sobre um histórico fixo")
  const c9 = ctx()
  c9.tarefas[103].statusTarefa = "CANCELADA"
  const linhas9: LinhaCrua[] = [
    log("PROCESSO_INICIALIZADO_V2", { entidade: "PROCESSO", entidadeId: 1, usuarioId: 1, quando: "2026-09-20T17:00:00.000Z" }),                                        // 20/09 (fora dos 7 dias)
    log("registral_linhagem_recalculada", { entidade: "Processo", entidadeId: 1, quando: "2026-09-29T19:00:00.000Z", descricao: "Linhagem recalculada: LINHA_COMPLETA_COMPROVADA" }), // 29/09 automático
    ...[0, 1, 2].map((i) => sub(300 + i, "conferir_validar_certidao", T("2026-09-29T20:45:00.000Z", i * 30), 2)),                                                    // 29/09 validou 3
    ...Array.from({ length: 4 }, (_, i) => log("TAREFA_ATRIBUIDA", { entidadeId: 106 + (i % 3), usuarioId: 1, quando: T("2026-09-29T18:22:00.000Z", i), detalhes: { para: 2, de: null } })), // 29/09 lote
    log("TAREFA_CANCELADA", { entidadeId: 103, usuarioId: 1, quando: "2026-09-30T15:15:09.000Z", detalhes: { tarefaId: 103, motivo: "Motivo: Documento não necessário · Justificativa: Não trava" } }), // 30/09 12:15
    { fonte: "COMENTARIO", id: ++seq, tarefaId: 104, familiaId: null, autorId: 2, texto: "Conferi o óbito com o cartório", criadoEm: "2026-09-30T17:00:00.000Z" }, // 30/09
  ]
  const fatos9 = montarFatos(linhas9, c9).fatos
  ok("(pré) 6 cartões: abertura, linhagem(auto), validação×3, lote×4, cancelamento, comentário", fatos9.length === 6, fatos9.map((f) => `${f.subtipo}×${f.quantidade}`).join(","))
  const v0 = montarVisao(fatos9, FILTROS_PADRAO, AGORA)
  ok("padrão (7 dias, sem automáticos): 'Mostrando 4 de 6' — a abertura de 20/09 sai pelo período; a linhagem sai por ser automática", v0.mostrando === 4 && v0.total === 6, `${v0.mostrando}/${v0.total}`)
  ok("o contador 'N automáticos ocultos' diz 1", v0.automaticosOcultos === 1)
  ok("agrupado por dia, o mais recente primeiro: Hoje (2) · Ontem (2 + 1 oculto)", v0.dias.length === 2 && v0.dias[0].rotulo === "Hoje · quarta-feira, 30 de setembro" && v0.dias[0].fatos.length === 2 && v0.dias[1].rotulo === "Ontem · terça-feira, 29 de setembro" && v0.dias[1].fatos.length === 2 && v0.dias[1].ocultosAutomaticos === 1 && /recálculo da linhagem/.test(v0.dias[1].ocultosDescricao), JSON.stringify(v0.dias.map((d) => [d.rotulo, d.fatos.length, d.ocultosAutomaticos, d.ocultosDescricao])))
  ok("dentro do dia, do mais novo para o mais antigo (12:15 depois das 14:00)", v0.dias[0].fatos[0].subtipo === "comentario" && v0.dias[0].fatos[1].subtipo === "cancelada")
  ok("chips do padrão: 'Últimos 7 dias' e 'Ocultar automáticos'", JSON.stringify(v0.chips.map((c) => c.rotulo)) === JSON.stringify(["Últimos 7 dias", "Ocultar automáticos"]))
  const v1 = montarVisao(fatos9, FILTROS_LIMPOS, AGORA)
  ok("'Limpar filtros': Mostrando 6 de 6, nenhum chip, nenhum oculto", v1.mostrando === 6 && v1.chips.length === 0 && v1.automaticosOcultos === 0)
  const com = (p: Partial<FiltrosDoHistorico>) => montarVisao(fatos9, { ...FILTROS_LIMPOS, ...p }, AGORA)
  ok("período 'Hoje'", com({ periodo: "hoje" }).mostrando === 2)
  ok("período 'Todo o período' traz a abertura de 20/09", com({ periodo: "todo" }).visiveis.some((f) => f.subtipo === "abertura"))
  ok("período 'Intervalo' 29/09–29/09 (linhagem, validação e lote)", com({ periodo: "intervalo", de: "2026-09-29", ate: "2026-09-29" }).mostrando === 3)
  ok("'Quem = Daniela' (só o que ela fez)", com({ quem: "u:2" }).visiveis.every((f) => f.quem.nome === "Daniela Brait") && com({ quem: "u:2" }).mostrando === 2)
  ok("'Quem = Sistema'", com({ quem: "sistema" }).mostrando === 1)
  ok("'Tipo = Atribuição'", com({ tipo: "ATRIBUICAO" }).mostrando === 1)
  ok("'Pessoa = Helena' pega a validação agrupada (3 de Helena) — e a cancelada? (Maria) não", com({ pessoaId: 10 }).visiveis.some((f) => f.subtipo === "validada") && !com({ pessoaId: 10 }).visiveis.some((f) => f.subtipo === "cancelada"))
  ok("busca livre ignora acento e caixa: 'obito' acha o comentário; 'nao trava' acha o cancelamento", com({ busca: "obito" }).visiveis.some((f) => f.subtipo === "comentario") && com({ busca: "NAO TRAVA" }).visiveis.some((f) => f.subtipo === "cancelada"))
  ok("a busca alcança o conteúdo de 'Ver as N' (certidão dentro do grupo)", com({ busca: "Edison" }).visiveis.some((f) => f.subtipo === "atribuida"))
  const faceta = montarVisao(fatos9, { ...FILTROS_LIMPOS, tipo: "CERTIDAO" }, AGORA)
  ok("contadores dos seletores são FACETADOS: 'Quem' conta aplicando o tipo escolhido", faceta.opcoes.quem.find((o) => o.valor === "todos")!.n === faceta.visiveis.length && faceta.opcoes.quem.find((o) => o.valor === "u:2")!.n === 1)
  ok("a opção 'Tipo' mostra quantos cartões cada tipo traria (Certidão 2, Atribuição 1…)", v1.opcoes.tipo.find((o) => o.valor === "CERTIDAO")!.n === 2 && v1.opcoes.tipo.find((o) => o.valor === "ATRIBUICAO")!.n === 1)
  ok("Rodapé: fatos no período, pessoas que atuaram, cancelamentos, certidões validadas, último fato", v1.rodape.fatosNoPeriodo === 6 && v1.rodape.pessoasQueAtuaram.join() === "Daniela Brait,Marco Rovatti" && v1.rodape.cancelamentos === 1 && v1.rodape.certidoesValidadas === 3 && v1.rodape.ultimoFato === "hoje, 14:00", JSON.stringify(v1.rodape))
  ok("Rodapé conta os automáticos mesmo ocultos (fatos no período = 5 nos 7 dias)", v0.rodape.fatosNoPeriodo === 5)
  ok("a regra de 'Mostrando N de M' é a MESMA do filtro (N = visíveis)", filtrarFatos(fatos9, FILTROS_PADRAO, AGORA).length === v0.mostrando)
  const q = queryDosFiltros({ ...FILTROS_PADRAO, quem: "u:2", tipo: "CARTORIO", pessoaId: 10, busca: " cartório " })
  const volta = filtrosDaQuery(q)
  ok("os filtros viajam por query string (tela → CSV) sem perder nada", volta.quem === "u:2" && volta.tipo === "CARTORIO" && volta.pessoaId === 10 && volta.busca === "cartório" && volta.ocultarAutomaticos && volta.periodo === "7d")
  const lixo = filtrosDaQuery(new URLSearchParams("quem=1;DROP&tipo=XYZ&pessoaId=abc&periodo=ontem&de=31-12-2026"))
  ok("query malformada cai no padrão seguro (sem injeção)", lixo.quem === "todos" && lixo.tipo === "todos" && lixo.pessoaId === "todas" && lixo.periodo === "todo" && lixo.de === null)

  // ════════════════════════════════════════════════════════════════════════
  secao("10) CSV seguro — o recorte, sem fórmula")
  const maliciosos = fatos9.map((f, i) => i === 0 ? { ...f, justificativa: "=HYPERLINK(\"http://x\",\"y\")", motivo: "+cmd|'/C calc'!A0", efeito: "@SUM(1+1)\nquebra", frase: "-2+3 fórmula" } : f)
  const csv = csvDoHistorico(maliciosos)
  ok("BOM + cabeçalho + uma linha por cartão", csv.startsWith("﻿\"Quando\";\"Quem\";\"Tipo\";\"Fato\"") && csv.split("\r\n").filter(Boolean).length === fatos9.length + 1)
  ok("células que começam com = + - @ são neutralizadas com apóstrofo", csv.includes(`"'=HYPERLINK(`) && csv.includes(`"'+cmd`) && csv.includes(`"'@SUM(1+1) quebra"`) && csv.includes(`"'-2+3 fórmula"`) && !/;"[=+@]/.test(csv) && !/^"[=+@]/m.test(csv))
  ok("aspas duplicadas e quebras de linha viram célula válida", celulaSegura('diz "olá"\nlinha 2') === '"diz ""olá"" linha 2"')
  ok("hora do CSV em São Paulo (30/09/2026 12:15)", linhasDaExportacao(fatos9.filter((f) => f.subtipo === "cancelada"))[0][0] === "30/09/2026 12:15")
  ok("o grupo vai com 'Itens' (as certidões dentro) e Qtd", linhasDaExportacao(fatos9.filter((f) => f.subtipo === "validada"))[0][12] === "3" && linhasDaExportacao(fatos9.filter((f) => f.subtipo === "validada"))[0][13].split(" | ").length === 3)
  ok("nome do arquivo sem acento/espaço", nomeDoArquivo("Antão da Silva", "csv", new Date("2026-09-30T12:00:00Z")) === "historico-antao-da-silva-2026-09-30.csv")

  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) })
