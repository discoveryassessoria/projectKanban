/** Cenário do smoke autenticado. `--limpar` remove tudo. Só dados MARCADOS. */
import { prisma } from "../src/lib/prisma"
import { vincularRequerenteTx } from "../lib/genealogia/vincular-requerente"
import { removerNecessidadesDoSujeito } from "../src/services/necessidade-documental"

export const MARCA = "SMOKE-UI-CICLO-VIDA"
const PROCESSO = 513

async function limpar() {
  const reqs = (await prisma.requerente.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, personId: true } }))
  const pids = reqs.map(r => r.personId).filter((x): x is number => x != null)
  // A reinserção dispara o motor financeiro e nasce uma Receita REAL de
  // honorários para o requerente de teste. Ela é do smoke e sai com ele —
  // alcançada pelo VÍNCULO, não pelo código, porque quem a criou foi o motor.
  const rec = [...new Set([
    ...(await prisma.receita.findMany({ where: { codigo: { startsWith: "SMKUI" } }, select: { id: true } })).map(r=>r.id),
    ...(await prisma.receita.findMany({
      where: { OR: [{ requerentes: { some: { requerenteId: { in: reqs.map(r=>r.id) } } } }, { personId: { in: pids } }] },
      select: { id: true },
    })).map(r=>r.id),
  ])]
  if (rec.length) {
    await prisma.receitaRequerente.deleteMany({ where: { receitaId: { in: rec } } })
    await prisma.parcelaFinanceira.deleteMany({ where: { receitaId: { in: rec } } })
    await prisma.eventoFinanceiro.deleteMany({ where: { receitaId: { in: rec } } })
    const obs = (await prisma.obrigacaoEconomica.findMany({
      where: { OR: [{ origemTipo: "RECEITA", origemId: { in: rec } }, { personId: { in: pids.length?pids:[-1] } }] },
      select: { id: true },
    })).map(o=>o.id)
    if (obs.length) {
      await prisma.distribuicaoEconomica.deleteMany({ where: { obrigacaoId: { in: obs } } })
      await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: { in: obs } } })
      await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: { in: obs } } })
      await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: { in: obs } } })
      await prisma.obrigacaoEconomica.deleteMany({ where: { id: { in: obs } } })
    }
    // O MotorArtefato é a chave de idempotência do lançamento automático. Se
    // ficar, o motor considera o honorário JÁ criado e não o recria na próxima
    // vez — resíduo invisível que muda comportamento futuro.
    await prisma.motorArtefato.deleteMany({ where: { targetTable: "Receita", targetId: { in: rec } } }).catch(()=>{})
    await prisma.receita.deleteMany({ where: { id: { in: rec } } })
  }
  await prisma.tarefa.deleteMany({ where: { titulo: { startsWith: MARCA } } })
  if (pids.length) {
    await prisma.documento.deleteMany({ where: { pessoaId: { in: pids } } })
    // Pelo SERVIÇO CANÔNICO. Apagar `NecessidadeDocumental` direto deixa vivo o
    // passo escopado por ela — `necessidadeId` é `onDelete: SetNull`, então o
    // passo sobrevive sem escopo nenhum. Foi o que aconteceu na primeira versão
    // desta limpeza: sobrou um `localizar_registro` órfão em produção.
    for (const pessoaId of pids) await removerNecessidadesDoSujeito({ pessoaId }, prisma)
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { pessoaId: { in: pids } } })
    await prisma.requerente.updateMany({ where: { id: { in: reqs.map(r=>r.id) } }, data: { personId: null } })
    await prisma.arvore.updateMany({ where: { pessoaPrincipalId: { in: pids } }, data: { pessoaPrincipalId: null } })
    await prisma.pessoa.deleteMany({ where: { id: { in: pids } } })
  }
  await prisma.motorArtefato.deleteMany({ where: { descricao: { contains: MARCA } } }).catch(()=>{})
  await prisma.documento.deleteMany({ where: { descricao: { startsWith: MARCA } } })
  if (reqs.length) {
    await prisma.processoRequerente.deleteMany({ where: { requerenteId: { in: reqs.map(r=>r.id) } } })
    await prisma.requerente.deleteMany({ where: { id: { in: reqs.map(r=>r.id) } } })
  }
}

async function montar() {
  const proc = await prisma.processo.findUnique({ where: { id: PROCESSO }, select: { arvoreId: true } })
  if (!proc?.arvoreId) throw new Error("processo 513 sem árvore")
  const req = await prisma.requerente.create({ data: { nome: `${MARCA} Fulano`, cpf: "111.111.111-11" }, select: { id: true } })
  await prisma.processoRequerente.create({ data: { processoId: PROCESSO, requerenteId: req.id } })
  const v = await prisma.$transaction((tx) => vincularRequerenteTx(tx, { arvoreId: proc.arvoreId!, requerenteId: req.id }))
  if (!v.ok) throw new Error(v.code)
  const doc = await prisma.documento.create({ data: { pessoaId: v.pessoaId, descricao: `${MARCA} certidão` }, select: { id: true } })
  await prisma.tarefa.create({ data: { titulo: `${MARCA} localizar registro`, processoId: PROCESSO, documentoId: doc.id, pessoaId: v.pessoaId, origem: "reconciliacao" } })
  await prisma.receita.create({ data: { codigo: `SMKUI-1`, processoId: PROCESSO, personId: v.pessoaId, descricao: `${MARCA} honorários`, valor: "300.00", fxEstimado: "1.0000", data1: new Date(), requerentes: { create: { idx: 0, nome: `${MARCA} Fulano`, requerenteId: req.id } } } })
  return { arvoreId: proc.arvoreId, requerenteId: req.id, pessoaId: v.pessoaId, documentoId: doc.id }
}

/**
 * Confere o estado DEPOIS do smoke: o que a interface deixou no banco.
 * A tela pode mentir — o texto da marca aparece tanto no nó da árvore quanto na
 * lista do seletor, e uma asserção visual já deu falso-verde aqui. Isto não.
 */
async function verificar() {
  let ok = 0, ko = 0
  const t = (n: string, c: boolean, e = "") => {
    if (c) { ok++; console.log(`  ✅ ${n}${e ? ` — ${e}` : ""}`) }
    else { ko++; console.log(`  ❌ ${n}${e ? ` — ${e}` : ""}`) }
  }
  const reqs = await prisma.requerente.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, personId: true } })
  const pids = reqs.map((r) => r.personId).filter((x): x is number => x != null)
  const ids = reqs.map((r) => r.id)

  t("um único Requerente para a identidade", reqs.length === 1, `${reqs.length}`)
  t("um único vínculo ativo com o processo",
    (await prisma.processoRequerente.count({ where: { processoId: PROCESSO, requerenteId: { in: ids }, removidoEm: null } })) === 1)
  t("uma única Pessoa na árvore para essa identidade", pids.length === 1, `${pids.length}`)
  t("nenhuma Pessoa removida sobrou ativa",
    (await prisma.pessoa.count({ where: { id: { in: pids.length ? pids : [-1] }, removidaEm: { not: null } } })) === 0)
  t("nenhum documento residual", (await prisma.documento.count({ where: { descricao: { startsWith: MARCA } } })) === 0)
  t("nenhuma tarefa residual", (await prisma.tarefa.count({ where: { titulo: { startsWith: MARCA } } })) === 0)
  // A reinserção DISPARA o motor financeiro (honorários). O correto não é zero:
  // é UM. Dois seria a duplicação que este trabalho existe para impedir.
  t("exatamente UM participante financeiro",
    (await prisma.receitaRequerente.count({ where: { requerenteId: { in: ids } } })) === 1)
  t("exatamente UMA receita para a identidade",
    (await prisma.receita.count({ where: { processoId: PROCESSO, requerentes: { some: { requerenteId: { in: ids } } } } })) === 1)
  t("nenhuma tarefa órfã no processo",
    (await prisma.tarefa.count({ where: { processoId: PROCESSO, workflowStepInstanceId: null, necessidadeId: null, documentoId: null, origem: { notIn: ["MANUAL", "manual"] } } })) === 0)
  t("nenhuma necessidade sem sujeito",
    (await prisma.necessidadeDocumental.count({ where: { pessoaId: null, uniaoId: null } })) === 0)

  console.log(`\nTotal: ${ok + ko} | ✅ ${ok} | ❌ ${ko}`)
  if (ko) process.exitCode = 1
}

/** Prova que o smoke não deixou NADA — nem o artefato de idempotência do motor. */
async function conferirResiduo() {
  const linhas: [string, number][] = [
    ["Requerente", await prisma.requerente.count({ where: { nome: { startsWith: MARCA } } })],
    ["Pessoa", await prisma.pessoa.count({ where: { nome: { startsWith: MARCA } } })],
    ["Documento", await prisma.documento.count({ where: { descricao: { startsWith: MARCA } } })],
    ["Tarefa", await prisma.tarefa.count({ where: { titulo: { startsWith: MARCA } } })],
    ["Receita", await prisma.receita.count({ where: { descricao: { contains: MARCA } } })],
    ["ReceitaRequerente", await prisma.receitaRequerente.count({ where: { nome: { startsWith: MARCA } } })],
    ["MotorArtefato", await prisma.motorArtefato.count({ where: { descricao: { contains: MARCA } } })],
  ]
  let total = 0
  for (const [n, c] of linhas) { console.log(`  ${c === 0 ? "✅" : "❌"} ${n}: ${c}`); total += c }
  console.log(`\nresíduo total: ${total}`)
  if (total > 0) process.exitCode = 1
}

async function main() {
  if (process.argv.includes("--limpar")) { await limpar(); console.log(JSON.stringify({ limpo: true })) }
  else if (process.argv.includes("--verificar")) { await verificar() }
  else if (process.argv.includes("--residuo")) { await conferirResiduo() }
  else { await limpar(); console.log(JSON.stringify(await montar())) }
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
