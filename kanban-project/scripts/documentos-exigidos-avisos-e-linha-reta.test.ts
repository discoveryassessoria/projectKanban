// scripts/documentos-exigidos-avisos-e-linha-reta.test.ts
// ============================================================================
// PROCESSO 688 (01/10/2026): o usuário marcou Óbito numa pessoa e nada aconteceu — sem aviso, sem confirmação, sem certidão.
// Duas causas, as duas corrigidas aqui:
//   (1) a tela ainda DESCARTAVA a lista de certidões para quem é requerente ou da linha reta (restos de `listaAplicavel` /
//       `!isLinhaReta` depois que a regra passou a valer para QUALQUER pessoa) — a gravação saía com 200 sem a lista;
//   (2) marcar Óbito numa pessoa VIVA (ou Casamento sem casamento) é, por desenho, ignorado — mas ninguém avisava, e a prévia de
//       impacto saltava direto para salvar quando o motor respondia "sem impacto".
//
//   node scripts/ci/gate-build.mjs --so documentos-exigidos-avisos-e-linha-reta
// ============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  deveEnviarDocumentosExigidos, situacaoDosDocumentosMarcados, type CodigoDocumentoExigivel,
} from "../src/lib/genealogia/documentos-exigidos"
import { DocumentosExigidosCampo } from "../src/components/arvore/documentos-exigidos-campo"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(p, "utf8")
/** Tira comentários — um comentário que explica o conserto não pode reprovar a varredura. */
const codigo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const TRES: CodigoDocumentoExigivel[] = ["NAS", "CAS", "OBI"]

secao("1) A gravação INCLUI a lista para requerente / linha reta / qualquer pessoa")
ok("lista mudou (só Nascimento e Casamento → + Óbito) ⇒ vai na gravação, sem olhar a classificação",
  deveEnviarDocumentosExigidos({ precisaDocumentacao: true, gravado: ["NAS", "CAS"], marcados: TRES }) === true)
ok("lista mudou de NULL (regra automática) para só ['NAS','OBI'] ⇒ vai",
  deveEnviarDocumentosExigidos({ precisaDocumentacao: true, gravado: null, marcados: ["NAS", "OBI"] }) === true)
ok("lista vazia ('nenhum documento') ⇒ vai", deveEnviarDocumentosExigidos({ precisaDocumentacao: true, gravado: null, marcados: [] }) === true)
ok("não mexeu (NULL ≡ os três) ⇒ NÃO reenvia (re-salvar pessoa antiga nunca grava a lista cheia)",
  deveEnviarDocumentosExigidos({ precisaDocumentacao: true, gravado: null, marcados: TRES }) === false
  && deveEnviarDocumentosExigidos({ precisaDocumentacao: true, gravado: ["NAS", "OBI"], marcados: ["NAS", "OBI"] }) === false)
ok("caixa 'Precisa de documentação' desligada ⇒ não envia a lista",
  deveEnviarDocumentosExigidos({ precisaDocumentacao: false, gravado: null, marcados: ["NAS"] }) === false)
ok("a função NÃO recebe a classificação da pessoa (assinatura só com os três campos)",
  /deveEnviarDocumentosExigidos\(args: \{\s*precisaDocumentacao: boolean\s*gravado: unknown\s*marcados: readonly CodigoDocumentoExigivel\[\]\s*\}\)/.test(ler("src/lib/genealogia/documentos-exigidos.ts")))

secao("2) Varredura SEM diferenciar maiúsculas/minúsculas: nenhum resto da condição antiga em todo o código")
function arquivos(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) { if (nome !== "node_modules" && nome !== ".next") arquivos(p, acc) }
    else if (/\.(ts|tsx)$/.test(nome)) acc.push(p)
  }
  return acc
}
const todos = [...arquivos("src"), ...arquivos("lib")]
const achados = (re: RegExp) => todos.filter((p) => re.test(codigo(ler(p)))).map((p) => p.replace(/^.*?(src|lib)\//, "$1/"))
const restoListaAplicavel = achados(/listaaplicavel/i)
ok("nenhum arquivo usa `listaAplicavel` (em qualquer caixa)", restoListaAplicavel.length === 0, restoListaAplicavel.join(", "))
const restoCondicao = achados(/documentosExigidos[^\n]{0,160}(islinharet|ehrequerente|!\s*isLinhaReta)|(islinharet|ehrequerente)[^\n]{0,160}documentosExigidos/i)
ok("nenhuma linha liga `documentosExigidos` a `isLinhaReta` / `ehRequerente` (em qualquer caixa)", restoCondicao.length === 0, restoCondicao.join(", "))
ok("o campo da tela nunca é desabilitado por classificação (sem `aplicavel`)", !/aplicavel/i.test(codigo(ler("src/components/arvore/documentos-exigidos-campo.tsx"))))
const view = codigo(ler("src/components/arvore/arvore-genealogica-view.tsx"))
ok("Editar: decide enviar por `deveEnviarDocumentosExigidos` e manda `documentosExigidos` quando mudou", /const documentosExigidosMudou = deveEnviarDocumentosExigidos\(/.test(view) && /\.\.\.\(documentosExigidosMudou \? \{ documentosExigidos: docsMarcados \} : \{\}\)/.test(view))
ok("Adicionar: decide enviar por `deveEnviarDocumentosExigidos` (sem `!isLinhaReta`)", /if \(deveEnviarDocumentosExigidos\(\{ precisaDocumentacao, gravado: null, marcados: docsMarcados \}\)\) body\.documentosExigidos = docsMarcados/.test(view))
ok("as duas modais passam os fatos da pessoa ao campo", (view.match(/<DocumentosExigidosCampo marcados=\{docsMarcados\} onChange=\{setDocsMarcados\} fatos=\{fatosDocs\} \/>/g) ?? []).length === 2)
ok("Editar: fatos = falecida (isFalecido) + casamento (casada E com cônjuge)", /const fatosDocs = \{ falecida: isFalecido, temCasamento: isCasado && conjugeSelecionadoId != null \}/.test(view))
ok("Adicionar: fatos = falecida + união que nasce (cônjuge de alguém, ou casada com cônjuge escolhido)", /const fatosDocs = \{ falecida: isFalecido, temCasamento: Boolean\(\(type === 'conjuge' && conjugeDePessoaId\) \|\| \(isCasado && conjugeId\)\) \}/.test(view))

secao("3) Óbito marcado em pessoa VIVA ⇒ aviso específico; em pessoa FALECIDA ⇒ será gerado")
const viva = situacaoDosDocumentosMarcados(TRES, { falecida: false, temCasamento: true })
const obiViva = viva.find((d) => d.code === "OBI")!
ok("pessoa viva + Óbito marcado: NÃO será gerado", obiViva.gera === false)
ok("o aviso é a frase combinada, palavra por palavra", obiViva.aviso === "Esta pessoa está viva na árvore, então este documento não será gerado. Marque 'Pessoa falecida' para gerá-lo.", String(obiViva.aviso))
ok("o motivo da prévia: 'esta pessoa está viva na árvore'", obiViva.porque === "esta pessoa está viva na árvore")
const falecida = situacaoDosDocumentosMarcados(TRES, { falecida: true, temCasamento: true })
const obiFalecida = falecida.find((d) => d.code === "OBI")!
ok("pessoa falecida + Óbito marcado: SERÁ gerado, sem aviso", obiFalecida.gera === true && obiFalecida.aviso === null && obiFalecida.porque === null)
ok("Nascimento sempre 'será gerado' (depende só da regra automática)", viva.find((d) => d.code === "NAS")!.gera === true)
const semCas = situacaoDosDocumentosMarcados(TRES, { falecida: true, temCasamento: false }).find((d) => d.code === "CAS")!
ok("Casamento sem casamento na árvore: não será gerado, com a instrução (marcar casada e escolher o cônjuge)", semCas.gera === false && /não tem casamento cadastrado na árvore/.test(semCas.aviso ?? "") && /Marque 'Pessoa casada' e escolha o cônjuge/.test(semCas.aviso ?? ""))
ok("Casamento com cônjuge: será gerado", situacaoDosDocumentosMarcados(TRES, { falecida: false, temCasamento: true }).find((d) => d.code === "CAS")!.gera === true)
ok("documento DESMARCADO não aparece (nem gera aviso)", situacaoDosDocumentosMarcados(["NAS"], { falecida: false, temCasamento: false }).map((d) => d.code).join() === "NAS")

secao("4) A TELA mostra o aviso (renderização real do campo) — e o parágrafo genérico saiu")
const html = (marcados: CodigoDocumentoExigivel[], fatos: { falecida: boolean; temCasamento: boolean }) =>
  renderToStaticMarkup(createElement(DocumentosExigidosCampo, { marcados, onChange: () => {}, fatos }))
const htmlViva = html(TRES, { falecida: false, temCasamento: true })
ok("viva + Óbito marcado: o aviso do Óbito está na tela", /data-testid="documentos-exigidos-aviso-OBI"/.test(htmlViva) && htmlViva.includes("Esta pessoa está viva na árvore, então este documento não será gerado."))
ok("o aviso cita a instrução: marcar 'Pessoa falecida'", htmlViva.includes("Marque &#x27;Pessoa falecida&#x27; para gerá-lo.") || htmlViva.includes("Marque 'Pessoa falecida' para gerá-lo."))
ok("com casamento e vivo, só o Óbito avisa (Casamento e Nascimento não)", !/aviso-CAS/.test(htmlViva) && !/aviso-NAS/.test(htmlViva))
const htmlFalecida = html(TRES, { falecida: true, temCasamento: true })
ok("falecida + Óbito marcado: NENHUM aviso", !/data-testid="documentos-exigidos-aviso-/.test(htmlFalecida))
ok("viva com Óbito DESMARCADO: sem aviso (não há o que avisar)", !/aviso-OBI/.test(html(["NAS", "CAS"], { falecida: false, temCasamento: true })))
ok("sem casamento: aviso do Casamento aparece", /aviso-CAS/.test(html(TRES, { falecida: true, temCasamento: false })))
ok("o parágrafo genérico saiu da tela", !/A lista só retira o que a árvore já pede/.test(htmlViva) && !/NÃO volta sozinho/.test(htmlViva))
ok("todas as caixas HABILITADAS (nenhuma `disabled`) — linha reta e requerente escolhem livremente", !/disabled/.test(htmlViva))

secao("5) A PRÉVIA de impacto lista cada certidão e não pula mais o salvar escondido")
const prev = codigo(ler("src/components/arvore/inteligencia/preview-impacto.tsx"))
ok("a proposta carrega `certidoesEscolhidas` (será gerado / não será gerado, porque …)", /certidoesEscolhidas\?: Array<\{ code: string; rotulo: string; gera: boolean; porque: string \| null \}>/.test(prev))
ok("a seção 'Certidões marcadas para esta pessoa' mostra 'será gerado' e 'não será gerado, porque …'", /Certidões marcadas para esta pessoa/.test(prev) && /será gerado/.test(prev) && /não será gerado, porque/.test(prev))
ok("o atalho 'sem impacto → salva direto' NÃO dispara quando há certidões a mostrar (era o 'nada apareceu')", /corpo\.semImpacto && onSemImpactoRef\.current && !semImpactoDisparado\.current && !\(proposta\.certidoesEscolhidas\?\.length\)/.test(prev))
ok("Editar monta `certidoesEscolhidas` com a mesma regra pura quando a lista mudou", /certidoesEscolhidas: documentosExigidosMudou\s*\?\s*situacaoDosDocumentosMarcados\(docsMarcados, fatosDocs\)/.test(view))

secao("Preview de impacto: escopo explícito (print 01/10/2026 — 'falam 3 documentos mas eu selecionei 1')")
const previewSrc = codigo(ler("src/components/arvore/inteligencia/preview-impacto.tsx").replace(/\/\/[^\n]*/g, ""))
ok("'Como fica' declara que soma todas as pessoas do processo", /Como fica o processo inteiro/.test(previewSrc) && /preview-como-fica-escopo/.test(previewSrc) && /todas as pessoas/.test(previewSrc))
ok("'Certidões marcadas' declara que é só da pessoa e que Casamento é da união", /Só os documentos desta pessoa/.test(previewSrc) && /Casamento é da união/.test(previewSrc))

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
