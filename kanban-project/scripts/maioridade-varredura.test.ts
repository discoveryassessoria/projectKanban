// scripts/maioridade-varredura.test.ts
//
// VARREDURA: NENHUM LEITOR DA CLASSIFICAÇÃO IGNORA A FUNÇÃO ÚNICA.
//
// "Maior/menor de idade" tem UM dono (`src/lib/documentos/maioridade.ts`). Quem
// decide ou exibe isso precisa chamar a função — comparar `requerente === 'maior'`
// à mão, refazer a conta de 18 anos ou subtrair 18 de `getFullYear()` é o que
// faria motor, financeiro, relatório e telas discordarem sobre a MESMA pessoa
// (a lição do bug `listaAplicavel`: a regra existia em N lugares).
//
// Teste PURO sobre o código-fonte. Três frentes:
//   A) todo leitor conhecido importa a função única;
//   B) ninguém compara o marcador 'maior'/'menor' à mão (exceção: semântica de
//      "requerente PRINCIPAL", listada com o motivo);
//   C) ninguém refaz a aritmética de 18 anos.

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log("  ✅", m) } else { fail++; console.log("  ❌", m) } }
const RAIZ = join(__dirname, "..")
const src = (p: string) => readFileSync(join(RAIZ, p), "utf8")

function arquivos(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(join(RAIZ, dir))) {
    const rel = join(dir, nome)
    const st = statSync(join(RAIZ, rel))
    if (st.isDirectory()) {
      if (nome === "node_modules" || nome === ".next" || nome === "generated") continue
      arquivos(rel, acc)
    } else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome)) acc.push(rel)
  }
  return acc
}
const CODIGO = [...arquivos("src"), ...arquivos("lib")]
const DONO = "src/lib/documentos/maioridade.ts"

console.log("\nA) leitores conhecidos usam a função única")
const LEITORES: Array<[string, string]> = [
  ["src/services/genealogia/materializar-genealogia.ts", "contexto do motor documental (maiorDeIdade/idade das regras)"],
  ["src/components/arvore/react-flow-tree.tsx", "selo do card da árvore"],
  ["src/components/arvore/arvore-genealogica-view.tsx", "formulário adicionar/editar pessoa (seletor some com data)"],
  ["src/components/arvore/tree-onboarding.tsx", "onboarding da árvore"],
  ["src/components/arvore/campos-nascimento.tsx", "selo calculado dos formulários"],
  ["src/components/arvore/pessoa-sidebar.tsx", "painel lateral da pessoa"],
  ["src/components/arvore/requerente-selector.tsx", "faixa Adulto/Menor ao vincular requerente"],
  ["src/components/kanban/PessoaOperacionalDrawer.tsx", "rótulo da linhagem no drawer"],
  ["src/app/api/financeiro/receitas/[id]/detalhe/route.ts", "status familiar dos requerentes da receita"],
  ["src/lib/genealogia/motor/linhagens.ts", "marca 'menor' da linhagem"],
  ["lib/financeiro/distribuicao/redistribuir-service.ts", "menor não pode ser removido da distribuição"],
  ["lib/financeiro/templateEngine.ts", "divisão financeira adulto/menor"],
  ["src/lib/relatorios/motor/dominios/requerentes.ts", "filtro 'menor de idade' e faixa etária"],
  ["src/lib/relatorios/motor/dominios/_comuns.ts", "idade derivada dos relatórios"],
  ["src/lib/requisitos/completude.ts", "requisito por faixa etária"],
  ["src/services/genealogia/avisos-maioridade.ts", "aviso de 18 anos durante o processo"],
]
for (const [arq, papel] of LEITORES) {
  chk(/@\/src\/lib\/documentos\/maioridade["']/.test(src(arq)), `${arq} importa a função única — ${papel}`)
}
chk(/classificarMaioridade/.test(src("src/components/arvore/react-flow-tree.tsx")), "o card calcula com classificarMaioridade")
chk(/maioridadeEhManual/.test(src("src/components/arvore/arvore-genealogica-view.tsx")), "o formulário esconde o seletor quando há data (maioridadeEhManual)")
chk(/marcadorRequerenteParaGravar/.test(src("src/components/arvore/arvore-genealogica-view.tsx")), "o formulário grava o marcador calculado")
chk(/classificarMaioridade/.test(src("src/services/genealogia/materializar-genealogia.ts")) || /maioridadeEfetiva/.test(src("src/services/genealogia/materializar-genealogia.ts")), "o motor documental usa a política")
chk(/<AvisoMaioridadeProcesso/.test(src("src/components/kanban/atividade-details-modal.tsx")), "a tela do processo exibe o aviso de maioridade")

console.log("\nB) ninguém compara o marcador 'maior'/'menor' à mão")
// Comparação direta do marcador gravado, ou filtro de banco por ele.
const COMPARA = /(requerente|marca|flagRequerente)\s*[!=]==?\s*['"](maior|menor)['"]/
const FILTRA = /requerente\s*:\s*['"](maior|menor)['"]/
// Exceção legítima: 'maior' aqui significa "requerente PRINCIPAL da árvore" (quem
// ancora a linhagem), não maioridade. O auto-principal é atribuído em
// vincular-requerente.ts e lido nas estatísticas do processo.
const EXCECOES: Record<string, string> = {
  "src/app/api/processos/[processoId]/estatisticas/route.ts": "lê o requerente PRINCIPAL (marcador 'maior' = principal), não a maioridade",
  "lib/genealogia/vincular-requerente.ts": "atribui/consulta o requerente PRINCIPAL (auto-principal)",
  "src/services/processo-requerentes.ts": "dono único do vínculo: consulta o requerente PRINCIPAL (auto-principal ao marcar)",
}
const infratores: string[] = []
for (const arq of CODIGO) {
  if (arq === DONO || EXCECOES[arq]) continue
  const linhas = src(arq).split("\n")
  linhas.forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return
    if (COMPARA.test(l) || FILTRA.test(l)) infratores.push(`${arq}:${i + 1}  ${l.trim().slice(0, 110)}`)
  })
}
chk(infratores.length === 0, `nenhum leitor compara o marcador à mão${infratores.length ? "\n      " + infratores.join("\n      ") : ""}`)
for (const [arq, motivo] of Object.entries(EXCECOES)) chk(src(arq).length > 0, `exceção documentada: ${arq} — ${motivo}`)

console.log("\nC) ninguém refaz a conta de 18 anos")
const idadeLiteral: string[] = []
for (const arq of CODIGO) {
  if (arq === DONO) continue
  src(arq).split("\n").forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return
    const idadeCom18 = /(idade|anos|age)\w*\s*(<|>=|<=|>)\s*(17|18)\b/i.test(l) || /\b(17|18)\s*(<|>=|<=|>)\s*\w*(idade|anos|age)/i.test(l)
    const subtrai18 = /(setFullYear|getFullYear|getUTCFullYear)\([^)]*\)\s*-\s*18\b/.test(l) || /setFullYear\([^)]*-\s*18\)/.test(l)
    if (idadeCom18 || subtrai18) idadeLiteral.push(`${arq}:${i + 1}  ${l.trim().slice(0, 110)}`)
  })
}
chk(idadeLiteral.length === 0, `nenhuma comparação de idade com 18 fora da política${idadeLiteral.length ? "\n      " + idadeLiteral.join("\n      ") : ""}`)
const contaPropria: string[] = []
for (const arq of CODIGO) {
  if (arq === DONO) continue
  src(arq).split("\n").forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return
    // aritmética de idade por ano de calendário: hoje.getFullYear() - nascimento.getFullYear()
    if (/\b(hoje|referencia|agora|now)\.getFullYear\(\)\s*-\s*\w+\.getFullYear\(\)/.test(l)
      && /(nasc|dn\b|\bn\b|birth)/i.test(l)) contaPropria.push(`${arq}:${i + 1}  ${l.trim().slice(0, 110)}`)
  })
}
chk(contaPropria.length === 0, `ninguém recalcula idade por getFullYear() com data de nascimento${contaPropria.length ? "\n      " + contaPropria.join("\n      ") : ""}`)

console.log(`\n${ok} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
