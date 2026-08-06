// scripts/genealogia-regras-canonicas.test.ts
//
// REGRAS DOCUMENTAIS CANÔNICAS DA GENEALOGIA.
//
// A premissa antiga — "a Genealogia só materializa certidões" — vivia no motor.
// Agora a fase declara as NATUREZAS que aceita, o tipo documental declara a sua,
// e o motor compara IDs. Estes testes travam as duas metades: a política da fase
// e as seis regras por atributo da pessoa (nunca por posição na árvore).
//
// ⚠ ESCREVE. Banco NÃO-produtivo. Limpa o que cria.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { prisma } from "@/lib/prisma"
import { avaliarRegrasDocumentais } from "@/src/lib/documentos/regras-documentais/avaliador"
import { matrizParaRegra } from "@/src/lib/documentos/regras-documentais/mapear"
import { contextoDaPessoa } from "@/src/services/genealogia/materializar-genealogia"
import { politicaDaFase, resolverTiposDocumentais, naturezaPermitidaNaFase, recebeWorkflowOperacional } from "@/src/lib/documentos/politica-natureza-fase"
import { idadeEmAnos, ehMaiorDeIdade, IDADE_MAIORIDADE, ehRequerente, maioridadeEfetiva } from "@/src/lib/documentos/maioridade"

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log("  ✅", m) } else { fail++; console.log("  ❌", m) } }
const RAIZ = join(__dirname, "..")
const src = (p: string) => readFileSync(join(RAIZ, p), "utf8")
const REF = new Date("2026-08-06T12:00:00Z")

/** Documentos que a avaliação exige para uma pessoa, pelos requisitos aplicáveis. */
function exigidosPara(regras: ReturnType<typeof matrizParaRegra>[], p: Parameters<typeof contextoDaPessoa>[0]): string[] {
  const av = avaliarRegrasDocumentais({
    tipoProcessoId: 0, faseKey: "genealogia",
    sujeito: contextoDaPessoa(p, REF), dataReferencia: REF.toISOString(), regras,
  })
  return av.aplicaveis.map((a) => a.requisitoNome ?? a.documentTypeCode).sort()
}

const pessoa = (o: Partial<Parameters<typeof contextoDaPessoa>[0]>) => ({
  id: 1, nome: "X", sobrenome: "Y", documentacao: true,
  casado: false, vivo: true, linhaReta: true, requerente: "nao",
  data_nasc: new Date("1980-01-01"), ...o,
})

async function main() {
  // ── 1. MAIORIDADE canônica ──────────────────────────────────────────────
  chk(IDADE_MAIORIDADE === 18, "a maioridade é uma constante canônica (18)")
  chk(idadeEmAnos(new Date("2008-08-07"), REF) === 17, "idade em anos COMPLETOS: véspera do aniversário ainda é 17")
  chk(idadeEmAnos(new Date("2008-08-06"), REF) === 18, "no dia do aniversário já é 18")
  chk(ehMaiorDeIdade(null, REF) === null, "sem data de nascimento a maioridade é DESCONHECIDA, não 'menor'")
  const grep = (s: string) => (src(s).match(/>=?\s*18\b/g) ?? []).length
  chk(grep("src/services/genealogia/materializar-genealogia.ts") === 0 && grep("src/lib/documentos/regras-documentais/condicoes.ts") === 0,
    "o 18 não está espalhado — só na política canônica")

  // ── 1b. DOMÍNIO CANÔNICO DE `requerente` ────────────────────────────────
  // O campo vale "sim" | "maior" | "menor" | "nao". Antes só "sim" era
  // reconhecido, e um requerente marcado "maior" — que é o valor real na base —
  // não era alcançado por regra documental nenhuma.
  chk(ehRequerente("sim") && ehRequerente("maior") && ehRequerente("menor"), "sim, maior e menor contam como requerente")
  chk(!ehRequerente("nao") && !ehRequerente(null), "nao e ausente não são requerente")
  chk(maioridadeEfetiva(null, "maior", REF) === true, "sem data de nascimento, o marcador 'maior' resolve a maioridade")
  chk(maioridadeEfetiva(null, "menor", REF) === false, "o marcador 'menor' resolve como menor")
  chk(maioridadeEfetiva(new Date("2015-01-01"), "maior", REF) === false, "a DATA manda sobre o marcador quando existe")
  chk(maioridadeEfetiva(null, "sim", REF) === null, "'sim' não informa idade — fica desconhecido")

  // ── 2. POLÍTICA DA FASE ─────────────────────────────────────────────────
  const pol = await politicaDaFase("genealogia")
  chk(!!pol, "a Genealogia tem política de naturezas")
  chk((pol?.naturezasPermitidas.size ?? 0) >= 3, `a fase aceita mais de uma natureza (${pol?.naturezasPermitidas.size})`)
  const tipos = await resolverTiposDocumentais()
  const porCode = new Map([...tipos.values()].filter((t) => t.code).map((t) => [t.code as string, t]))

  for (const [code, rotulo] of [["IT - NAS", "certidão"], ["RG", "identificação"], ["COMP-RES", "comprovante"], ["OUTRO", "procuração"]] as const) {
    const r = naturezaPermitidaNaFase(pol, porCode.get(code))
    chk(r.permitido, `Genealogia aceita ${rotulo} (${code})${r.permitido ? "" : ` — ${r.detalhe}`}`)
  }
  const inexistente = naturezaPermitidaNaFase(pol, undefined)
  chk(!inexistente.permitido && inexistente.motivo === "TIPO_DOCUMENTAL_INEXISTENTE", "natureza não permitida / tipo inexistente é RECUSADO com motivo nomeado")
  const semPolitica = naturezaPermitidaNaFase({ catalogoFaseId: 0, phaseKey: "x", naturezasPermitidas: new Set() }, porCode.get("IT - NAS"))
  chk(!semPolitica.permitido, "fase sem política declarada não materializa nada (vazio ≠ tudo)")

  // ── 3. WORKFLOW: só quem tem perfil ─────────────────────────────────────
  chk(recebeWorkflowOperacional(porCode.get("IT - NAS")), "certidão RECEBE workflow de emissão (perfil declara)")
  for (const code of ["RG", "CNH", "COMP-RES", "OUTRO"]) {
    chk(!recebeWorkflowOperacional(porCode.get(code)), `${code} NÃO recebe workflow de certidão (sem perfil)`)
  }

  // ── 4. AS SEIS REGRAS, por atributo ─────────────────────────────────────
  const rows = await prisma.matrizDocumental.findMany({ where: { status: "PUBLICADA", codigo: { startsWith: "GEN-" } } })
  chk(rows.length === 6, `seis regras publicadas (${rows.length})`)
  const regras = rows.map(matrizParaRegra)

  const req = (o: object) => pessoa({ requerente: "maior", ...o })
  chk(JSON.stringify(exigidosPara(regras, req({}))) === JSON.stringify(["Certidão de Nascimento", "Comprovante de Endereço", "Documento de identificação", "Procuração Administrativa"]),
    `requerente adulto solteiro vivo: ${exigidosPara(regras, req({})).join(" · ")}`)
  chk(exigidosPara(regras, req({ casado: true })).includes("Certidão de Casamento"), "requerente adulto casado ganha casamento")
  const menor = pessoa({ requerente: "menor", data_nasc: null })
  chk(!exigidosPara(regras, menor).includes("Documento de identificação"), "requerente MENOR não recebe documento de identificação")
  chk(JSON.stringify(exigidosPara(regras, menor)) === JSON.stringify(["Certidão de Nascimento"]), "requerente menor recebe apenas a certidão de nascimento")
  chk(JSON.stringify(exigidosPara(regras, pessoa({ requerente: "maior", data_nasc: null }))) === JSON.stringify(["Certidão de Nascimento", "Comprovante de Endereço", "Documento de identificação", "Procuração Administrativa"]),
    "requerente 'maior' SEM data de nascimento é reconhecido como adulto")

  chk(JSON.stringify(exigidosPara(regras, pessoa({}))) === JSON.stringify(["Certidão de Nascimento"]), "pessoa solteira viva: só nascimento")
  chk(JSON.stringify(exigidosPara(regras, pessoa({ casado: true }))) === JSON.stringify(["Certidão de Casamento", "Certidão de Nascimento"]), "pessoa casada: nascimento + casamento")
  chk(JSON.stringify(exigidosPara(regras, pessoa({ vivo: false }))) === JSON.stringify(["Certidão de Nascimento", "Certidão de Óbito"]), "falecida solteira: nascimento + óbito")
  chk(JSON.stringify(exigidosPara(regras, pessoa({ vivo: false, casado: true }))) === JSON.stringify(["Certidão de Casamento", "Certidão de Nascimento", "Certidão de Óbito"]), "falecida casada: nascimento + casamento + óbito")
  chk(exigidosPara(regras, pessoa({ requerente: "maior" })).includes("Certidão de Nascimento"), "a regra civil alcança TAMBÉM o requerente")

  // ── 5. GRUPO ALTERNATIVO RG ou CNH ──────────────────────────────────────
  const ident = regras.find((r) => r.codigo === "GEN-REQ-IDENT")!
  chk(ident.documentosAceitos.length === 2 && ident.modoSatisfacao === "QUALQUER_UM_ATENDE",
    `RG e CNH são UM requisito com duas opções (${ident.documentosAceitos.join(" ou ")})`)
  const aplicaveisReq = avaliarRegrasDocumentais({ tipoProcessoId: 0, faseKey: "genealogia", sujeito: contextoDaPessoa(req({}), REF), dataReferencia: REF.toISOString(), regras }).aplicaveis
  chk(aplicaveisReq.filter((a) => ["RG", "CNH"].includes(a.documentTypeCode)).length === 1,
    "não gera duas obrigações independentes para RG e CNH")

  // ── 6. ZERO regra por posição, ZERO legado ──────────────────────────────
  const proibidos = ["pai", "mae", "mãe", "avo", "avô", "bisav", "geracao"]
  chk(!rows.some((r) => proibidos.some((p) => (r.nome ?? "").toLowerCase().includes(p) || (r.codigo ?? "").toLowerCase().includes(p))),
    "nenhuma regra por posição genealógica")
  const mat = src("src/services/genealogia/materializar-genealogia.ts")
  chk(!/ehNaturezaCertidao|natureza-certidao/.test(mat), "o materializador não depende mais de 'é certidão?'")
  chk(!/['"]RG['"]|['"]CNH['"]/.test(mat), "o materializador não cita RG nem CNH")
  chk(/naturezaPermitidaNaFase/.test(mat) && /recebeWorkflowOperacional/.test(mat), "o materializador decide por política de fase e por perfil")

  console.log(`\n${ok} passaram, ${fail} falharam`)
}

main().catch((e) => { console.error(e); fail++ }).finally(async () => { await prisma.$disconnect(); process.exit(fail ? 1 : 0) })
