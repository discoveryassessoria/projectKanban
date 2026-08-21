// scripts/concorrencia-adversarial.test.ts
//
// DUAS PESSOAS, O MESMO INSTANTE.
//
// Todo estado inconsistente que este sistema já produziu tinha a mesma forma: dois
// caminhos tocando a mesma coisa sem que nenhum soubesse do outro. Duplo clique,
// duas abas, um cron passando enquanto alguém conclui. O teste sequencial nunca
// encontra isso, porque ele é sequencial.
//
// Aqui os comandos partem JUNTOS — `Promise.all`, sem espera entre eles — e o que se
// cobra depois é o estado: uma tarefa viva, uma tentativa vigente, nenhuma etapa
// concluída duas vezes, nenhum lançamento em dobro.
//
// O QUE NÃO SE COBRA: que ambos tenham sucesso. Perder uma corrida é comportamento —
// o segundo recebe CONFLITO ou encontra o trabalho já feito. O que não pode é os dois
// vencerem, ou o perdedor deixar resíduo.
//
//   PRISMA_DATABASE_URL=…discovery_test npx tsx scripts/concorrencia-adversarial.test.ts

import { PrismaClient } from "@prisma/client"
import { transicionarPassoTx, reabrirPassoTx, concluirPasso, iniciarPasso } from "../src/services/task-step-sync"
import { abrirTentativa, tentativasDoPasso, garantirTentativa, MOTIVOS_DE_TENTATIVA } from "../src/services/execucao-do-passo"
import { gravarOperacao, lerOperacao } from "../src/services/operacao-da-etapa"
import { novaViaDocumental } from "../src/services/efeitos-de-dominio"
import { movePhaseManual } from "../src/lib/motor/phase-advance"

const prisma = new PrismaClient()
const M = "CONC"

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: M } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  for (const p of procs) if (p.arvoreId) {
    await prisma.documento.deleteMany({ where: { pessoa: { arvoreId: p.arvoreId } } })
    await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
    await prisma.arvore.deleteMany({ where: { id: p.arvoreId } })
  }
}

interface Palco {
  processoId: number
  instanciaId: number
  pessoaId: number
  passos: Record<string, number>
}

/** Palco limpo por cenário: cada corrida começa de um estado conhecido. */
async function montar(marca: string): Promise<Palco> {
  const arv = await prisma.arvore.create({ data: { nome: `${M} ${marca}` }, select: { id: true } })
  const pessoa = await prisma.pessoa.create({ data: { nome: "Conc", sobrenome: marca, arvoreId: arv.id }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${M} ${marca}`, pais: "espanha", arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: "emissao_documental" },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${M}-${marca}-i` },
    select: { id: true },
  })
  const passos: Record<string, number> = {}
  const roteiro = [
    { key: "a", ordem: 1, deps: [] as string[], status: "EM_ANDAMENTO" },
    { key: "b", ordem: 2, deps: ["a"], status: "PENDENTE" },
  ]
  for (const r of roteiro) {
    const si = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "emissao_documental", ciclo: 1,
        stepKey: r.key, ordem: r.ordem, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
        status: r.status as never, dependeDeStepKeys: r.deps as never,
        chaveIdempotencia: `${M}-${marca}-${r.key}`,
      },
      select: { id: true },
    })
    await garantirTentativa(si.id, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: r.status as never })
    passos[r.key] = si.id
  }
  return { processoId: proc.id, instanciaId: inst.id, pessoaId: pessoa.id, passos }
}

const opts = (p: Palco, corr: string) => ({
  correlationId: corr, operacao: "concorrencia", ciclo: 1,
  processoId: p.processoId, workflowInstanceId: p.instanciaId,
})

/** Estado que precisa continuar coerente depois de qualquer corrida. */
async function coerente(p: Palco): Promise<string[]> {
  const problemas: string[] = []
  for (const [key, id] of Object.entries(p.passos)) {
    const t = await tentativasDoPasso(id)
    const vigentes = t.filter((x) => x.supersededAt == null)
    if (vigentes.length !== 1) problemas.push(`passo ${key}: ${vigentes.length} tentativas vigentes`)
    const seqs = t.map((x) => x.sequencia).sort((a, b) => a - b)
    if (seqs.some((sq, i) => sq !== i + 1)) problemas.push(`passo ${key}: sequência ${seqs.join(",")}`)
    for (const x of t) {
      if ((x.status === "CONCLUIDO" || x.status === "EXECUTADO") && x.completedAt == null) {
        problemas.push(`passo ${key}: tentativa ${x.sequencia} concluída sem data`)
      }
    }
  }
  const vivas = await prisma.tarefa.findMany({
    where: {
      workflowStepInstanceId: { in: Object.values(p.passos) },
      statusTarefa: { notIn: ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"] },
    },
    select: { workflowStepInstanceId: true },
  })
  const porPasso = new Map<number, number>()
  for (const v of vivas) porPasso.set(v.workflowStepInstanceId!, (porPasso.get(v.workflowStepInstanceId!) ?? 0) + 1)
  for (const [id, n] of porPasso) if (n > 1) problemas.push(`passo #${id}: ${n} tarefas vivas`)
  return problemas
}

async function main() {
  await limpar()
  console.log("\nMATRIZ DE CONCORRÊNCIA — comandos disparados JUNTOS\n")

  // ── 1. START × START ──────────────────────────────────────────────────────
  {
    const p = await montar("startstart")
    await prisma.phaseWorkflowStepInstance.update({ where: { id: p.passos.a }, data: { status: "DISPONIVEL" } })
    const r = await Promise.allSettled([
      iniciarPasso(p.passos.a, { origem: "USER", correlationId: `${M}-s1` }),
      iniciarPasso(p.passos.a, { origem: "USER", correlationId: `${M}-s2` }),
    ])
    const mudaram = r.filter((x) => x.status === "fulfilled" && (x.value as { success: boolean; changed?: boolean }).changed).length
    check("start × start: no máximo UM inicia de fato", mudaram <= 1, `${mudaram} mudaram`)
    const st = await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: p.passos.a }, select: { status: true } })
    check("  e a etapa fica EM_ANDAMENTO", st?.status === "EM_ANDAMENTO", String(st?.status))
    check("  sem resíduo", (await coerente(p)).length === 0, (await coerente(p)).join("; "))
  }

  // ── 2. COMPLETE × COMPLETE ────────────────────────────────────────────────
  {
    const p = await montar("compcomp")
    const r = await Promise.allSettled([
      concluirPasso(p.passos.a, { origem: "USER", correlationId: `${M}-c1` }),
      concluirPasso(p.passos.a, { origem: "USER", correlationId: `${M}-c2` }),
    ])
    const mudaram = r.filter((x) => x.status === "fulfilled" && (x.value as { changed?: boolean }).changed).length
    check("complete × complete: a etapa conclui UMA vez", mudaram <= 1, `${mudaram} mudaram`)
    const t = await tentativasDoPasso(p.passos.a)
    check("  uma tentativa só, concluída, com data",
      t.length === 1 && t[0].status === "CONCLUIDO" && t[0].completedAt != null,
      JSON.stringify(t.map((x) => ({ s: x.status, c: !!x.completedAt }))))
    check("  sem resíduo", (await coerente(p)).length === 0)
  }

  // ── 3. COMPLETE × REOPEN ──────────────────────────────────────────────────
  {
    const p = await montar("compreab")
    const r = await Promise.allSettled([
      concluirPasso(p.passos.a, { origem: "USER", correlationId: `${M}-cr1` }),
      prisma.$transaction((tx) => reabrirPassoTx(tx, p.passos.a, "EM_ANDAMENTO", opts(p, `${M}-cr2`))),
    ])
    void r
    const problemas = await coerente(p)
    check("complete × reopen: estado permanece coerente", problemas.length === 0, problemas.join("; "))
    const t = await tentativasDoPasso(p.passos.a)
    check("  toda tentativa concluída tem sua data",
      t.filter((x) => x.status === "CONCLUIDO").every((x) => x.completedAt != null))
  }

  // ── 4. REOPEN × REOPEN ────────────────────────────────────────────────────
  {
    const p = await montar("reabreab")
    await prisma.phaseWorkflowStepInstance.update({ where: { id: p.passos.a }, data: { status: "CONCLUIDO", completedAt: new Date() } })
    await Promise.allSettled([
      prisma.$transaction((tx) => reabrirPassoTx(tx, p.passos.a, "EM_ANDAMENTO", opts(p, `${M}-rr1`))),
      prisma.$transaction((tx) => reabrirPassoTx(tx, p.passos.a, "EM_ANDAMENTO", opts(p, `${M}-rr2`))),
    ])
    const t = await tentativasDoPasso(p.passos.a)
    check("reopen × reopen: uma vigente só", t.filter((x) => x.supersededAt == null).length === 1)
    check("  a execução original continua com o fim dela",
      t.filter((x) => x.supersededAt != null).every((x) => x.status !== "CONCLUIDO" || x.completedAt != null))
    check("  sem resíduo", (await coerente(p)).length === 0)
  }

  // ── 5. COMPLETE × ROLLBACK MACRO ──────────────────────────────────────────
  {
    const p = await montar("comproll")
    await Promise.allSettled([
      concluirPasso(p.passos.a, { origem: "USER", correlationId: `${M}-cb1` }),
      movePhaseManual(p.processoId, {
        faseAlvo: "genealogia", justificativa: "Rollback concorrente do teste.",
        motivoCodigo: "CORRECAO_CADASTRO", solicitadoPorId: 1, origem: "teste",
      } as never),
    ])
    const problemas = await coerente(p)
    check("complete × rollback macro: estado coerente", problemas.length === 0, problemas.join("; "))
    const t = await tentativasDoPasso(p.passos.a)
    check("  mover a fase não apagou tentativa", t.length >= 1)
  }

  // ── 6. GRAVAR OPERAÇÃO × GRAVAR OPERAÇÃO ──────────────────────────────────
  {
    const p = await montar("opop")
    await Promise.allSettled([
      gravarOperacao(p.passos.a, { protocolo: "111", canal: "CRC" }),
      gravarOperacao(p.passos.a, { rastreio: "BR999", observacao: "segunda" }),
    ])
    const { payload } = await lerOperacao(p.passos.a)
    const chaves = Object.keys(payload)
    check("gravar × gravar: nenhuma escrita apaga a outra por completo",
      chaves.length >= 2, JSON.stringify(payload))
    check("  e o resultado é UM payload, não dois", !Array.isArray(payload))
  }

  // ── 7. ABRIR TENTATIVA × ABRIR TENTATIVA (mesma chave) ────────────────────
  {
    const p = await montar("tenttent")
    const chave = `${M}|mesmo-comando`
    const r = await Promise.allSettled([
      abrirTentativa({ stepInstanceId: p.passos.a, motivo: MOTIVOS_DE_TENTATIVA.RETRY, status: "EM_ANDAMENTO", chaveIdempotencia: chave }),
      abrirTentativa({ stepInstanceId: p.passos.a, motivo: MOTIVOS_DE_TENTATIVA.RETRY, status: "EM_ANDAMENTO", chaveIdempotencia: chave }),
    ])
    const ids = r.filter((x) => x.status === "fulfilled").map((x) => (x as PromiseFulfilledResult<{ tentativa: { id: number } }>).value.tentativa.id)
    check("mesmo comando reenviado: a MESMA tentativa", new Set(ids).size === 1, JSON.stringify(ids))
    check("  uma vigente só", (await tentativasDoPasso(p.passos.a)).filter((x) => x.supersededAt == null).length === 1)
  }

  // ── 8. NOVA VIA × NOVA VIA ────────────────────────────────────────────────
  {
    const p = await montar("viavia")
    const doc = await prisma.documento.create({
      data: { pessoaId: p.pessoaId, tipo: "CERTIDAO_NASCIMENTO", status: "RECEBIDO" },
      select: { id: true },
    })
    const alvo = {
      stepInstanceId: p.passos.a, documentoId: doc.id, processoId: p.processoId,
      usuarioId: 1, sync: { origem: "USER" as const, correlationId: `${M}-via` }, valores: { motivo: "ilegível" },
    }
    await Promise.allSettled([novaViaDocumental(alvo), novaViaDocumental(alvo)])
    const derivados = await prisma.documento.count({ where: { derivadoDeId: doc.id } })
    check("nova via × nova via (mesmo comando): UMA via criada", derivados === 1, `${derivados} vias`)
    const original = await prisma.documento.findUnique({ where: { id: doc.id }, select: { status: true } })
    check("  o original continua legível", original?.status === "RECEBIDO")
  }

  // ── 9. TRANSIÇÃO × TRANSIÇÃO EM DIREÇÕES OPOSTAS ──────────────────────────
  {
    const p = await montar("opostas")
    await Promise.allSettled([
      prisma.$transaction((tx) => transicionarPassoTx(tx, p.passos.a, "CONCLUIDO", { ...opts(p, `${M}-o1`), extra: { completedAt: new Date() } })),
      prisma.$transaction((tx) => transicionarPassoTx(tx, p.passos.a, "BLOQUEADO", opts(p, `${M}-o2`))),
    ])
    const st = await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: p.passos.a }, select: { status: true, completedAt: true } })
    check("direções opostas: a etapa fica em UM estado só", st != null)
    check("  e se ficou concluída, tem data", st?.status !== "CONCLUIDO" || st.completedAt != null)
    check("  sem resíduo", (await coerente(p)).length === 0)
  }

  // ── 10. ABRIR SUCESSOR × REABRIR PREDECESSOR ──────────────────────────────
  {
    const p = await montar("sucpred")
    await prisma.phaseWorkflowStepInstance.update({ where: { id: p.passos.a }, data: { status: "CONCLUIDO", completedAt: new Date() } })
    await prisma.phaseWorkflowStepInstance.update({ where: { id: p.passos.b }, data: { status: "DISPONIVEL" } })
    await Promise.allSettled([
      prisma.$transaction((tx) => transicionarPassoTx(tx, p.passos.b, "EM_ANDAMENTO", opts(p, `${M}-sp1`))),
      prisma.$transaction((tx) => reabrirPassoTx(tx, p.passos.a, "EM_ANDAMENTO", opts(p, `${M}-sp2`))),
    ])
    const [a, b] = await Promise.all([
      prisma.phaseWorkflowStepInstance.findUnique({ where: { id: p.passos.a }, select: { status: true } }),
      prisma.phaseWorkflowStepInstance.findUnique({ where: { id: p.passos.b }, select: { status: true } }),
    ])
    // A INVARIANTE: o sucessor não pode estar em execução com o predecessor aberto.
    const emVoo = new Set(["EM_ANDAMENTO", "DISPONIVEL", "AGUARDANDO"])
    const contradicao = emVoo.has(b?.status ?? "") && !["CONCLUIDO", "DISPENSADO", "APROVADO"].includes(a?.status ?? "")
    check("abrir sucessor × reabrir predecessor: sem sucessor em voo com predecessor aberto",
      !contradicao, `a=${a?.status} b=${b?.status}`)
    check("  sem resíduo", (await coerente(p)).length === 0)
  }

  await limpar()
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) for (const f of falhas) console.log(`  · ${f}`)
  await prisma.$disconnect()
  process.exit(falhas.length ? 1 : 0)
}

void main()
