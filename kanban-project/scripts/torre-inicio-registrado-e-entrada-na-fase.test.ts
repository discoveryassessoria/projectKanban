// scripts/torre-inicio-registrado-e-entrada-na-fase.test.ts
// ============================================================================
// TORRE NOVA, ETAPA A (01/10/2026) — "INICIOU EM" DAQUI PARA FRENTE e ENTRADA NA FASE (função canônica única).
//
//   npx tsx scripts/torre-inicio-registrado-e-entrada-na-fase.test.ts   (banco de teste)
//
// PROVA:
//   • ao INICIAR (iniciar-lote / iniciarEnvioDaTarefa / iniciarTarefa) grava `Tarefa.dataInicio`, `PhaseWorkflowStepInstance.startedAt` e a
//     `StepExecution.startedAt` da tentativa vigente — SÓ SE VAZIOS (nunca sobrescreve, idempotente);
//   • NENHUM registro antigo é tocado: a tarefa que ninguém iniciou segue com `dataInicio` nulo, e `iniciouEm` mostra `null` ("—");
//   • `iniciouEm` chega na linha da Operação (LinhaGerencial) e da Torre (LinhaDaTorre);
//   • `entradaNaFase(processoId, faseKey)` é a função única: `diasNaFaseAtual` a USA (não duplica), vale para fase atual e anteriores,
//     ignora BLOQUEADO, e sem registro devolve `null` (nunca "agora");
//   • TODA transição de fase grava a data: `executarPlano` escreve `faseAtualKey` e a `PhaseAdvanceLog` na MESMA transação.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-inicio-registrado-e-entrada-na-fase.test.ts")

import { readFileSync } from "node:fs"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { iniciarEnvioDaTarefa } from "../src/services/iniciar-envio"
import { iniciarTarefa } from "../lib/operacional/tarefa-comandos"
import { registrarInicioDoTrabalho } from "../src/services/task-step-sync"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { visaoGerencial } from "../lib/operacional/tarefa-projecoes"
import { entradaNaFase, diasNaFaseAtual } from "../lib/operacional/metricas-processo"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORREA_INI"
const ler = (p: string) => readFileSync(p, "utf8")
const H = 3_600_000

async function main() {
  const c = await montarCenario(MARCA)
  try {
    const admin = await prisma.usuario.create({ data: { nome: `${MARCA} Admin`, email: `${MARCA.toLowerCase()}-admin@t.com`, senha: "x", tipo: "admin" } })
    const orgao = await c.novoOrgao("Cartório do início")
    const agora = new Date()
    const estado = async (o: { tarefaId: number; stepInstanceId: number }) => {
      const t = await prisma.tarefa.findUniqueOrThrow({ where: { id: o.tarefaId }, select: { dataInicio: true } })
      const p = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: o.stepInstanceId }, select: { startedAt: true } })
      const e = await prisma.stepExecution.findMany({ where: { stepInstanceId: o.stepInstanceId, supersededAt: null }, select: { startedAt: true } })
      return { tarefa: t.dataInicio, passo: p.startedAt, tentativas: e.map((x) => x.startedAt) }
    }

    secao("registro ANTIGO: ninguém iniciou → nada é preenchido, e a tela mostra '—'")
    const antiga = await c.novaObrigacao({ responsavelId: admin.id, orgaoId: orgao.id })
    const antes = await estado(antiga)
    ok("tarefa que ninguém iniciou: dataInicio e startedAt do passo nulos", antes.tarefa === null && antes.passo === null)
    const linhaAntiga = (await listarTarefasDaTorre({}, agora)).linhas.find((l) => l.taskId === antiga.tarefaId)
    ok("LinhaDaTorre.iniciouEm = null (a tela mostra '—'/'não iniciou')", linhaAntiga != null && linhaAntiga.iniciouEm === null)

    secao("INICIAR pelo lote / Torre (iniciarEnvioDaTarefa) grava o início, e só dessa tarefa")
    const outra = await c.novaObrigacao({ responsavelId: admin.id, orgaoId: orgao.id })
    const t0 = Date.now()
    const r = await iniciarEnvioDaTarefa({ tarefaId: antiga.tarefaId, usuario: { userId: admin.id, tipo: "admin" } })
    ok("iniciar pelo motor funcionou", r.ok === true, JSON.stringify(r))
    const depois = await estado(antiga)
    ok("Tarefa.dataInicio gravada (agora)", depois.tarefa != null && depois.tarefa.getTime() >= t0 - 1000 && depois.tarefa.getTime() <= Date.now() + 1000)
    ok("início do PASSO (PhaseWorkflowStepInstance.startedAt) gravado", depois.passo != null)
    ok("início da TENTATIVA vigente (StepExecution.startedAt) gravado", depois.tentativas.length >= 1 && depois.tentativas.every((x) => x != null), JSON.stringify(depois.tentativas))
    const eOutra = await estado(outra)
    ok("a OUTRA tarefa (não iniciada) NÃO foi tocada", eOutra.tarefa === null && eOutra.passo === null)
    const linhas = (await listarTarefasDaTorre({}, agora)).linhas
    ok("iniciouEm chega na LinhaDaTorre (ISO) para a iniciada e é null para a outra", linhas.find((l) => l.taskId === antiga.tarefaId)?.iniciouEm === depois.tarefa!.toISOString() && linhas.find((l) => l.taskId === outra.tarefaId)?.iniciouEm === null)
    const gerencial = (await visaoGerencial({}, agora)).linhas
    ok("…e na LinhaGerencial (a projeção da Operação) — mesma fonte", gerencial.find((l) => l.taskId === antiga.tarefaId)?.iniciouEm === depois.tarefa!.toISOString() && gerencial.find((l) => l.taskId === outra.tarefaId)?.iniciouEm === null)

    secao("idempotente e NUNCA sobrescreve")
    const mais = await registrarInicioDoTrabalho(antiga.stepInstanceId, new Date(Date.now() + 5 * H))
    ok("a 2ª chamada não muda nada (nem tarefa, nem passo, nem tentativa)", mais.tarefa === false && mais.passo === false && mais.tentativa === false)
    const igual = await estado(antiga)
    ok("os instantes continuam os mesmos", igual.tarefa!.getTime() === depois.tarefa!.getTime() && igual.passo!.getTime() === depois.passo!.getTime())
    const veterana = await c.novaObrigacao({ responsavelId: admin.id, orgaoId: orgao.id })
    const dataVelha = new Date(agora.getTime() - 40 * 24 * H)
    await prisma.tarefa.update({ where: { id: veterana.tarefaId }, data: { dataInicio: dataVelha } })
    await iniciarEnvioDaTarefa({ tarefaId: veterana.tarefaId, usuario: { userId: admin.id, tipo: "admin" } })
    ok("tarefa que JÁ tinha dataInicio mantém a original (não vira 'agora')", (await estado(veterana)).tarefa?.getTime() === dataVelha.getTime())

    secao("INICIAR pela porta do comando (iniciarTarefa) — o passo e a tarefa começam juntos")
    const viaComando = await c.novaObrigacao({ responsavelId: admin.id })
    const rc = await iniciarTarefa({ tarefaId: viaComando.tarefaId, autorId: admin.id })
    const eCmd = await estado(viaComando)
    ok("iniciarTarefa: dataInicio, startedAt do passo e da tentativa preenchidos", rc.ok === true && eCmd.tarefa != null && eCmd.passo != null && eCmd.tentativas.every((x) => x != null), JSON.stringify({ rc, eCmd }))

    secao("nada em massa: só as tarefas que foram iniciadas agora têm início")
    const comInicio = await prisma.tarefa.findMany({ where: { processoId: { in: [antiga.processoId, outra.processoId, veterana.processoId, viaComando.processoId] }, dataInicio: { not: null } }, select: { id: true } })
    ok("exatamente as 3 que passaram por uma porta de início (a 'antiga' iniciada agora, a veterana e a do comando) — a 'outra' segue sem", comInicio.map((x) => x.id).sort().join() === [antiga.tarefaId, veterana.tarefaId, viaComando.tarefaId].sort().join())
    const src = ler("src/services/task-step-sync.ts")
    const corpo = /export async function registrarInicioDoTrabalhoTx[\s\S]*?\n}\n/.exec(src)?.[0] ?? ""
    ok("a escrita é updateMany COM a condição 'vazio' nos três lugares (nunca sobrescreve, nunca em massa)", (corpo.match(/updateMany/g) ?? []).length === 3 && /startedAt: null/.test(corpo) && /dataInicio: null/.test(corpo) && /workflowStepInstanceId: stepInstanceId/.test(corpo) && !/status/.test(corpo.replace(/\/\/[^\n]*/g, "")))
    ok("o hook mora na porta da subtarefa (concluirSubtarefaCorrentePeloPasso), uma vez", (ler("src/services/subtarefas-da-etapa.ts").match(/registrarInicioDoTrabalho\(/g) ?? []).length === 1)

    secao("ENTRADA NA FASE — função canônica única")
    const p = await c.novaObrigacao({})
    let seq = 0
    const log = (resultado: "AVANCADO" | "FORCADO" | "MOVIDO" | "BLOQUEADO", de: string, para: string, quando: Date) =>
      prisma.phaseAdvanceLog.create({ data: { processoId: p.processoId, faseAtual: de, fasePretendida: para, regrasAvaliadas: [], pendencias: [], resultado, origem: "teste", correlationId: `${MARCA}-${++seq}`, chaveIdempotencia: `${MARCA}-mov-${seq}`, criadoEm: quando } })
    ok("fase SEM nenhum registro e que não é a primeira → desde=null (nunca 'agora')", (await entradaNaFase(p.processoId, "fase_sem_registro")).desde === null)
    await log("AVANCADO", "genealogia", "emissao_documental", new Date(agora.getTime() - 50 * H))
    await log("AVANCADO", "emissao_documental", "analise_documental", new Date(agora.getTime() - 10 * H))
    await log("BLOQUEADO", "analise_documental", "apostilamento", new Date(agora.getTime() - 2 * H))
    await prisma.processo.update({ where: { id: p.processoId }, data: { faseAtualKey: "analise_documental" } })
    const e1 = await entradaNaFase(p.processoId, "emissao_documental")
    ok("uma fase ANTERIOR: a data em que entrou nela (50 h atrás), origem AVANCO_DE_FASE", e1.origem === "AVANCO_DE_FASE" && Math.abs(Date.parse(e1.desde!) - (agora.getTime() - 50 * H)) < 1000)
    const e2 = await entradaNaFase(p.processoId, "analise_documental")
    ok("a fase ATUAL: 10 h atrás", Math.abs(Date.parse(e2.desde!) - (agora.getTime() - 10 * H)) < 1000)
    ok("BLOQUEADO não conta como entrada (apostilamento nunca foi alcançada)", (await entradaNaFase(p.processoId, "apostilamento")).desde === null)
    const d = await diasNaFaseAtual(p.processoId, agora)
    ok("diasNaFaseAtual USA a função única: mesma data, mesma origem", d.desde === e2.desde && d.origem === e2.origem && d.horas === 10)
    const fonte = ler("lib/operacional/metricas-processo.ts")
    ok("não há segunda leitura de PhaseAdvanceLog para 'entrada' (uma só, dentro de entradaNaFaseDoProcesso)", (fonte.match(/phaseAdvanceLog\.findFirst/g) ?? []).length === 1 && /entradaNaFaseDoProcesso\(processoId, fase, proc\)/.test(fonte))
    ok("processo inexistente → sem data", (await entradaNaFase(99999999, "genealogia")).desde === null)

    secao("TODA transição de fase grava a data (a PhaseAdvanceLog na MESMA transação em que escreve faseAtualKey)")
    const motor = ler("src/lib/motor/phase-advance.ts")
    const tx = /await prisma\.\$transaction\(async \(tx\) => \{[\s\S]*?\n    \}, /.exec(motor)?.[0] ?? ""
    ok("executarPlano: dentro da MESMA $transaction há o update de faseAtualKey e o phaseAdvanceLog.create", /faseAtualKey: p\.novaFaseAtualKey/.test(tx) && /tx\.phaseAdvanceLog\.create/.test(tx) && /fasePretendida: p\.novaFaseAtualKey/.test(tx))
    ok("e o resultado gravado vem da operação (AVANCADO/FORCADO/REABERTO/RETORNADO/MOVIDO) — nenhuma transição fica sem linha", /resultado: resultadoEnum/.test(tx))
    const escritores = ["lib", "src"].flatMap((dir) => {
      const achados: string[] = []
      const andar = (d: string) => { for (const n of require("node:fs").readdirSync(d) as string[]) { if (n === "node_modules" || n.startsWith(".")) continue; const f = `${d}/${n}`; if (require("node:fs").statSync(f).isDirectory()) andar(f); else if (/\.(ts|tsx)$/.test(n)) { const s = ler(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1"); if (/processo\.(update|updateMany)\(\{[^)]*?data:\s*\{[^}]*faseAtualKey/.test(s)) achados.push(f) } } }
      andar(dir); return achados
    })
    ok("nenhum outro lugar do código escreve Processo.faseAtualKey por update (só o motor de fase)", escritores.every((f) => f === "src/lib/motor/phase-advance.ts"), escritores.join(", "))
  } finally {
    await prisma.phaseAdvanceLog.deleteMany({ where: { correlationId: { startsWith: MARCA } } })
    await c.limpar()
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
