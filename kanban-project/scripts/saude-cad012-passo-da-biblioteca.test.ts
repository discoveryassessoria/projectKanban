// scripts/saude-cad012-passo-da-biblioteca.test.ts
// CAD-012 (30/09/2026, autorizado): passo SELECIONADO DA BIBLIOTECA executa pelo conteúdo CONGELADO do Modelo —
// as linhas locais ficam vazias por desenho. A verificação passou a ler o congelado (falso positivo em Apostilamento
// e Retificação), MAS um passo local sem ação continua sendo acusado.
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("saude-cad012-passo-da-biblioteca.test.ts")

import { readFileSync } from "node:fs"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { temCadastroOperacional } from "../lib/saude/verificacoes/cadastro-do-passo"
import { verificacaoPorCodigo } from "../lib/saude/catalogo"
import "../lib/saude/verificacoes/cadastro-execucao"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n} ${extra}`) } }
const vazio = { acoes: [], campos: [], checkItens: [], subtarefas: [] }
const MARCA = "TCAD12"

async function main() {
  console.log("A conta pura")
  ok("passo local SEM nada e sem Biblioteca → continua acusado", !temCadastroOperacional(vazio, null))
  ok("passo local com uma ação → tem cadastro", temCadastroOperacional({ ...vazio, acoes: [{}] }, null))
  ok("passo da Biblioteca cujo congelado tem ação/subtarefa → tem cadastro (o falso positivo)", temCadastroOperacional(vazio, { acoes: [], subtarefas: [{}, {}] }))
  ok("passo da Biblioteca cujo congelado também está vazio → continua acusado", !temCadastroOperacional(vazio, { acoes: [], campos: [], checkItens: [], subtarefas: [] }))
  ok("passo da Biblioteca que não resolve (congelado null) → continua acusado", !temCadastroOperacional(vazio, null))

  console.log("\nA verificação de verdade (banco de teste)")
  const c = await montarCenario(MARCA)
  try {
    await c.novaObrigacao({}) // a fase do cenário "já rodou" (tem PhaseWorkflowInstance)
    await prisma.catalogoFase.upsert({ where: { phaseKey: c.PHASE_KEY }, update: { conduzidaPeloWorkflowInterno: true }, create: { phaseKey: c.PHASE_KEY, label: c.PHASE_KEY, conduzidaPeloWorkflowInterno: true } })
    const wf = await prisma.phaseInternalWorkflow.findFirstOrThrow({ where: { wfUid: `${MARCA}-wf` }, select: { id: true } })
    const vazioLocal = await prisma.phaseInternalWorkflowStep.create({ data: { workflowId: wf.id, key: "passo_local_vazio", label: `${MARCA} passo local vazio`, ordem: 9, slaDays: 0, cardinalidade: "PROCESSO" }, select: { id: true } })
    const v = verificacaoPorCodigo("CAD-012")!
    const r = await v.executar({} as never)
    const meus = r.achados.filter((a) => a.registroNome === "passo_local_vazio")
    ok("o passo LOCAL sem ação/campo/checklist/subtarefa CONTINUA sendo acusado", meus.length === 1 && meus[0].chave === `passo-sem-execucao:${vazioLocal.id}`, JSON.stringify(r.metricas))
    ok("o passo do cenário (com subtarefas e ação) NÃO é acusado", !r.achados.some((a) => a.registroNome === "solicitar_certidao" && (a.evidencia as { fase?: string })?.fase === c.PHASE_KEY))
  } finally {
    await prisma.phaseInternalWorkflowStep.deleteMany({ where: { key: "passo_local_vazio" } })
    await prisma.catalogoFase.deleteMany({ where: { phaseKey: c.PHASE_KEY } })
    await c.limpar()
  }

  console.log("\nA verificação usa a versão congelada")
  const src = readFileSync("lib/saude/verificacoes/cadastro-execucao.ts", "utf8")
  ok("CAD-012 resolve o conteúdo da Biblioteca pela versão pinada", src.includes("resolverConteudoDaBiblioteca(p.bibliotecaModeloId, p.bibliotecaModeloVersao)") && src.includes("temCadastroOperacional("))

  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) process.exit(1)
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
