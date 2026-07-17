/**
 * TESTES — Fatia 2: materialização da Genealogia (lógica pura, sem DB).
 * Rodar: tsx scripts/genealogia-materializacao.test.ts
 *
 * Valida: filtro "exigida na Genealogia" (exclui protocolo); contexto canônico da
 * Pessoa (sem legado); e a avaliação por pessoa → requisitos aplicáveis = passos
 * "Buscar documento" que seriam materializados, para os cenários 1..6 da tarefa.
 */
import { avaliarRegrasDocumentais } from "../src/lib/documentos/regras-documentais/avaliador"
import { exigidaNaGenealogia, aplicaAoProcesso, contextoDaPessoa } from "../src/services/genealogia/materializar-genealogia"
import { ehNaturezaCertidao, NATUREZA_CERTIDAO } from "../src/lib/documentos/natureza-certidao"
import type { RegraDocumental } from "../src/lib/documentos/regras-documentais/tipos"

let passed = 0, failed = 0
const falhas: string[] = []
function ok(c: boolean, n: string) { if (c) { passed++; console.log(`  ✅ ${n}`) } else { failed++; falhas.push(n); console.log(`  ❌ ${n}`) } }

const baseR: Omit<RegraDocumental, "id" | "nome" | "codigo" | "documentTypeCode" | "documentosAceitos" | "requisitoNome" | "faseExigencia" | "faseBloqueio" | "publicosAlvo" | "publicoAlvo" | "condicoes"> = {
  descricao: null, status: "PUBLICADA", versao: 1, prioridade: 100, vigenciaInicio: null, vigenciaFim: null,
  aplicaTodosProcessos: true, tipoProcessoIds: [], tipoProcessoId: 0, modalidadeId: null, paisCode: null, regiaoCode: null, tipoProcessoVersao: null,
  modoSatisfacao: "QUALQUER_UM_ATENDE", categoriaCode: null, obrigatoriedade: "OBRIGATORIA",
  bloqueiaConclusaoFase: true, continuaObrigatorioNasFasesSeguintes: true, faseFinalExigencia: null, obrigatorioAteFinalProcesso: false,
  possuiValidade: false, validadeDias: null, exigeDataEmissao: false, renovarQuandoExpirado: false, antecedenciaRenovacaoDias: null,
}
const cert = (id: number, cod: string, doc: string, req: string, cond: RegraDocumental["condicoes"]): RegraDocumental => ({
  ...baseR, id, codigo: cod, nome: cod, requisitoNome: req, documentTypeCode: doc, documentosAceitos: [doc],
  publicosAlvo: ["PESSOA_DA_ARVORE_COM_DOCUMENTACAO"], publicoAlvo: "PESSOA_DA_ARVORE_COM_DOCUMENTACAO",
  faseExigencia: "genealogia", faseBloqueio: "genealogia", condicoes: cond,
})
const req = (id: number, cod: string, doc: string, requisito: string): RegraDocumental => ({
  ...baseR, id, codigo: cod, nome: cod, requisitoNome: requisito, documentTypeCode: doc, documentosAceitos: [doc],
  publicosAlvo: ["REQUERENTE"], publicoAlvo: "REQUERENTE", obrigatorioAteFinalProcesso: true,
  faseExigencia: "protocolado", faseBloqueio: "protocolado",
  condicoes: { combinador: "TODAS", regras: [{ campo: "requerente", operador: "igual", valor: true }] },
})

const R_NASC = cert(1, "GEN_NASC", "IT - NAS", "Certidão de nascimento", { combinador: "TODAS", regras: [{ campo: "precisaDeDocumentacao", operador: "igual", valor: true }] })
const R_CAS = cert(2, "GEN_CAS", "IT - CAS", "Certidão de casamento", { combinador: "TODAS", regras: [{ campo: "precisaDeDocumentacao", operador: "igual", valor: true }, { campo: "casado", operador: "igual", valor: true }] })
const R_OBT = cert(3, "GEN_OBT", "IT - OBI", "Certidão de óbito", { combinador: "TODAS", regras: [{ campo: "precisaDeDocumentacao", operador: "igual", valor: true }, { campo: "falecido", operador: "igual", valor: true }] })
const R_ID = req(4, "REQ_ID", "RG", "Documento de identidade")
const R_END = req(5, "REQ_END", "COMP-RES", "Comprovante de endereço")
const TODAS = [R_NASC, R_CAS, R_OBT, R_ID, R_END]

console.log("\nFiltro: exigida na Genealogia (exclui protocolo)")
const genRules = TODAS.filter((r) => aplicaAoProcesso(r, 5) && exigidaNaGenealogia(r))
ok(genRules.length === 3 && genRules.every((r) => r.faseExigencia === "genealogia"), "só as 3 certidões entram na Genealogia (identidade/comprovante ficam de fora)")

const HOJE = "2026-07-17T12:00:00.000Z"
const aplicar = (ctx: ReturnType<typeof contextoDaPessoa>, regras = genRules) =>
  avaliarRegrasDocumentais({ tipoProcessoId: 5, faseKey: "genealogia", sujeito: ctx, dataReferencia: HOJE, regras })
    .aplicaveis.map((a) => a.requisitoNome).sort()

// contexto canônico da Pessoa (documentacao/casado/vivo/requerente/linhaReta)
const P = (o: Partial<{ documentacao: boolean; casado: boolean; vivo: boolean; requerente: string; linhaReta: boolean }>) =>
  contextoDaPessoa({ id: 1, nome: "T", sobrenome: "T", documentacao: o.documentacao ?? true, casado: o.casado ?? false, vivo: o.vivo ?? true, linhaReta: o.linhaReta ?? true, requerente: o.requerente ?? "nao" })

console.log("\nCenários (requisitos aplicáveis = passos 'Buscar documento' a materializar)")
// 1) documentação, solteira, viva → nascimento (1 passo)
ok(JSON.stringify(aplicar(P({ documentacao: true }))) === JSON.stringify(["Certidão de nascimento"]), "1) só documentação → nascimento (1 passo)")
// 2) casada → nascimento + casamento (2)
ok(JSON.stringify(aplicar(P({ documentacao: true, casado: true })).sort()) === JSON.stringify(["Certidão de casamento", "Certidão de nascimento"]), "2) casada → nascimento + casamento (2 passos)")
// 3) falecida → nascimento + óbito (2)
ok(JSON.stringify(aplicar(P({ documentacao: true, vivo: false })).sort()) === JSON.stringify(["Certidão de nascimento", "Certidão de óbito"]), "3) falecida → nascimento + óbito (2 passos)")
// 4) casada e falecida → nascimento + casamento + óbito (3)
ok(aplicar(P({ documentacao: true, casado: true, vivo: false })).length === 3, "4) casada e falecida → 3 passos")
// 5) requerente com documentação: recebe certidões; identidade/comprovante NÃO na Genealogia
{
  const ctx = P({ documentacao: true, casado: true, requerente: "sim" })
  const naGen = aplicar(ctx)
  const comProtocolo = avaliarRegrasDocumentais({ tipoProcessoId: 5, faseKey: "genealogia", sujeito: ctx, dataReferencia: HOJE, regras: TODAS }).aplicaveis.map((a) => a.requisitoNome)
  ok(naGen.includes("Certidão de nascimento") && naGen.includes("Certidão de casamento") &&
     !naGen.includes("Documento de identidade") && !naGen.includes("Comprovante de endereço"),
     "5) requerente recebe certidões; identidade/comprovante NÃO entram na Genealogia")
  ok(comProtocolo.includes("Documento de identidade"), "   (identidade só aparece quando as regras de protocolo são consideradas)")
}
// 6) sem documentação → nenhuma certidão
ok(aplicar(P({ documentacao: false, casado: true, vivo: false })).length === 0, "6) sem documentação → nenhuma certidão")

console.log("\nReconciliação (mudança de atributo)")
// 7) casada false→true acrescenta casamento sem duplicar nascimento
{
  const antes = aplicar(P({ documentacao: true, casado: false }))
  const depois = aplicar(P({ documentacao: true, casado: true }))
  ok(antes.filter((x) => x === "Certidão de nascimento").length === 1 && depois.filter((x) => x === "Certidão de nascimento").length === 1 && depois.includes("Certidão de casamento"), "7) casada false→true: +casamento, nascimento não duplica")
}
// 8) casada true→false: casamento deixa de ser aplicável (sai do bloqueio na reconciliação)
ok(!aplicar(P({ documentacao: true, casado: false })).includes("Certidão de casamento"), "8) casada true→false: casamento deixa de ser aplicável")

// contexto: requerente string "sim"/"nao"
ok(P({ requerente: "sim" }).requerente === true && P({ requerente: "nao" }).requerente === false, "contexto: requerente string → boolean")

console.log("\nElegibilidade estrutural (natureza CERTIDÃO, sem texto)")
ok(NATUREZA_CERTIDAO === "certidao", "natureza estruturada = 'certidao'")
ok(ehNaturezaCertidao("certidao") && ehNaturezaCertidao("CERTIDAO") && ehNaturezaCertidao(" Certidao "), "certidão reconhecida pela natureza (case/trim)")
ok(!ehNaturezaCertidao("identidade") && !ehNaturezaCertidao("documento") && !ehNaturezaCertidao("apostila") && !ehNaturezaCertidao("traducao") && !ehNaturezaCertidao(null), "identidade/documento/apostila/tradução/null NÃO são certidão")
// estrutural, não textual: um documento chamado "Certidão de X" mas com natureza
// != certidao NÃO passa (a elegibilidade é pela natureza, não pelo nome).
ok(!ehNaturezaCertidao("documento"), "não usa fallback por nome — só a natureza estruturada decide")

console.log(`\n${failed === 0 ? "✅" : "❌"} MATERIALIZAÇÃO GENEALOGIA — ${passed} ok, ${failed} falhas`)
if (failed > 0) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
