// scripts/estrutura-operacional.test.ts
//
// TRAVA a arquitetura da ESTRUTURA OPERACIONAL da Central:
//
//   PESSOA → DOCUMENTO/CERTIDÃO → WORKFLOW DAQUELE DOCUMENTO → PASSOS
//
// (A) COMPORTAMENTO — núcleo puro (estrutura-operacional-core): agrupamento por ID
//     oficial, progresso por documento/pessoa, sequência independente por documento,
//     ninguém descartado, nada duplicado.
//
// (B) BLINDAGEM ESTÁTICA — a regressão corrigida aqui não pode voltar: nenhuma lista
//     global de tarefas agrupada por passo, nenhum reagrupamento no frontend, nenhum
//     alvo derivado de texto, Operação Antecipada ancorada no alvo e permissão/
//     pertencimento validados no servidor.
//
// Falha ⇒ quebra o build/CI.

import { readFileSync } from "fs"
import { join } from "path"
import {
  montarEstruturaOperacional,
  montarIndiceOperacional,
  chaveDoAlvo,
  escopoDoAlvo,
  type AlvoBruto,
  type PassoBruto,
} from "../src/lib/process-stage/estrutura-operacional-core"
import { montarPessoasDoProcesso, type PessoaBruta, type UniaoBruta } from "../src/lib/process-stage/central-operacional-core"

const ROOT = join(__dirname, "..")
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8")

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

// ============================================================
// CENÁRIO OFICIAL DE INTEGRAÇÃO (o do enunciado)
// ------------------------------------------------------------
//   Marco  (requerente) → certidão de nascimento
//   João   (pai)        → certidão de nascimento
//   Tereza (mãe)        → certidão de nascimento + certidão de casamento
//   Ana    (avó)        → nenhum documento aplicável
// 3 pessoas com trabalho · 4 documentos · 5 passos por documento · 20 instâncias.
// ============================================================

const MARCO: PessoaBruta = { id: 1, nome: "Marco", sobrenome: "Rovatti", sexo: "M", publicCode: "USR-1", requerente: "maior", linhaReta: true, numeroLinhagem: null, paiId: 2, maeId: 3 }
const JOAO: PessoaBruta = { id: 2, nome: "João", sobrenome: "Silva", sexo: "M", publicCode: null, requerente: "nao", linhaReta: true, numeroLinhagem: null, paiId: 4, maeId: null }
const TEREZA: PessoaBruta = { id: 3, nome: "Tereza", sobrenome: "Silva", sexo: "F", publicCode: null, requerente: "nao", linhaReta: false, numeroLinhagem: null, paiId: null, maeId: null }
const ANA: PessoaBruta = { id: 4, nome: "Ana", sobrenome: "Silva", sexo: "F", publicCode: null, requerente: "nao", linhaReta: true, numeroLinhagem: null, paiId: null, maeId: null }
const UNIAO: UniaoBruta = { id: 90, pessoa1Id: 3, pessoa2Id: 2 }

const PESSOAS = montarPessoasDoProcesso([MARCO, JOAO, TEREZA, ANA], [UNIAO])

/** Os 5 passos publicados da Emissão, na ordem cadastrada. */
const PASSOS_PUBLICADOS = [
  { id: 101, key: "solicitar_certidao", titulo: "Solicitar certidão" },
  { id: 102, key: "aguardar_retorno", titulo: "Aguardar retorno do cartório" },
  { id: 103, key: "receber_certidao", titulo: "Receber certidão" },
  { id: 104, key: "conferir_certidao", titulo: "Conferir certidão" },
  { id: 105, key: "validar_certidao", titulo: "Validar certidão" },
]

let seqId = 1000
/**
 * Materializa os 5 passos publicados sobre UM alvo, com o modo SEQUENCIAL já
 * refletido no estado persistido (o primeiro DISPONIVEL, os demais PENDENTE
 * dependendo do anterior) e `concluidos` primeiros passos já concluídos.
 */
function materializar(
  necessidadeId: number,
  opcoes: { concluidos?: number; opcionais?: string[]; documentoId?: number | null } = {},
): PassoBruto[] {
  const concluidos = opcoes.concluidos ?? 0
  const opcionais = new Set(opcoes.opcionais ?? [])
  return PASSOS_PUBLICADOS.map((def, i) => {
    const feito = i < concluidos
    const proximo = i === concluidos
    return {
      stepInstanceId: seqId++,
      stepDefinitionId: def.id,
      stepKey: def.key,
      titulo: def.titulo,
      ordem: i + 1,
      obrigatorio: !opcionais.has(def.key),
      status: feito ? "CONCLUIDO" : proximo ? "DISPONIVEL" : "PENDENTE",
      ciclo: 1,
      pessoaId: null,
      necessidadeId,
      documentoId: opcoes.documentoId ?? null,
      responsavelId: null,
      responsavelNome: null,
      prazo: null,
      diasParaPrazo: null,
      slaDays: 3,
      motivo: null,
      executor: "OPERACAO_DOCUMENTO",
      erroAdministrativo: null,
      dependeDeStepKeys: i > 0 ? [PASSOS_PUBLICADOS[i - 1].key] : [],
    }
  })
}

const ALVOS: AlvoBruto[] = [
  { chave: "necessidade:11", escopo: "NECESSIDADE", pessoaId: 1, necessidadeId: 11, documentoId: null, titulo: "Certidão de Nascimento", subtitulo: null, statusLabel: "A localizar", pais: "Brasil" },
  { chave: "necessidade:12", escopo: "NECESSIDADE", pessoaId: 2, necessidadeId: 12, documentoId: null, titulo: "Certidão de Nascimento", subtitulo: null, statusLabel: "A localizar", pais: "Brasil" },
  { chave: "necessidade:13", escopo: "NECESSIDADE", pessoaId: 3, necessidadeId: 13, documentoId: null, titulo: "Certidão de Nascimento", subtitulo: null, statusLabel: "A localizar", pais: "Brasil" },
  { chave: "necessidade:14", escopo: "NECESSIDADE", pessoaId: 3, necessidadeId: 14, documentoId: null, titulo: "Certidão de Casamento", subtitulo: "Tereza Silva e João Silva", statusLabel: "A localizar", pais: "Brasil" },
]

function cenario(overrides: Record<number, { concluidos?: number; opcionais?: string[] }> = {}) {
  seqId = 1000
  const passos = [
    ...materializar(11, overrides[11] ?? {}),
    ...materializar(12, overrides[12] ?? {}),
    ...materializar(13, overrides[13] ?? {}),
    ...materializar(14, overrides[14] ?? {}),
  ]
  return montarEstruturaOperacional({ pessoas: PESSOAS, passos, alvos: ALVOS })
}

// ============================================================
console.log("\n(A1) Hierarquia — pessoa → documento → workflow → passos")
// ============================================================

const e = cenario()
const todasAsLinhas = [...e.linhaPrincipal, ...e.foraDaLinha, ...e.pendenteClassificacao]
const linhaDe = (id: number) => todasAsLinhas.find((l) => l.pessoa.pessoaId === id)!

check("todas as pessoas da árvore aparecem (nenhuma descartada)", todasAsLinhas.length === 4)
check("3 pessoas têm trabalho aplicável", e.resumo.pessoasComTrabalho === 3)
check("4 documentos no total", e.resumo.documentos === 4)
check("(1) uma pessoa com UM documento", linhaDe(1).documentos.length === 1)
check("(2) uma pessoa com VÁRIOS documentos", linhaDe(3).documentos.length === 2)
check("(3) várias pessoas com vários documentos", linhaDe(1).documentos.length + linhaDe(2).documentos.length + linhaDe(3).documentos.length === 4)
check("cada documento carrega o workflow COMPLETO (5 passos)", todasAsLinhas.every((l) => l.documentos.every((d) => d.passos.length === 5)))
check("20 instâncias de passo no total", todasAsLinhas.flatMap((l) => l.documentos).flatMap((d) => d.passos).length === 20)
check("os passos vêm na ordem publicada", linhaDe(1).documentos[0].passos.map((p) => p.ordem).join() === "1,2,3,4,5")
check("o rótulo do passo é o do cadastro (nunca a stepKey crua)", linhaDe(1).documentos[0].passos[1].titulo === "Aguardar retorno do cartório")
check("nenhum passo global sobrou (todos têm alvo)", e.globais.length === 0)
check("nenhum alvo ficou sem dono", e.semDono.length === 0)

console.log("\n(A2) Pessoa sem documento aplicável e fora da linhagem")
check("(4) pessoa sem documento continua VISÍVEL", linhaDe(4) != null)
check("(4) e é marcada como 'sem trabalho aplicável'", linhaDe(4).semTrabalhoAplicavel === true)
check("(4) não conta como pendência", linhaDe(4).pendentes === 0)
check("(4) não entra no denominador da fase", linhaDe(4).progresso.total === 0)
check("(5) pessoa fora da linhagem fica no grupo próprio", e.foraDaLinha.some((l) => l.pessoa.pessoaId === 3))
check("(5) e mantém os documentos dela normalmente", e.foraDaLinha.find((l) => l.pessoa.pessoaId === 3)!.documentos.length === 2)
check("requerente e ascendentes ficam na linha principal", e.linhaPrincipal.map((l) => l.pessoa.pessoaId).sort().join() === "1,2,4")

console.log("\n(A3) Sequência independente por documento")
// João conclui "Solicitar certidão" da certidão dele (nec 12). Ninguém mais muda.
const e2 = cenario({ 12: { concluidos: 1 } })
const joao2 = e2.linhaPrincipal.find((l) => l.pessoa.pessoaId === 2)!.documentos[0]
const tereza2 = e2.foraDaLinha.find((l) => l.pessoa.pessoaId === 3)!.documentos
check("(6) workflow sequencial: 1º passo disponível, demais bloqueados", (() => {
  const d = linhaDe(1).documentos[0]
  return d.passos[0].disponivel && d.passos.slice(1).every((p) => p.bloqueado)
})())
check("(6) o motivo do bloqueio vem da dependência PUBLICADA", linhaDe(1).documentos[0].passos[1].motivoBloqueio === "Aguarda: Solicitar certidão")
check("(7) concluir o passo do João libera o PRÓXIMO do documento DELE", joao2.passos[0].balde === "CONCLUIDA" && joao2.passos[1].disponivel)
check("(7) e NÃO libera nada nos documentos da Tereza", tereza2.every((d) => d.passos[0].disponivel && d.passos[1].bloqueado))
check("(7) o documento do Marco também fica intacto", (() => {
  const d = e2.linhaPrincipal.find((l) => l.pessoa.pessoaId === 1)!.documentos[0]
  return d.passos[0].disponivel && d.passos[1].bloqueado
})())

console.log("\n(A4) Progresso")
const e3 = cenario({ 11: { concluidos: 5 }, 13: { concluidos: 2 } })
const marco3 = e3.linhaPrincipal.find((l) => l.pessoa.pessoaId === 1)!
const tereza3 = e3.foraDaLinha.find((l) => l.pessoa.pessoaId === 3)!
check("(10) progresso do documento = obrigatórios concluídos / obrigatórios dele", marco3.documentos[0].progresso.concluidos === 5 && marco3.documentos[0].progresso.total === 5 && marco3.documentos[0].progresso.pct === 100)
check("(10) documento parcial calcula o próprio percentual", (() => {
  const nasc = tereza3.documentos.find((d) => d.chave === "necessidade:13")!
  return nasc.progresso.concluidos === 2 && nasc.progresso.total === 5 && nasc.progresso.pct === 40
})())
check("(11) progresso da pessoa = soma ponderada dos documentos dela", tereza3.progresso.concluidos === 2 && tereza3.progresso.total === 10 && tereza3.progresso.pct === 20)
check("(12) contadores da fase somam todos os obrigatórios aplicáveis", e3.resumo.passosObrigatorios === 20 && e3.resumo.passosObrigatoriosConcluidos === 7)
check("(12) documentos concluídos e pendentes batem com a lista", e3.resumo.documentosConcluidos === 1 && e3.resumo.documentosPendentes === 3)
check("progresso NÃO conta pessoa sem documento aplicável", linhaDe(4).progresso.total === 0)

console.log("\n(A5) Passos opcionais")
const e4 = cenario({ 11: { concluidos: 4, opcionais: ["validar_certidao"] } })
const marco4 = e4.linhaPrincipal.find((l) => l.pessoa.pessoaId === 1)!.documentos[0]
check("(13) passo opcional sai do denominador", marco4.progresso.total === 4)
check("(13) passo opcional NÃO impede o documento de concluir", marco4.concluido === true)
check("(13) passo opcional continua VISÍVEL na lista", marco4.passos.length === 5 && marco4.passos.some((p) => !p.obrigatorio))

console.log("\n(A6) Conclusão de documento × conclusão de fase")
check("(8) concluir UM documento não conclui os outros", e3.resumo.documentosConcluidos === 1 && e3.resumo.documentos === 4)
const eTudo = cenario({ 11: { concluidos: 5 }, 12: { concluidos: 5 }, 13: { concluidos: 5 }, 14: { concluidos: 5 } })
check("(9) concluir TODOS os documentos zera o pendente da fase", eTudo.resumo.documentosConcluidos === 4 && eTudo.resumo.documentosPendentes === 0)
check("(9) e todos os passos obrigatórios ficam concluídos", eTudo.resumo.passosObrigatorios === eTudo.resumo.passosObrigatoriosConcluidos)

console.log("\n(A7) Sem duplicação, sem invenção")
const idsNaEstrutura = [
  ...todasAsLinhas.flatMap((l) => l.documentos).flatMap((d) => d.passos),
  ...todasAsLinhas.flatMap((l) => l.passosDaPessoa),
  ...e.globais,
  ...e.semDono.flatMap((d) => d.passos),
].map((p) => p.stepInstanceId)
check("(16) cada instância aparece EXATAMENTE uma vez na estrutura", idsNaEstrutura.length === new Set(idsNaEstrutura).size)
check("(19) um documento pertence a UMA pessoa só", (() => {
  const chaves = todasAsLinhas.flatMap((l) => l.documentos.map((d) => d.chave))
  return chaves.length === new Set(chaves).size
})())
check("(15) recarregar não duplica: mesma entrada ⇒ mesma saída", JSON.stringify(cenario()) === JSON.stringify(cenario()))

// (20) targetType/targetId — a identidade do alvo é SEMPRE por id oficial.
check("(20) alvo por NECESSIDADE usa o id da necessidade", chaveDoAlvo({ pessoaId: null, necessidadeId: 7, documentoId: 9 }) === "necessidade:7")
check("(20) alvo por DOCUMENTO usa o id do documento", chaveDoAlvo({ pessoaId: null, necessidadeId: null, documentoId: 9 }) === "documento:9")
check("(20) alvo por PESSOA usa o id da pessoa", chaveDoAlvo({ pessoaId: 5, necessidadeId: null, documentoId: null }) === "pessoa:5")
check("(20) sem entidade nenhuma, o escopo é PROCESSO", chaveDoAlvo({ pessoaId: null, necessidadeId: null, documentoId: null }) === "processo")
check("(20) o escopo é LIDO da entidade, nunca do nome do passo", escopoDoAlvo({ pessoaId: null, necessidadeId: 7, documentoId: null }) === "NECESSIDADE" && escopoDoAlvo({ pessoaId: 5, necessidadeId: null, documentoId: null }) === "PESSOA")

// O documento que ATENDE uma necessidade é o MESMO alvo — senão a certidão apareceria
// em dois lugares, cada um com metade do workflow.
const vinculo = new Map<number, number>([[9, 7]])
check("passo por DOCUMENTO converge para a necessidade que ele atende", chaveDoAlvo({ pessoaId: null, necessidadeId: null, documentoId: 9 }, vinculo) === "necessidade:7")

console.log("\n(A8) Escopo PROCESSO e alvo órfão continuam visíveis")
seqId = 5000
const passoGlobal: PassoBruto = {
  stepInstanceId: 9001, stepDefinitionId: 200, stepKey: "conferir_pasta", titulo: "Conferir pasta",
  ordem: 1, obrigatorio: true, status: "DISPONIVEL", ciclo: 1,
  pessoaId: null, necessidadeId: null, documentoId: null,
  responsavelId: null, responsavelNome: null, prazo: null, diasParaPrazo: null, slaDays: null,
  motivo: null, executor: null, erroAdministrativo: "Sem executor", dependeDeStepKeys: [],
}
const orfaos = materializar(99).map((p) => ({ ...p, necessidadeId: 99 }))
const eGlobal = montarEstruturaOperacional({
  pessoas: PESSOAS,
  passos: [passoGlobal, ...orfaos],
  alvos: [{ chave: "necessidade:99", escopo: "NECESSIDADE", pessoaId: 777, necessidadeId: 99, documentoId: null, titulo: "Certidão de Óbito", subtitulo: null, statusLabel: null, pais: null }],
})
check("passo de escopo PROCESSO fica na faixa global (sem dono pessoal)", eGlobal.globais.length === 1 && eGlobal.globais[0].stepInstanceId === 9001)
check("passo sem executor continua visível, com o erro administrativo em texto", eGlobal.globais[0].erroAdministrativo === "Sem executor")
check("alvo cujo dono não está no roster fica VISÍVEL em 'sem dono'", eGlobal.semDono.length === 1 && eGlobal.semDono[0].necessidadeId === 99)
check("alvo órfão NÃO é atribuído a uma pessoa qualquer", eGlobal.linhaPrincipal.every((l) => l.documentos.every((d) => d.necessidadeId !== 99)))

// ============================================================
console.log("\n(A9) ÍNDICE — o DTO que a tela principal recebe")
// ============================================================

const idx = montarIndiceOperacional(e3)
const linhasIdx = [...idx.linhaPrincipal, ...idx.foraDaLinha, ...idx.pendenteClassificacao]
const idxDe = (id: number) => linhasIdx.find((l) => l.pessoa.pessoaId === id)!

// A prova mais dura: o payload do índice não contém NADA de execução.
const payload = JSON.stringify(idx)
for (const proibido of ["passos", "stepInstanceId", "stepKey", "slaDays", "prazo", "diasParaPrazo", "responsavelNome", "motivoBloqueio", "disponivel", "bloqueado", "executor"]) {
  check(`o índice NÃO carrega "${proibido}"`, !payload.includes(proibido))
}
check("uma linha por documento, com identidade por ID", idxDe(3).documentos.length === 2 && idxDe(3).documentos.every((d) => d.necessidadeId != null))
check("todas as pessoas continuam no índice", linhasIdx.length === 4)
check("pessoa sem documento aplicável é marcada, não removida", idxDe(4).semDocumentoAplicavel === true && idxDe(4).documentos.length === 0)
check("contadores por pessoa vêm do domínio", JSON.stringify(idxDe(3).totais) === JSON.stringify({ documentos: 2, prontos: 0, pendentes: 2, divergentes: 0 }))
check("documento concluído vira status final PRONTO", idxDe(1).documentos[0].statusFinal === "PRONTO")
check("documento parcialmente executado vira EM_ANDAMENTO", (() => {
  const d = idxDe(3).documentos.find((x) => x.chave === "necessidade:13")!
  return d.statusFinal === "EM_ANDAMENTO"
})())
check("documento sem passo concluído vira PENDENTE", idxDe(2).documentos[0].statusFinal === "PENDENTE")
check("status final tem rótulo humano pronto", idxDe(1).documentos[0].statusFinalLabel === "Pronto")
check("resumo do índice = soma dos documentos, não de elementos na tela", (() => {
  const r = idx.resumo
  return r.documentos === 4 && r.prontos === 1 && r.pendentes === 3 && r.pessoasComTrabalho === 3
})())
check("artefatos ausentes viram 'Não aplicável', nunca um estado inventado",
  idxDe(2).documentos[0].artefatos.retificada === "NAO_APLICAVEL" &&
  idxDe(2).documentos[0].artefatos.traducao === "NAO_APLICAVEL")
check("o índice leva o pessoaId do titular (a antecipada do modal precisa dele)", idxDe(1).documentos[0].pessoaId === 1)

// Divergência tem precedência: documento travado não é "em andamento".
const eDiv = (() => {
  seqId = 7000
  const passos = materializar(11).map((p, i) => (i === 0 ? { ...p, status: "BLOQUEADO" } : p))
  return montarIndiceOperacional(montarEstruturaOperacional({ pessoas: PESSOAS, passos, alvos: ALVOS }))
})()
check("documento com passo BLOQUEADO vira DIVERGENTE no índice",
  eDiv.linhaPrincipal.find((l) => l.pessoa.pessoaId === 1)!.documentos[0].statusFinal === "DIVERGENTE")

// Documento sem executor em nenhum passo: NÃO abre, mas continua visível e dizendo o porquê.
const eSemExec = (() => {
  seqId = 8000
  const passos = materializar(11).map((p) => ({ ...p, executor: null, erroAdministrativo: "Sem executor" }))
  return montarIndiceOperacional(montarEstruturaOperacional({ pessoas: PESSOAS, passos, alvos: ALVOS }))
})()
const semExec = eSemExec.linhaPrincipal.find((l) => l.pessoa.pessoaId === 1)!.documentos[0]
check("documento sem executor NÃO é escondido do índice", semExec != null)
check("documento sem executor não oferece 'Abrir detalhes'", semExec.podeAbrirDetalhes === false)
check("e diz em texto o que falta", semExec.impedimento === "Sem executor")

// ============================================================
console.log("\n(B) A regressão não pode voltar")
// ============================================================

const rota = read("src/app/api/processos/[processoId]/central-operacional/route.ts")
const central = read("src/components/kanban/ProcessoCentralOperacional.tsx")
const painel = read("src/components/kanban/PainelDaFase.tsx")
const consulta = read("src/lib/process-stage/estrutura-operacional.ts")
const nucleo = read("src/lib/process-stage/estrutura-operacional-core.ts")
const docop = read("src/services/documento-operacao.ts")
const wtab = read("src/components/kanban/workflow/WorkflowTab.tsx")
const drawer = read("src/components/kanban/DocumentoOperationalDrawer.tsx")
const opa = read("src/components/kanban/workflow/OperacaoAntecipadaPainel.tsx")
const escopo = read("src/services/phase-workflow-escopo.ts")
const schema = read("prisma/schema.prisma")

console.log("\n(B1) Duas consultas, dois DTOs — o índice não carrega execução")
check("existe getPhaseOperationalStructure (detalhe, para o domínio/modal)", consulta.includes("export async function getPhaseOperationalStructure"))
check("existe getPhaseOperationalSummary (índice, para a tela principal)", consulta.includes("export async function getPhaseOperationalSummary"))
check("a rota da Central consome o ÍNDICE", rota.includes("getPhaseOperationalSummary(") && /^\s*indice,\s*$/m.test(rota))
check("a rota NÃO devolve mais a estrutura completa nem a lista plana", !/^\s*estrutura,\s*$/m.test(rota) && !rota.includes("TarefaFaseRow"))
check("o DTO de índice existe e é explícito", nucleo.includes("export interface IndiceOperacional") && nucleo.includes("export interface DocumentoDoIndice"))
check("o índice é PROJETADO da estrutura (uma fonte, dois recortes)", nucleo.includes("export function montarIndiceOperacional"))
check("a consulta lê PhaseWorkflowStepInstance da fase (fonte única)", consulta.includes("phaseWorkflowStepInstance.findMany") && consulta.includes("faseMacroKey: ctx.faseMacroKey"))
check("a consulta exclui SUPERSEDIDO/CANCELADO (saíram do fluxo)", consulta.includes('notIn: ["SUPERSEDIDO", "CANCELADO"]'))
check("a consulta escopa por instância quando a fase não é a ativa", consulta.includes("ctx.workflowInstanceId != null"))
// O contrato do DTO é a trava: nenhum campo de execução existe em DocumentoDoIndice.
const dto = nucleo.slice(nucleo.indexOf("export interface DocumentoDoIndice"), nucleo.indexOf("export interface PessoaDoIndice"))
for (const proibido of ["passos", "stepInstanceId", "slaDays", "prazo", "responsavel", "motivoBloqueio", "executor:"]) {
  check(`DocumentoDoIndice não tem campo "${proibido}"`, !dto.includes(proibido))
}

console.log("\n(B2) TELA PRINCIPAL — índice, nunca executor")
check("o painel recebe o ÍNDICE, não a estrutura", painel.includes("indice: IndiceOperacional") && !painel.includes("estrutura: EstruturaOperacional"))
check("a Central repassa o índice ao painel", central.includes("indice={bodyData.indice") && central.includes("indice?: IndiceOperacional"))
check("o painel renderiza pessoa (card) → documento (linha)", painel.includes("function PessoaCard") && painel.includes("function LinhaDocumento"))
check("a única ação por documento é 'Abrir detalhes'", painel.includes("Abrir detalhes") && painel.includes("onAbrirDetalhes"))
// Os componentes de execução NÃO existem mais na tela principal.
for (const proibido of ["function PassoRow", "function PassoDoWorkflow", "function InstanciaDoPasso", "function WorkflowDaFase", "function DocumentoAccordion", "function PessoaAccordion"]) {
  check(`tela principal não tem "${proibido}"`, !painel.includes(proibido))
}
// Nem o vocabulário de execução.
for (const proibido of ["statusLabel", "slaDays", "diasParaPrazo", "motivoBloqueio", "responsavelNome", "stepInstanceId", "disponivel", "OperacoesAntecipadasInline", "onNovaOperacao", "onAvaliarOperacao", "passo(s)"]) {
  check(`tela principal não usa "${proibido}"`, !painel.includes(proibido))
}
check("a tela principal não mapeia passos de lugar nenhum", !/\.passos\.map/.test(painel) && !/workflow\.steps/.test(painel))
check("contadores da tela vêm do backend (totais/resumo), não de contar elementos", painel.includes("linha.totais") && painel.includes("indice.resumo"))
check("pessoa sem documento aplicável diz isso em texto", painel.includes("Nenhum documento aplicável nesta fase"))
check("colunas do índice são as aprovadas", ["Documento", "Certidão", "Retificada", "Tradução", "Apostila", "Status final", "Ações"].every((c) => painel.includes(`>${c}<`)))

console.log("\n(B3) MODAL DO DOCUMENTO — o único executor")
check("a aba Workflow existe e é do documento", wtab.includes("export function WorkflowTab") && wtab.includes("documentoId"))
check("a aba mostra TODOS os passos (sem filtro que esconde futuros)", wtab.includes("workflow.steps.map") && !/steps\s*\.filter\(\(step\)/.test(wtab))
check("a aba tem uma consulta oficial única do backend", wtab.includes("`/api/documentos/${documentoId}/workflow`"))
check("a aba abre a Central da Etapa (execução por passo)", wtab.includes("CentralDaEtapaDrawer") && wtab.includes("setCentralStepId"))
check("o drawer do documento repassa o contexto à aba", drawer.includes("contextoAntecipada={contextoAntecipada}") && drawer.includes("type ContextoAntecipada"))
check("a Central abre o modal por ID do documento", central.includes("const abrirDetalhes = useCallback") && /abrirOperacao\(doc\.documentoId \?\? 0, doc\.necessidadeId\)/.test(central))

console.log("\n(B4) OPERAÇÃO ANTECIPADA — inteira, e só dentro do modal")
check("componente existe no escopo do modal", opa.includes("export function OperacoesAntecipadasInline") && opa.includes("OperacaoAntecipadaItem"))
check("criar continua disponível (no modal)", wtab.includes("OperacaoAntecipadaModal") && wtab.includes("nova operação antecipada"))
check("listar continua disponível (no modal)", wtab.includes("<OperacoesAntecipadasInline"))
check("avaliar o objetivo continua disponível", opa.includes("onAvaliar?.(o.id") && opa.includes("Objetivo atingido"))
check("abrir a operação oficial continua disponível", wtab.includes("onAbrirOperacaoAlvo") && central.includes("const abrirOperacaoAlvo = useCallback"))
check("rótulos de status preservados", opa.includes("ST_OP_LABEL") && opa.includes("AGUARDANDO_RESULTADO"))
check("ancorada no ALVO (necessidade do documento aberto)", wtab.includes("o.necessidadeId === necId"))
// Só o CÓDIGO conta: o cabeçalho do arquivo cita a regra de propósito.
const painelCodigo = painel.slice(painel.indexOf('"use client"'))
check("NÃO aparece na tela principal", !/antecipada/i.test(painelCodigo))
check("NÃO foi movida para a pessoa nem para a fase", !painel.includes("operacoesPorNec") && !central.includes("operacoesPorNec"))

console.log("\n(B5) Alvo por ID oficial — nunca por texto")
check("o núcleo agrupa por id (necessidade/documento/pessoa)", nucleo.includes("`necessidade:${p.necessidadeId}`") && nucleo.includes("`documento:${p.documentoId}`"))
check("o escopo é lido da entidade vinculada", nucleo.includes("export function escopoDoAlvo"))
check("a instância PERSISTE o alvo no schema", /pessoaId\s+Int\?/.test(schema) && /necessidadeId Int\?/.test(schema) && /documentoId\s+Int\?/.test(schema))
check("a materialização grava o alvo (não deduz depois)", escopo.includes("pessoaId: number | null") && escopo.includes("necessidadeId: number | null"))
check("a cardinalidade publicada decide quantas instâncias existem", escopo.includes("cardinalidadeEfetiva") && escopo.includes('cardinalidade === "NECESSIDADE"'))

console.log("\n(B6) Idempotência com trava REAL no banco")
check("chaveIdempotencia é UNIQUE em PhaseWorkflowStepInstance", /chaveIdempotencia String\s+@unique/.test(schema))
check("a consulta ALARMA duplicidade em vez de exibi-la", consulta.includes("INSTANCIA_DUPLICADA"))
check("não há createMany+skipDuplicates fazendo o papel da constraint", !/phaseWorkflowStepInstance\.createMany\([\s\S]{0,200}skipDuplicates/.test(read("src/services/phase-workflow.ts")))

console.log("\n(B7) Sequência por documento — no domínio, não na tela")
check("liberar o próximo passo é escopado pelo DOCUMENTO", /findFirst\(\{\s*where: \{ documentoId, faseMacroKey: p\.faseMacroKey, ordem: \{ gt: p\.ordem \}/.test(docop))
check("reabrir bloqueia só os posteriores DO MESMO documento", /updateMany\(\{\s*where: \{ documentoId, faseMacroKey: p\.faseMacroKey, ordem: \{ gt: p\.ordem \}/.test(docop))
check("o modo de execução é PERSISTIDO (SEQUENCIAL/PARALELO), não fixo no código", escopo.includes('execucao === "SEQUENCIAL"'))

console.log("\n(B8) Segurança — validação no servidor")
check("a leitura da Central exige permissão", rota.includes('verificarPermissao(request, "processos.ver")'))
check("abrir a operação exige permissão de edição", read("src/app/api/processos/[processoId]/genealogia/operacao/route.ts").includes('verificarPermissao(request, "processos.editar")'))
check("o PERTENCIMENTO é validado no servidor, não confiado no cliente", read("src/services/genealogia/operacao-necessidade.ts").includes("nec.processoId !== processoId"))
check("a consulta é escopada pelo processo (nunca lista global)", consulta.includes("processoId: ctx.processoId"))

console.log("\n(B9) Observabilidade")
for (const evento of ["ALVO_AUSENTE", "ALVO_SEM_DONO", "INSTANCIA_DUPLICADA", "PASSO_SEM_EXECUTOR"]) {
  check(`log estruturado para ${evento}`, consulta.includes(evento))
}
check("log estruturado (prefixo estável + JSON), não console.log solto", consulta.includes('console.warn(`[estrutura-operacional]') && consulta.includes("JSON.stringify(d)"))

console.log("\n(B10) Fonte única de progresso da fase")
check("o núcleo NÃO calcula um percentual rival para a fase", !nucleo.includes("percentualDaFase") && nucleo.includes("resolveOperationalProjection"))
check("a barra da fase segue na projeção canônica", central.includes("const pct = matrix.percentage"))
check("os KPIs saem do MESMO resumo do índice", central.includes("data.indice?.resumo"))

// ============================================================
console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
if (falhas.length > 0) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}
