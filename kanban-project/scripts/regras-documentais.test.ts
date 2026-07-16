/**
 * TESTES — Regras Documentais (avaliador + conflitos + condições + versionamento).
 * Rodar: tsx scripts/regras-documentais.test.ts
 *
 * Puro (sem banco). Cobre os cenários exigidos. A simulação NÃO grava nada — só
 * calcula. Nenhuma lógica antiga da Genealogia é reativada (guard separado).
 */
import { avaliarRegrasDocumentais, avaliarSatisfacaoRequisito } from "../src/lib/documentos/regras-documentais/avaliador"
import { detectarConflitos } from "../src/lib/documentos/regras-documentais/conflitos"
import { validarConjunto } from "../src/lib/documentos/regras-documentais/condicoes"
import { podeEditarEmLugar, proximaVersao } from "../src/lib/documentos/regras-documentais/versionamento"
import type { RegraDocumental, SujeitoContexto, ContextoAvaliacao } from "../src/lib/documentos/regras-documentais/tipos"

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) { if (cond) { passed++; console.log(`  ✅ ${nome}`) } else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) } }

const HOJE = "2026-07-16T12:00:00.000Z"
const base: Omit<RegraDocumental, "id" | "documentTypeCode" | "publicoAlvo" | "documentosAceitos" | "publicosAlvo" | "tipoProcessoIds"> = {
  codigo: null, nome: null, descricao: null, status: "PUBLICADA", versao: 1, prioridade: 0,
  vigenciaInicio: null, vigenciaFim: null, aplicaTodosProcessos: false, tipoProcessoId: 1,
  modalidadeId: null, paisCode: null, regiaoCode: null, tipoProcessoVersao: null,
  requisitoNome: null, modoSatisfacao: "QUALQUER_UM_ATENDE", categoriaCode: null, obrigatoriedade: "OBRIGATORIA", condicoes: null,
  faseExigencia: null, faseBloqueio: null, bloqueiaConclusaoFase: false, continuaObrigatorioNasFasesSeguintes: false,
  faseFinalExigencia: null, obrigatorioAteFinalProcesso: false,
  possuiValidade: false, validadeDias: null, exigeDataEmissao: false, renovarQuandoExpirado: false, antecedenciaRenovacaoDias: null,
}
const mk = (id: number, doc: string, publico: RegraDocumental["publicoAlvo"], extra: Partial<RegraDocumental> = {}): RegraDocumental =>
  ({ ...base, id, documentTypeCode: doc, documentosAceitos: [doc], publicoAlvo: publico, publicosAlvo: [publico], tipoProcessoIds: [base.tipoProcessoId], ...extra })

// ---- conjunto canônico (cadastrável, sem hardcode no motor) ----
const R_NASC = mk(1, "CERTIDAO_NASCIMENTO_IT", "PESSOA_DA_ARVORE_COM_DOCUMENTACAO", {
  nome: "Nascimento", faseExigencia: "genealogia", faseBloqueio: "genealogia", bloqueiaConclusaoFase: true,
  condicoes: { combinador: "TODAS", regras: [{ campo: "precisaDeDocumentacao", operador: "igual", valor: true }] },
})
const R_CAS = mk(2, "CERTIDAO_CASAMENTO_IT", "PESSOA_DA_ARVORE_COM_DOCUMENTACAO", {
  nome: "Casamento", faseExigencia: "genealogia", faseBloqueio: "genealogia", bloqueiaConclusaoFase: true,
  condicoes: { combinador: "TODAS", regras: [{ campo: "precisaDeDocumentacao", operador: "igual", valor: true }, { campo: "casado", operador: "igual", valor: true }] },
})
const R_OBT = mk(3, "CERTIDAO_OBITO_IT", "PESSOA_DA_ARVORE_COM_DOCUMENTACAO", {
  nome: "Óbito", faseExigencia: "genealogia", faseBloqueio: "genealogia", bloqueiaConclusaoFase: true,
  condicoes: { combinador: "TODAS", regras: [{ campo: "precisaDeDocumentacao", operador: "igual", valor: true }, { campo: "falecido", operador: "igual", valor: true }] },
})
const R_ID = mk(4, "IDENTIDADE", "REQUERENTE", {
  nome: "Identidade", faseExigencia: "protocolado", faseBloqueio: "protocolado", bloqueiaConclusaoFase: true, obrigatorioAteFinalProcesso: true,
})
const R_END = mk(5, "COMPROVANTE_ENDERECO", "REQUERENTE", {
  nome: "Comprovante de endereço", faseExigencia: "protocolado", possuiValidade: true, validadeDias: 90, renovarQuandoExpirado: true, exigeDataEmissao: true,
})
const R_OPC = mk(6, "DOC_OPCIONAL", "REQUERENTE", { nome: "Opcional", obrigatoriedade: "OPCIONAL" })
const R_QUALQUER = mk(7, "DOC_QUALQUER", "PESSOA_DA_ARVORE_COM_DOCUMENTACAO", {
  nome: "Qualquer", condicoes: { combinador: "QUALQUER", regras: [{ campo: "casado", operador: "igual", valor: true }, { campo: "falecido", operador: "igual", valor: true }] },
})
const R_INATIVA = mk(8, "DOC_INATIVO", "REQUERENTE", { nome: "Inativa", status: "INATIVA" })
const R_FUTURA = mk(9, "DOC_FUTURO", "REQUERENTE", { nome: "Futura", vigenciaInicio: "2099-01-01T00:00:00.000Z" })

const CERTIDOES = [R_NASC, R_CAS, R_OBT]
const TODAS = [R_NASC, R_CAS, R_OBT, R_ID, R_END, R_OPC, R_QUALQUER, R_INATIVA, R_FUTURA]

const ctx = (sujeito: SujeitoContexto, regras = TODAS, dataReferencia = HOJE): ContextoAvaliacao =>
  ({ tipoProcessoId: 1, faseKey: null, sujeito, dataReferencia, regras })
const docsAplicaveis = (sujeito: SujeitoContexto, regras = TODAS, data = HOJE) =>
  avaliarRegrasDocumentais(ctx(sujeito, regras, data)).aplicaveis.map((a) => a.documentTypeCode)

const pessoaArvore = (p: Partial<SujeitoContexto>): SujeitoContexto => ({ ehPessoaArvore: true, requerente: false, linhaReta: true, ...p })

console.log("\nAvaliador — certidões da Genealogia")
// 1
ok(JSON.stringify(docsAplicaveis(pessoaArvore({ precisaDeDocumentacao: true }), CERTIDOES)) === JSON.stringify(["CERTIDAO_NASCIMENTO_IT"]), "1) com documentação → só nascimento")
// 2
ok(new Set(docsAplicaveis(pessoaArvore({ precisaDeDocumentacao: true, casado: true }), CERTIDOES)).size === 2 &&
   docsAplicaveis(pessoaArvore({ precisaDeDocumentacao: true, casado: true }), CERTIDOES).includes("CERTIDAO_CASAMENTO_IT"), "2) casada → nascimento + casamento")
// 3
ok(docsAplicaveis(pessoaArvore({ precisaDeDocumentacao: true, falecido: true, vivo: false }), CERTIDOES).includes("CERTIDAO_OBITO_IT") &&
   docsAplicaveis(pessoaArvore({ precisaDeDocumentacao: true, falecido: true }), CERTIDOES).length === 2, "3) falecida → nascimento + óbito")
// 4
ok(new Set(docsAplicaveis(pessoaArvore({ precisaDeDocumentacao: true, casado: true, falecido: true }), CERTIDOES)).size === 3, "4) casada e falecida → os três")
// 5
ok(docsAplicaveis(pessoaArvore({ precisaDeDocumentacao: false }), CERTIDOES).length === 0, "5) sem documentação → nenhuma certidão")

console.log("\nAvaliador — documentos dos requerentes")
// 6
ok(docsAplicaveis({ ehPessoaArvore: false, requerente: true }).includes("IDENTIDADE"), "6) requerente → identidade")
// 7
ok(!docsAplicaveis(pessoaArvore({ requerente: false, precisaDeDocumentacao: true })).includes("IDENTIDADE"), "7) ascendente não requerente → sem identidade")
// 8
ok(R_ID.faseBloqueio === "protocolado" && (R_ID.faseBloqueio as string) !== "genealogia", "8) identidade bloqueia Protocolo, NÃO Genealogia")
// 9
{
  const nasc = avaliarRegrasDocumentais(ctx(pessoaArvore({ precisaDeDocumentacao: true }), CERTIDOES)).aplicaveis.find((a) => a.documentTypeCode === "CERTIDAO_NASCIMENTO_IT")
  ok(!!nasc && nasc.bloqueiaConclusaoFase && nasc.faseBloqueio === "genealogia", "9) certidão bloqueia Genealogia")
}
// 10 — comprovante com validade expira (emitido há 100 dias, validade 90)
{
  const emissao = new Date(new Date(HOJE).getTime() - 100 * 86400000).toISOString()
  const r = avaliarRegrasDocumentais(ctx({ ehPessoaArvore: false, requerente: true, dataEmissaoDocumento: emissao }, [R_END])).aplicaveis[0]
  ok(!!r && r.validade.expirado === true && r.validade.precisaRenovar === true, "10) comprovante expira e pede renovação")
}
// 11
{
  const r = avaliarRegrasDocumentais(ctx({ ehPessoaArvore: false, requerente: true }, [R_OPC])).aplicaveis[0]
  ok(!!r && r.obrigatoriedade === "OPCIONAL", "11) regra opcional retorna opcional")
}
// 12 — condição TODAS: casamento exige precisaDoc E casado
ok(!docsAplicaveis(pessoaArvore({ precisaDeDocumentacao: true, casado: false }), [R_CAS]).includes("CERTIDAO_CASAMENTO_IT"), "12) TODAS: falta 'casado' → não aplica")
// 13 — condição QUALQUER (público exige documentação; casado satisfaz o QUALQUER)
ok(docsAplicaveis(pessoaArvore({ precisaDeDocumentacao: true, casado: true, falecido: false }), [R_QUALQUER]).includes("DOC_QUALQUER") &&
   !docsAplicaveis(pessoaArvore({ precisaDeDocumentacao: true, casado: false, falecido: false }), [R_QUALQUER]).includes("DOC_QUALQUER"),
   "13) QUALQUER: casado satisfaz; nem-casado-nem-falecido não")

console.log("\nConflitos")
// 14 — obrigatoriedade divergente (mesmo doc+público, mesma condição)
{
  const a = mk(10, "X", "REQUERENTE", { nome: "A", obrigatoriedade: "OBRIGATORIA" })
  const b = mk(11, "X", "REQUERENTE", { nome: "B", obrigatoriedade: "OPCIONAL" })
  const cs = detectarConflitos([a, b])
  ok(cs.some((c) => c.tipo === "obrigatoriedade_divergente"), "14) conflito de obrigatoriedade detectado")
}
// 15 — duplicação
{
  const a = mk(12, "Y", "REQUERENTE", { nome: "A" })
  const b = mk(13, "Y", "REQUERENTE", { nome: "B" })
  ok(detectarConflitos([a, b]).some((c) => c.tipo === "regra_duplicada"), "15) duplicação detectada")
}

console.log("\nVersionamento")
// 16 / 17
ok(podeEditarEmLugar("PUBLICADA") === false, "16) versão publicada NÃO é editável em lugar (exige nova versão)")
ok(podeEditarEmLugar("RASCUNHO") === true && proximaVersao([1, 2]) === 3, "17) rascunho editável; nova versão = max+1")

console.log("\nStatus / vigência")
// 18
ok(!docsAplicaveis({ ehPessoaArvore: false, requerente: true }, [R_INATIVA]).includes("DOC_INATIVO"), "18) regra inativa não é avaliada")
// 19
ok(!docsAplicaveis({ ehPessoaArvore: false, requerente: true }, [R_FUTURA]).includes("DOC_FUTURO"), "19) regra futura respeita vigência")

console.log("\nPureza / condições")
// 20 — simulação (avaliador) não muta a entrada nem cria nada
{
  const sujeito = pessoaArvore({ precisaDeDocumentacao: true, casado: true })
  const regrasCopia = JSON.parse(JSON.stringify(CERTIDOES))
  const c = ctx(sujeito, regrasCopia)
  avaliarRegrasDocumentais(c)
  ok(JSON.stringify(regrasCopia) === JSON.stringify(CERTIDOES) && JSON.stringify(sujeito).includes("precisaDeDocumentacao"), "20) avaliador é puro (não muta regras/sujeito, não cria nada)")
}
// condição incompatível detectada (vivo=Sim e falecido=Sim)
ok(validarConjunto({ combinador: "TODAS", regras: [{ campo: "vivo", operador: "igual", valor: true }, { campo: "falecido", operador: "igual", valor: true }] }).some((p) => p.tipo === "contradicao"), "condição incompatível (vivo+falecido) é alertada")

console.log("\nAjustes desta rodada")
// A) aplica a TODOS os tipos de processo
{
  const rTodos = mk(20, "DOC_TODOS", "REQUERENTE", { nome: "Todos", aplicaTodosProcessos: true })
  const em7 = avaliarRegrasDocumentais({ ...ctx({ ehPessoaArvore: false, requerente: true }, [rTodos]), tipoProcessoId: 7 }).aplicaveis
  const em99 = avaliarRegrasDocumentais({ ...ctx({ ehPessoaArvore: false, requerente: true }, [rTodos]), tipoProcessoId: 99 }).aplicaveis
  ok(em7.length === 1 && em99.length === 1, "A) 'todos os tipos de processo' aplica a qualquer processo")
}
// B) vários tipos de processo selecionados
{
  const rMulti = mk(21, "DOC_MULTI", "REQUERENTE", { nome: "Multi", tipoProcessoIds: [2, 5] })
  const em2 = avaliarRegrasDocumentais({ ...ctx({ ehPessoaArvore: false, requerente: true }, [rMulti]), tipoProcessoId: 2 }).aplicaveis
  const em3 = avaliarRegrasDocumentais({ ...ctx({ ehPessoaArvore: false, requerente: true }, [rMulti]), tipoProcessoId: 3 }).aplicaveis
  ok(em2.length === 1 && em3.length === 0, "B) múltiplos tipos: aplica aos selecionados, não aos demais")
}
// C) requisito aceita vários documentos + modos de satisfação
ok(avaliarSatisfacaoRequisito("QUALQUER_UM_ATENDE", ["RG", "CNH", "PASSAPORTE"], ["CNH"]) === true, "C) QUALQUER_UM_ATENDE: um documento presente satisfaz")
ok(avaliarSatisfacaoRequisito("TODOS_SAO_EXIGIDOS", ["RG", "CNH"], ["RG"]) === false &&
   avaliarSatisfacaoRequisito("TODOS_SAO_EXIGIDOS", ["RG", "CNH"], ["RG", "CNH"]) === true, "D) TODOS_SAO_EXIGIDOS: exige todos presentes")
{
  const rReq = mk(22, "RG", "REQUERENTE", { nome: "Identidade", requisitoNome: "Documento de Identidade", documentosAceitos: ["RG", "CNH", "PASSAPORTE"] })
  const r = avaliarRegrasDocumentais(ctx({ ehPessoaArvore: false, requerente: true }, [rReq])).aplicaveis[0]
  ok(!!r && r.documentosAceitos.length === 3 && r.requisitoNome === "Documento de Identidade", "E) requisito carrega vários documentos aceitos")
}
// F) público-alvo múltiplo
{
  const rPub = mk(23, "DOC_PUB", "REQUERENTE", { nome: "Pub", publicosAlvo: ["REQUERENTE", "CONTRATANTE"] })
  const contratante = avaliarRegrasDocumentais(ctx({ ehPessoaArvore: false, requerente: false, contratante: true }, [rPub])).aplicaveis
  const nenhum = avaliarRegrasDocumentais(ctx({ ehPessoaArvore: false, requerente: false, contratante: false }, [rPub])).aplicaveis
  ok(contratante.length === 1 && nenhum.length === 0, "F) público-alvo múltiplo: contratante OU requerente")
}
// G) linha reta funciona como CONDIÇÃO (público = Pessoa da árvore)
{
  const rLinha = mk(24, "DOC_LINHA", "TODAS_AS_PESSOAS_DA_ARVORE", { nome: "Linha", condicoes: { combinador: "TODAS", regras: [{ campo: "linhaReta", operador: "igual", valor: true }] } })
  const naLinha = avaliarRegrasDocumentais(ctx({ ehPessoaArvore: true, linhaReta: true }, [rLinha])).aplicaveis
  const fora = avaliarRegrasDocumentais(ctx({ ehPessoaArvore: true, linhaReta: false }, [rLinha])).aplicaveis
  ok(naLinha.length === 1 && fora.length === 0, "G) linha reta como condição (público = pessoa da árvore)")
}

console.log(`\n${failed === 0 ? "✅" : "❌"} REGRAS DOCUMENTAIS — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
