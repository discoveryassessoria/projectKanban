// scripts/duplicidade-reconciliacao-e-reancoragem.test.ts
// ============================================================================
// PROCESSAMENTO EM DUPLICIDADE — 30/09/2026 (achados de 29/09 em produção).
//
// (a) Processo 675: a reconciliação registral (`registral_reconciliacao_documental` +
//     `registral_linhagem_recalculada`) foi gravada 3, 6, 3 e 3 vezes no MESMO segundo, às 20:30/20:45/
//     21:00/21:15. Não é cron duplicado nem laço: é o cron da fila (`*​/15`) drenando de uma vez N eventos
//     `registral.reconciliar.processo` do MESMO processo (um por certidão alterada) e rodando o mesmo
//     cálculo N vezes. O dispatcher agora coalesce: UMA execução por processo por lote, e os demais
//     eventos são arquivados como cobertos.
// (b) Processo 676: 93 (115 até o fim do dia) `TAREFA_REANCORADA` entre 17:19 e 17:31, uma tarefa 17
//     vezes, todas com `deInstancia == paraInstancia` e `chaveAnterior == chaveAtual`. Causa: dois passos
//     VIVOS da mesma obrigação na mesma instância (`matdoc|…` × `wfi…|stepdef…`); cada materialização puxava
//     a tarefa para o passo que estava materializando (vai-e-vem). Agora (1) a tarefa não pula para um
//     irmão vivo do passo em que já está e (2) `reancorarTarefaNaUnidade` sem nada a mudar não escreve
//     nem audita.
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"
import { processarOutbox } from "@/src/services/outbox-dispatcher"
import { reancorarTarefaNaUnidade } from "@/lib/operacional/tarefa-canonica"

const MARCA = "DUPREC"
let ok = 0, falhou = 0
const falhas: string[] = []
const t = (cond: boolean, nome: string, detalhe = "") => {
  if (cond) { ok++; console.log(`  ✅ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
}
const secao = (s: string) => console.log(`\n${s}`)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const tarefas = (await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })).map((x) => x.id)
  await prisma.logAuditoria.deleteMany({ where: { OR: [{ entidade: "Processo", entidadeId: { in: [0, ...ids] } }, { entidade: "Tarefa", entidadeId: { in: [0, ...tarefas] } }] } })
  await prisma.domainOutbox.deleteMany({ where: { correlationId: { startsWith: MARCA } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.documento.deleteMany({ where: { pessoa: { arvore: { processos: { some: { id: { in: ids } } } } } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
}

async function main() {
  exigirBancoDeTeste("prova coalescência da reconciliação registral e idempotência da reancoragem")
  await limpar()
  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })

  // ═════════════════════════════════════════════════════════════════════════
  secao("(a) reconciliação registral: N eventos do mesmo processo no lote → UMA execução")
  // ═════════════════════════════════════════════════════════════════════════
  const mk = async (n: string) => {
    const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv ${n}` }, select: { id: true } })
    return prisma.processo.create({ data: { nome: `${MARCA} proc ${n}`, arvoreId: arv.id }, select: { id: true } })
  }
  const pA = await mk("A"), pB = await mk("B")
  let seq = 0
  const publicar = (processoId: number) =>
    prisma.domainOutbox.create({
      data: {
        tipo: "registral.reconciliar.processo", aggregateType: "Processo", aggregateId: processoId,
        payload: { processoId, motivo: "documento_alterado", referencia: 1000 + seq, usuarioId: null },
        correlationId: `${MARCA}-${processoId}-${seq}`, chaveIdempotencia: `${MARCA}-recon-${processoId}-${seq++}`,
      },
      select: { id: true },
    })
  const contar = (processoId: number) =>
    prisma.logAuditoria.count({ where: { acao: "registral_reconciliacao_documental", entidade: "Processo", entidadeId: processoId } })
  const eA = [await publicar(pA.id), await publicar(pA.id), await publicar(pA.id)]
  const eB = [await publicar(pB.id)]
  const r1 = await processarOutbox({ limite: 100, tipos: ["registral.reconciliar.processo"] })
  t(r1.lidos === 4 && r1.processados === 4 && r1.falhos === 0, "os 4 eventos do lote foram consumidos", JSON.stringify({ lidos: r1.lidos, proc: r1.processados, falhos: r1.falhos }))
  const st = await prisma.domainOutbox.findMany({ where: { id: { in: [...eA, ...eB].map((e) => e.id) } }, select: { status: true } })
  t(st.every((s) => s.status === "ENVIADO"), "todos ENVIADO (os cobertos são arquivados, nenhum fica PENDENTE)")
  t((await contar(pA.id)) === 1, "processo A: 3 eventos no lote → 1 reconciliação gravada (antes: 3)", `obtido ${await contar(pA.id)}`)
  t((await contar(pB.id)) === 1, "processo B (outro processo do mesmo lote) reconcilia normalmente, 1 vez", `obtido ${await contar(pB.id)}`)
  const eA2 = await publicar(pA.id)
  const r2 = await processarOutbox({ limite: 100, tipos: ["registral.reconciliar.processo"] })
  t(r2.processados === 1 && (await contar(pA.id)) === 2, "evento publicado DEPOIS (lote seguinte) reconcilia de novo — o estado mudou, não é coalescido", `A=${await contar(pA.id)}`)
  void eA2

  // ═════════════════════════════════════════════════════════════════════════
  secao("(b) reancoragem: irmão vivo não puxa a tarefa; reancorar o que já está ancorado não escreve")
  // ═════════════════════════════════════════════════════════════════════════
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_item`, name: "Certidão de Nascimento", natureza: "DOCUMENTO" }, select: { id: true } })
  const proc = await mk("C")
  const arvId = (await prisma.processo.findUniqueOrThrow({ where: { id: proc.id }, select: { arvoreId: true } })).arvoreId!
  const pes = await prisma.pessoa.create({ data: { arvoreId: arvId, nome: "Fulano", sobrenome: "Teste" }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${proc.id}` }, select: { id: true },
  })
  const doc = await prisma.documento.create({ data: { pessoaId: pes.id }, select: { id: true } })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "fase_x", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-inst-${proc.id}` }, select: { id: true },
  })
  const passo = (chave: string, comDoc: boolean) =>
    prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "fase_x", stepKey: "localizar_registro",
        ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "DISPONIVEL", geraTarefa: true,
        necessidadeId: nec.id, documentoId: comDoc ? doc.id : null, pessoaId: pes.id, papel: "equipe_documental", chaveIdempotencia: chave,
      },
      select: { id: true },
    })
  const matdoc = await passo(`matdoc|localizar_registro|nec${nec.id}|c1`, false) // como em produção: criado ANTES de o Documento existir
  const wfi = await passo(`wfi${inst.id}|stepdef1|stepkeylocalizar_registro|stepv1|c1|doc${doc.id}|nec${nec.id}`, true)
  const g0 = await garantirTarefaDePasso({ stepInstanceId: matdoc.id })
  t(g0.success === true && g0.created, "materializa a tarefa no primeiro passo")
  const tarefaId = g0.success ? g0.tarefa.id : -1
  const reanc = () => prisma.logAuditoria.count({ where: { acao: "TAREFA_REANCORADA", entidade: "Tarefa", entidadeId: tarefaId } })
  const lv0 = (await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId }, select: { lockVersion: true } })).lockVersion

  for (let i = 0; i < 8; i++) {
    await garantirTarefaDePasso({ stepInstanceId: i % 2 === 0 ? wfi.id : matdoc.id })
  }
  const depois = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId }, select: { workflowStepInstanceId: true, lockVersion: true } })
  t((await reanc()) === 0, "8 materializações alternando os dois passos vivos → 0 TAREFA_REANCORADA (antes: 8, a tarefa pulando)", `obtido ${await reanc()}`)
  t(depois.workflowStepInstanceId === matdoc.id && depois.lockVersion === lv0, "a tarefa continua no passo em que estava, lockVersion intacto", JSON.stringify(depois))
  t((await prisma.tarefa.count({ where: { processoId: proc.id, origem: { not: "obrigacao-atribuicao" } } })) === 1, "continua UMA tarefa do trabalho")

  // o irmão é resolvido pela SUPERSESSÃO (não por vai-e-vem): com o atual superseded, seguir o trabalho funciona
  await prisma.phaseWorkflowStepInstance.update({ where: { id: matdoc.id }, data: { status: "SUPERSEDIDO" } })
  await garantirTarefaDePasso({ stepInstanceId: wfi.id })
  t((await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId }, select: { workflowStepInstanceId: true } })).workflowStepInstanceId === wfi.id && (await reanc()) === 1,
    "com o passo atual SUPERSEDIDO a tarefa segue o trabalho para o passo vivo — 1 reancoragem legítima", `logs ${await reanc()}`)
  await garantirTarefaDePasso({ stepInstanceId: wfi.id })
  t((await reanc()) === 1, "repetir a materialização não reancora nem audita de novo")

  // primitiva: reancorar para onde já está = nada (sem UPDATE, sem log, sem lockVersion)
  const antes = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId } })
  for (let i = 0; i < 3; i++) {
    await prisma.$transaction((tx) => reancorarTarefaNaUnidade(tx, {
      tarefaId, workflowInstanceId: antes.workflowInstanceId!, workflowStepInstanceId: antes.workflowStepInstanceId!,
      faseMacroKey: antes.faseMacroKey, chaveIdempotencia: antes.chaveIdempotencia!, necessidadeId: antes.necessidadeId,
      documentoId: antes.documentoId, pessoaId: antes.pessoaId, deInstanciaId: antes.workflowInstanceId, chaveAnterior: antes.chaveIdempotencia,
    }))
  }
  const fim = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId }, select: { lockVersion: true, updatedAt: true } })
  t((await reanc()) === 1 && fim.lockVersion === antes.lockVersion && +fim.updatedAt === +antes.updatedAt,
    "reancorarTarefaNaUnidade para a MESMA âncora ×3: sem log, sem UPDATE, lockVersion e updatedAt intactos")

  await limpar()
  console.log(`\n${"=".repeat(70)}\n✅ ${ok} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => { await prisma.$disconnect() })
