// scripts/arvore-caso-edison-junior.test.ts
// ============================================================================
// CASO EDISON JUNIOR — "A árvore genealógica é a única fonte de verdade documental" (CLAUDE.md §37).
//   O CASO REAL (processo 675, Antão, 29-30/09/2026): Edison Nás Antão Junior, casado → necessidade de
//   casamento POR UNIÃO + Documento no TITULAR. Removida a cônjuge em HARD, o Documento do titular
//   sobrevivia órfão (necessidadeId nulo) e a abertura da Emissão criava passo/tarefa a partir do
//   DOCUMENTO solto (tarefa fantasma 3984). Aqui: (1) o cenário exato; (2) o inverso — Documento
//   órfão pré-existente não vira tarefa; (3) o estado que já existe no banco é detectado e curado.
//
//   node scripts/ci/gate-build.mjs --suite todas --so arvore-caso-edison-junior
// Roda contra o banco de TESTE (rotas reais, token de administrador).
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { criarPalco } from "./_fixture-arvore-fonte"

const MARCA = "ARVEDI"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function main() {
  exigirBancoDeTeste("arvore-caso-edison-junior.test.ts")
  const P = criarPalco(MARCA)
  await P.montar()
  console.log("CASO EDISON JUNIOR\n")

  await P.montarEmissao()
  const { materializarExecucaoDaFase } = await import("../src/services/materializar-fase")
  const { materializarGenealogia } = await import("../src/services/genealogia/materializar-genealogia")
  const { reconciliarTarefas } = await import("../lib/operacional/reconciliar-tarefas")

  // Tarefa de UM documento: por documentoId da tarefa OU do passo a que ela aponta (uma tarefa por obrigação, §1).
  const tarefasDeEmissao = (processoId: number) => prisma.tarefa.findMany({
    where: { processoId, OR: [{ documentoId: { not: null } }, { workflowStepInstance: { documentoId: { not: null } } }] },
    select: { id: true, documentoId: true, statusTarefa: true, workflowStepInstance: { select: { documentoId: true } } },
  }).then((ts) => ts.map((t) => ({ ...t, documentoId: t.documentoId ?? t.workflowStepInstance?.documentoId ?? null })))
  /** Tarefa ABERTA cuja causa não existe: sem necessidade própria E com documento sem necessidade ativa (ou inativo). */
  const tarefasFantasma = async (processoId: number) => (await prisma.tarefa.findMany({
    where: { processoId, statusTarefa: { notIn: P.TAREFA_FECHADA as never }, origem: { not: "MANUAL" }, necessidadeId: null, documentoId: { not: null } },
    select: { id: true, documento: { select: { status: true, necessidadeId: true, necessidade: { select: { status: true } } } } },
  })).filter((t) => !t.documento || P.DOC_INATIVO.includes(t.documento.status) || t.documento.necessidadeId === null || t.documento.necessidade?.status === "DISPENSADA")
  const passosDeEmissao = (processoId: number) => prisma.phaseWorkflowStepInstance.findMany({ where: { processoId, faseMacroKey: "emissao_documental" }, select: { id: true, documentoId: true, status: true } })
  const casal = async (nome: string) => {
    const c = await P.novoCenario(nome, { conjuge: true })
    await P.putPessoa(c.titularId, { casado: true })
    await P.postUniao(c.titularId, c.conjugeId!)
    const uniao = await prisma.uniao.findFirstOrThrow({ where: { pessoa1Id: c.titularId } })
    const f = await P.foto(c.processoId)
    const nec = f.necDe("CAS", { uniaoId: uniao.id })[0]
    const doc = f.docs.find((d) => d.necessidadeId === nec.id)!
    return { c, uniao, nec, doc }
  }

  secao("SANIDADE — com necessidade ativa, a Emissão gera passo E tarefa para o Documento do casamento")
  const s = await casal("sanidade")
  const r0 = await materializarExecucaoDaFase({ processoId: s.c.processoId, faseMacroKey: "emissao_documental", fonte: "RECONCILIACAO" })
  ok("a Emissão materializou", r0.estado === "MATERIALIZADO", `${r0.estado} ${JSON.stringify(r0.motivos.map((m) => m.code))}`)
  await reconciliarTarefas({ processoId: s.c.processoId })
  ok("CONTROLE POSITIVO: há passo E tarefa de Emissão para o Documento do casamento (necessidade ativa) — o pipeline funciona, então o 'nenhuma' abaixo é prova", (await passosDeEmissao(s.c.processoId)).some((p) => p.documentoId === s.doc.id) && (await tarefasDeEmissao(s.c.processoId)).some((t) => t.documentoId === s.doc.id), JSON.stringify({ passos: await passosDeEmissao(s.c.processoId), tarefas: await tarefasDeEmissao(s.c.processoId) }))

  secao("O CASO EXATO — casal; necessidade de casamento por união; titular com Documento; cônjuge removido em HARD")
  const e = await casal("edison")
  ok("pré: necessidade de casamento POR UNIÃO e Documento no TITULAR", e.nec.pessoaId === null && e.nec.uniaoId === e.uniao.id && e.doc.pessoaId === e.c.titularId && e.doc.status === "PENDENTE")
  const rd = await P.deletePessoa(e.c.conjugeId!, "HARD")
  ok("DELETE HARD do cônjuge responde 200", rd.status === 200, `${rd.status} ${JSON.stringify(await rd.clone().json()).slice(0, 200)}`)
  ok("a união saiu", (await prisma.uniao.count({ where: { id: e.uniao.id } })) === 0)
  ok("a necessidade de casamento saiu", (await prisma.necessidadeDocumental.count({ where: { id: e.nec.id } })) === 0)
  ok("o Documento do TITULAR saiu junto (era o órfão 2303: sobrevivia com necessidadeId nulo)", (await prisma.documento.count({ where: { id: e.doc.id } })) === 0)
  ok("nenhum Documento de casamento ATIVO sobrou no processo", (await P.foto(e.c.processoId)).docs.filter((d) => d.necessidadeId === null && !P.DOC_INATIVO.includes(d.status)).length === 0)
  ok("tarefas e passos do casamento saíram", (await prisma.tarefa.count({ where: { documentoId: e.doc.id } })) === 0 && (await prisma.phaseWorkflowStepInstance.count({ where: { necessidadeId: e.nec.id } })) === 0)
  ok("auditoria da remoção legível", (await prisma.logAuditoria.count({ where: { acao: "pessoa_removida_definitivo", descricao: { contains: "Luana" } } })) >= 1)
  const r1 = await materializarExecucaoDaFase({ processoId: e.c.processoId, faseMacroKey: "emissao_documental", fonte: "RECONCILIACAO" })
  await reconciliarTarefas({ processoId: e.c.processoId })
  const docsComPasso = new Set((await passosDeEmissao(e.c.processoId)).map((p) => p.documentoId))
  const docsComTarefa = new Set((await tarefasDeEmissao(e.c.processoId)).map((t) => t.documentoId))
  ok("ABRIR A FASE EMISSÃO → NENHUMA tarefa fantasma de casamento (era a tarefa 3984)", !docsComTarefa.has(e.doc.id) && !docsComPasso.has(e.doc.id), `${r1.estado}`)
  ok("e nenhuma tarefa aberta sem causa (documento sem necessidade ativa) no processo", (await tarefasFantasma(e.c.processoId)).length === 0)
  const docsAtivosComNec = (await P.foto(e.c.processoId)).docs.filter((d) => d.necessidadeId !== null && !P.DOC_INATIVO.includes(d.status)).map((d) => d.id).sort()
  ok("a Emissão só gerou trabalho para Documento COM necessidade ativa", [...docsComTarefa].filter((x): x is number => x != null).every((x) => docsAtivosComNec.includes(x)), JSON.stringify([...docsComTarefa]))

  secao("O INVERSO — Documento órfão PRÉ-EXISTENTE (necessidadeId nulo) NÃO vira passo nem tarefa")
  const o = await P.novoCenario("orfao")
  await P.putPessoa(o.titularId, { documentacao: true })
  const tipoCas = await prisma.tipoDocumentoCadastro.findFirstOrThrow({ where: { code: P.COD.CAS }, select: { id: true } })
  const orfao = await prisma.documento.create({ data: { pessoaId: o.titularId, status: "PENDENTE", origem: "automatica", documentTypeId: tipoCas.id }, select: { id: true } })
  await materializarExecucaoDaFase({ processoId: o.processoId, faseMacroKey: "emissao_documental", fonte: "RECONCILIACAO" })
  await reconciliarTarefas({ processoId: o.processoId })
  ok("nenhum passo de Emissão para o órfão", !(await passosDeEmissao(o.processoId)).some((p) => p.documentoId === orfao.id))
  ok("nenhuma tarefa para o órfão", (await prisma.tarefa.count({ where: { documentoId: orfao.id } })) === 0)
  ok("o reconciliador de tarefas também não cria tarefa a partir de documento solto", (await reconciliarTarefas({ processoId: o.processoId })).tarefasCriadas >= 0 && (await prisma.tarefa.count({ where: { documentoId: orfao.id } })) === 0)

  secao("O ESTADO QUE JÁ EXISTE NO BANCO REAL — passo 3044 + tarefa 3984 sobre Documento órfão: a causa perdida é detectada")
  const g = await P.novoCenario("fantasma")
  await P.putPessoa(g.titularId, { documentacao: true })
  const fantasma = await prisma.documento.create({ data: { pessoaId: g.titularId, status: "PENDENTE", origem: "automatica", documentTypeId: tipoCas.id }, select: { id: true } })
  const instE = await prisma.phaseWorkflowInstance.create({ data: { processoId: g.processoId, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-emi-${g.processoId}` }, select: { id: true } })
  const passo = await prisma.phaseWorkflowStepInstance.create({
    data: { workflowInstanceId: instE.id, processoId: g.processoId, faseMacroKey: "emissao_documental", stepKey: "solicitar_certidao", ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "DISPONIVEL", documentoId: fantasma.id, papel: "equipe_documental", chaveIdempotencia: `${MARCA}-emi-p-${g.processoId}` },
    select: { id: true },
  })
  const tarefa = await prisma.tarefa.create({
    data: { titulo: "Certidão de casamento - Inteiro Teor · Edison", processoId: g.processoId, workflowInstanceId: instE.id, workflowStepInstanceId: passo.id, documentoId: fantasma.id, faseMacroKey: "emissao_documental", origem: "workflow", statusTarefa: "NAO_INICIADA", ciclo: 1 },
    select: { id: true },
  })
  const rr = await reconciliarTarefas({ processoId: g.processoId })
  const tt = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa.id }, select: { statusTarefa: true, causaRemovidaMotivo: true } })
  ok("a tarefa aberta sobre Documento SEM necessidade ativa vira 'causa perdida' e é CANCELADA", tt.statusTarefa === "CANCELADA" && rr.tarefasEncerradasSemCausa >= 1, JSON.stringify(tt))
  ok("o motivo diz a verdade", /necessidade removida pela árvore/.test(tt.causaRemovidaMotivo ?? ""), tt.causaRemovidaMotivo ?? "")
  // a cura completa (Documento + passo) acontece no reconciliador da árvore
  await materializarGenealogia(g.processoId, prisma, { motivo: "reconciliação do documento órfão" })
  ok("o Documento órfão sai de jogo (NAO_EXIGIDO — não apagado)", (await prisma.documento.findUniqueOrThrow({ where: { id: fantasma.id } })).status === "NAO_EXIGIDO")
  ok("o passo de Emissão do órfão foi CANCELADO", (await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: passo.id } })).status === "CANCELADO")
  const de = await prisma.tarefa.count({ where: { id: tarefa.id } })
  ok("idempotente: rodar de novo não cria nem reabre nada", (await reconciliarTarefas({ processoId: g.processoId })).tarefasCriadas === 0 && de === 1)

  secao("Tarefa JÁ INICIADA sobre documento sem causa: não é cancelada — fica marcada para decisão")
  const h = await P.novoCenario("iniciada")
  await P.putPessoa(h.titularId, { documentacao: true })
  const d2 = await prisma.documento.create({ data: { pessoaId: h.titularId, status: "PENDENTE", origem: "automatica", documentTypeId: tipoCas.id }, select: { id: true } })
  const i2 = await prisma.phaseWorkflowInstance.create({ data: { processoId: h.processoId, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-emi2-${h.processoId}` }, select: { id: true } })
  const p2 = await prisma.phaseWorkflowStepInstance.create({ data: { workflowInstanceId: i2.id, processoId: h.processoId, faseMacroKey: "emissao_documental", stepKey: "solicitar_certidao", ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "EM_ANDAMENTO", documentoId: d2.id, papel: "equipe_documental", chaveIdempotencia: `${MARCA}-emi2-p-${h.processoId}` }, select: { id: true } })
  const t2 = await prisma.tarefa.create({ data: { titulo: "Certidão iniciada", processoId: h.processoId, workflowInstanceId: i2.id, workflowStepInstanceId: p2.id, documentoId: d2.id, faseMacroKey: "emissao_documental", origem: "workflow", statusTarefa: "EM_ANDAMENTO", dataInicio: new Date(), ciclo: 1 }, select: { id: true } })
  await reconciliarTarefas({ processoId: h.processoId })
  const tt2 = await prisma.tarefa.findUniqueOrThrow({ where: { id: t2.id }, select: { statusTarefa: true, causaRemovidaEm: true } })
  ok("continua EM_ANDAMENTO (trabalho feito é preservado) e fica marcada com causaRemovidaEm", tt2.statusTarefa === "EM_ANDAMENTO" && tt2.causaRemovidaEm !== null)

  await P.limpar()
  console.log(`\n${falhou === 0 ? "✅" : "❌"} CASO EDISON JUNIOR — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
