// scripts/mandato-financeiro-cartorio-isolado.test.ts
// ============================================================================
// MANDATO — BLOCO 5: FINANCEIRO/PAGAMENTO — CICLO OPERACIONAL (LIMITADO).
// Rodar: PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/mandato-financeiro-cartorio-isolado.test.ts
//
// PERGUNTA DO MANDATO: o passo `aguardar_retorno_do_cartorio` (que tem campo
// de "pagamento") usa a porta financeira canônica real (Ledger/ObrigacaoEconomica,
// ver memória "Ledger = SSOT em 4 camadas"), ou é só um campo/badge de UI sem
// lastro real?
//
// RESPOSTA CONFIRMADA (já apontada como "o gap mais sério" no diagnóstico prévio,
// doc 20-emissao-documental-diagnostico.md — reconfirmada aqui com teste real,
// não presumida): É SÓ CAMPO DE UI. `SolicitacaoDocumento.custoPago`/`.formaPagamento`
// (escritos por registrarSolicitacaoDocumento/informarProtocoloPosterior) NUNCA
// criam ObrigacaoEconomica nem Custo — não existe NENHUM caminho de código que
// leia custoPago e grave no Ledger. O único gerador real de custo documental
// (projetarCustosDocumentaisDoPasso) só age sobre passos cujo editor é
// kind==="registral" (o motor Registral/MRG) — "solicitar_certidao" e
// "aguardar_retorno_do_cartorio" resolvem para "solicitacao_cartorio" e
// "acompanhamento_retorno" (step-editor-registry.ts), NUNCA "registral".
//
// NÃO RESOLVIDO NESTA RODADA — mandato explícito: "NÃO resolver todo o
// financeiro incidentalmente". A decisão de negócio (se/como o custo de
// cartório deve virar ObrigacaoEconomica) permanece em aberto, como já
// registrado no diagnóstico anterior. O que ESTA rodada prova, com teste
// real, é que o isolamento é genuíno (zero leitura cruzada, zero duplicidade
// possível) — não um "provavelmente está isolado".
//
// SEM DUPLICIDADE: custoPago é UM campo (Decimal?) de UMA linha por
// (documentoId, stepInstanceId, ciclo) — a idempotência do upsert
// (chaveIdempotencia = "solicitacao:doc{id}:step{id}:ciclo{ciclo}") garante
// que nunca existem duas linhas "pagas" para a mesma tentativa: reenviar
// sempre ATUALIZA a mesma linha, nunca cria uma segunda.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { resolveWorkflowStepEditor } from "@/src/lib/process-stage/step-editor-registry"
import { projetarCustosDocumentaisDoPasso } from "@/src/services/financeiro/projecao-documental"
import { registrarSolicitacaoDocumento } from "@/src/services/solicitacao-documento"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"

const MARCA = "FINCARTORIO-TEST"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.solicitacaoDocumento.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.documento.deleteMany({ where: { pessoa: { arvore: { nome: { startsWith: MARCA } } } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { wfUid: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@fincartorio.test" } } })
}

let seq = 0
async function main() {
  exigirBancoDeTeste("mandato-financeiro-cartorio-isolado.test.ts — Bloco 5 (financeiro/pagamento isolado)")
  await limpar()
  console.log("MANDATO BLOCO 5 — FINANCEIRO/PAGAMENTO NO CICLO DO CARTÓRIO (isolamento)\n")

  // ══════════════════════════════════════════════════════════════════════
  secao("1) IDENTIDADE ESTRUTURAL — os dois passos NUNCA resolvem para o editor 'registral'")
  // ══════════════════════════════════════════════════════════════════════
  const e1 = resolveWorkflowStepEditor({ stepKey: "solicitar_certidao", phaseKey: "emissao_documental" })
  const e2 = resolveWorkflowStepEditor({ stepKey: "aguardar_retorno_do_cartorio", phaseKey: "emissao_documental" })
  ok("1.1) solicitar_certidao NÃO é editor registral", e1.kind !== "registral", e1.kind)
  ok("1.2) aguardar_retorno_do_cartorio NÃO é editor registral", e2.kind !== "registral", e2.kind)

  // ══════════════════════════════════════════════════════════════════════
  secao("2) projetarCustosDocumentaisDoPasso (o ÚNICO gerador real de Ledger documental) recusa os dois passos")
  // ══════════════════════════════════════════════════════════════════════
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_1`, name: "Certidão", natureza: "DOCUMENTO" }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} proc`, arvoreId: arv.id }, select: { id: true } })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Fulano", sobrenome: "FinCartorio" }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${proc.id}` }, select: { id: true },
  })
  const doc = await prisma.documento.create({ data: { pessoaId: pes.id }, select: { id: true } })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-inst-${proc.id}` }, select: { id: true },
  })
  const step1 = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "emissao_documental", stepKey: "solicitar_certidao",
      ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "CONCLUIDO", necessidadeId: nec.id, documentoId: doc.id, pessoaId: pes.id,
      chaveIdempotencia: `${MARCA}-step1-${proc.id}`,
    },
    select: { id: true },
  })
  const custosAntes = await prisma.obrigacaoEconomica.count({ where: { processoId: proc.id } })
  const rProjecao = await projetarCustosDocumentaisDoPasso(step1.id, {})
  ok("2.1) projetarCustosDocumentaisDoPasso recusa explicitamente (PASSO_NAO_REGISTRAL)", rProjecao.motivo === "PASSO_NAO_REGISTRAL", JSON.stringify(rProjecao).slice(0, 150))
  const custosDepois = await prisma.obrigacaoEconomica.count({ where: { processoId: proc.id } })
  ok("2.2) ZERO ObrigacaoEconomica criada — confirma que não há caminho automático de custo para este passo", custosDepois === custosAntes && custosDepois === 0)

  // ══════════════════════════════════════════════════════════════════════
  secao("3) registrarSolicitacaoDocumento grava custoPago — mas SÓ como campo de UI, sem tocar o Ledger")
  // ══════════════════════════════════════════════════════════════════════
  const step2 = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "emissao_documental", stepKey: "solicitar_certidao_2",
      ordem: 2, tipo: "HUMANO", obrigatorio: true, status: "EM_ANDAMENTO", startedAt: new Date(),
      necessidadeId: nec.id, documentoId: doc.id, pessoaId: pes.id, chaveIdempotencia: `${MARCA}-step2-${proc.id}`,
    },
    select: { id: true },
  })
  const usuarioT = await prisma.usuario.create({ data: { nome: "Fin", email: `fin.${++seq}@fincartorio.test`, senha: "x", tipo: "assistente" }, select: { id: true } })
  const ctx = { usuarioId: usuarioT.id, isAdmin: true, permissoes: { "workflow.iniciarPasso": true, "workflow.concluirPasso": true } }
  const rSol = await registrarSolicitacaoDocumento(
    doc.id, step2.id,
    { canal: "EMAIL", destinatarioNome: "Cartório Y", custoPago: 87.5, formaPagamento: "PIX", requerimento: { url: "https://exemplo.test/req.pdf" } },
    ctx,
  )
  ok("3.1) registro sucede", rSol.ok === true, JSON.stringify(rSol).slice(0, 150))
  if (rSol.ok) {
    const sol = await prisma.solicitacaoDocumento.findUniqueOrThrow({ where: { id: rSol.solicitacaoId }, select: { custoPago: true } })
    ok("3.2) custoPago FOI gravado na SolicitacaoDocumento (o campo de UI existe e funciona)", Number(sol.custoPago) === 87.5, String(sol.custoPago))
  }
  const obrigacoesAposCusto = await prisma.obrigacaoEconomica.count({ where: { processoId: proc.id } })
  ok("3.3) NENHUMA ObrigacaoEconomica nasceu do custoPago — confirma: é campo de UI, sem lastro no Ledger", obrigacoesAposCusto === 0)

  // ══════════════════════════════════════════════════════════════════════
  secao("4) SEM DUPLICIDADE — reenviar a mesma solicitação ATUALIZA a mesma linha, nunca cria uma segunda 'paga'")
  // ══════════════════════════════════════════════════════════════════════
  const rSol2 = await registrarSolicitacaoDocumento(
    doc.id, step2.id,
    { canal: "EMAIL", destinatarioNome: "Cartório Y", custoPago: 120, formaPagamento: "PIX", requerimento: { url: "https://exemplo.test/req.pdf" } },
    ctx,
  )
  ok("4.1) segundo registro (reenvio) sucede", rSol2.ok === true)
  const totalSolicitacoes = await prisma.solicitacaoDocumento.count({ where: { documentoId: doc.id, stepInstanceId: step2.id } })
  ok("4.2) continua UMA ÚNICA linha de solicitação para este (documento, passo, ciclo) — idempotência do upsert", totalSolicitacoes === 1, String(totalSolicitacoes))
  if (rSol2.ok) {
    const solAtualizada = await prisma.solicitacaoDocumento.findUniqueOrThrow({ where: { id: rSol2.solicitacaoId }, select: { custoPago: true } })
    ok("4.3) o valor foi ATUALIZADO (120), não somado nem duplicado", Number(solAtualizada.custoPago) === 120, String(solAtualizada.custoPago))
  }

  await limpar()

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
