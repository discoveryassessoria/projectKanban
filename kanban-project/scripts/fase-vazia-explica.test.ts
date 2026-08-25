// scripts/fase-vazia-explica.test.ts
//
// FASE SEM TRABALHO DIZ O QUE FALTA — e diz de um jeito que dá para ler.
//
// O processo Gerbi foi criado em 12/08/2026 e ficou parado. Sem árvore, sem pessoas,
// sem necessidades: a Genealogia materializou zero passos. O operador abriu e viu uma
// fase vazia.
//
// O sistema SABIA o motivo, e até mandava o texto certo para a tela. Só que assim:
//
//   "…nenhuma entidade do processo se aplica aos passos dele. Tipo inferido de
//    createsTask=true => HUMANO O processo ainda não tem árvore genealógica
//    vinculada, e os passos publicados desta fase operam por entidade da árvore.
//    Crie a árvore e cadastre as pessoas…"
//
// Um diagnóstico de desenvolvedor colado no meio, sem pontuação, e a instrução
// enterrada num parágrafo que ninguém termina de ler. O dado estava certo; a forma
// fazia dele um log.
//
//   npx tsx scripts/fase-vazia-explica.test.ts

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { motivosAcionaveis } from "../src/services/materializar-fase"

const ROOT = join(__dirname, "..")
const read = (r: string) => (existsSync(join(ROOT, r)) ? readFileSync(join(ROOT, r), "utf8") : "")

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

const motivos = [
  { code: "PASSO_TIPO_INFERIDO", message: "Tipo inferido de createsTask=true => HUMANO" },
  { code: "PROCESSO_SEM_ARVORE", message: "O processo ainda não tem árvore genealógica vinculada, e os passos publicados desta fase operam por entidade da árvore. Crie a árvore e cadastre as pessoas: a fase converge sozinha quando elas existirem." },
  { code: "CARDINALIDADE_SEM_ALVO", message: 'Passo "localizar_registro" opera por NECESSIDADE e o processo não tem registro/certidão a localizar — nenhuma instância criada.' },
]

console.log("\nA NOTA DE BASTIDOR SAI DA FRENTE DO OPERADOR")
const acionaveis = motivosAcionaveis(motivos)
check("a decisão interna do motor não vai para a tela",
  !acionaveis.some((m) => m.code === "PASSO_TIPO_INFERIDO"))
check("e as duas instruções continuam", acionaveis.length === 2,
  acionaveis.map((m) => m.code).join(","))
check("nenhuma nota de bastidor foi apagada do relatório — só filtrada na leitura",
  motivos.length === 3)

console.log("\nO QUE FALTA CHEGA COMO LISTA, NÃO COMO PARÁGRAFO")
const painel = read("src/components/kanban/PainelDaFase.tsx")
check("o painel recebe os motivos separados do resumo", painel.includes("oQueFazer?: Array<"))
check("e os desenha um por linha", /oQueFazer!\.map\(\(m\) => \(/.test(painel) && painel.includes("<li"))
check("com destaque de atenção, não como texto solto",
  /border-amber-400\/20/.test(painel.slice(painel.indexOf("oQueFazer!.map") - 400, painel.indexOf("oQueFazer!.map"))))

const central = read("src/components/kanban/ProcessoCentralOperacional.tsx")
check("a Central só monta a lista quando a fase NÃO materializou",
  central.includes('data.materializacao?.estado !== "MATERIALIZADO"') && central.includes("oQueFazer"))

const rota = read("src/app/api/processos/[processoId]/central-operacional/route.ts")
check("e a API já entrega filtrado, para a tela não ter de saber o que é nota interna",
  rota.includes("motivosAcionaveis(rel.motivos)"))

console.log("\nA FRASE ADMINISTRATIVA FICA PONTUADA")
const svc = read("src/services/materializar-fase.ts")
check("cada motivo vira uma frase terminada, em vez de colar no seguinte",
  /\/\[\.\!\?\]\$\/\.test\(m\.message\.trim\(\)\)/.test(svc.replace(/\\/g, "")) ||
  svc.includes('/[.!?]$/.test(m.message.trim())'))
check("e a composição usa só os acionáveis", svc.includes("motivosAcionaveis(motivos)"))

console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
if (falhas.length) { falhas.forEach((f) => console.log(`   · ${f}`)); process.exitCode = 1 }
