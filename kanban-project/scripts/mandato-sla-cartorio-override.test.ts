// scripts/mandato-sla-cartorio-override.test.ts
// ============================================================================
// MANDATO — BLOCO 2: REGRAS TEMPORAIS POR TERCEIRO/CARTÓRIO + OVERRIDE LOCAL.
// Rodar: PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/mandato-sla-cartorio-override.test.ts
//
// ACHADO (confirmado por leitura de código, provado aqui):
//   1. `OrgaoProtocolo` não tinha NENHUM campo/tabela de regra temporal —
//      confirmado pelo schema (nenhum "confirmacaoEstimadaDias" ou análogo).
//   2. `SolicitacaoDocumento.orgaoId` já existia no schema, mas o ÚNICO criador
//      real (`registrarSolicitacaoDocumento`) NUNCA o escrevia — só
//      `destinatarioNome` (texto livre) era de fato gravado. Sem esse vínculo
//      estrutural, nenhuma regra "por cartório" teria como valer nunca.
//   3. `SolicitacaoDocumento.previsaoRetorno` (dimensão C do motor temporal,
//      `lib/operacional/proximo-acontecimento.ts`) também nunca era escrito —
//      lido em 4 lugares reais, gravado em nenhum.
//
// Implementado: `RegraTemporalOrgao` (cadastro novo, mesmo padrão de
// `ExigenciaEvidenciaEtapa` — chave por `stepKey`, não por nome), o resolvedor
// `lib/operacional/sla-por-orgao.ts::resolverPoliticaTemporal` com a
// precedência do mandato, e o wiring em `registrarSolicitacaoDocumento`
// (grava `orgaoId` estrutural + resolve `prazoEsperadoDias`/`previsaoRetorno`
// quando o operador não digita um prazo).
//
// O 4º degrau (override local pontual, por Tarefa, justificado, sem alterar
// cadastro) REAPROVEITA `lib/operacional/tarefa-ciclo.ts::alterarPrazo`
// (valor+motivo+autor+data via LogAuditoria) — não foi criado nada novo para
// ele; provado aqui também, para fechar a cadeia de precedência inteira.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { resolverPoliticaTemporal } from "@/lib/operacional/sla-por-orgao"
import { registrarSolicitacaoDocumento } from "@/src/services/solicitacao-documento"
import { alterarPrazo } from "@/lib/operacional/tarefa-ciclo"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"

const MARCA = "SLACARTORIO-TEST"

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
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  const tids = ts.map((t) => t.id)
  await prisma.solicitacaoDocumento.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: tids } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.documento.deleteMany({ where: { pessoa: { arvore: { nome: { startsWith: MARCA } } } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.regraTemporalOrgao.deleteMany({ where: { chaveRegra: { startsWith: MARCA } } })
  await prisma.orgaoProtocolo.deleteMany({ where: { name: { startsWith: MARCA } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { wfUid: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@slacartorio.test" } } })
}

let seq = 0
async function palco() {
  seq++
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${seq}`, name: "Certidão de Nascimento", natureza: "DOCUMENTO" }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore ${seq}` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo ${seq}`, arvoreId: arv.id }, select: { id: true } })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Fulano", sobrenome: `SlaCartorio${seq}` }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${proc.id}` }, select: { id: true },
  })
  const doc = await prisma.documento.create({ data: { pessoaId: pes.id }, select: { id: true } })
  const wf = await prisma.phaseInternalWorkflow.create({ data: { wfUid: `${MARCA}-wf-${proc.id}`, phaseKey: "emissao_documental", name: `${MARCA} wf` }, select: { id: true } })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO", workflowDefinitionId: wf.id, chaveIdempotencia: `${MARCA}-inst-${proc.id}` },
    select: { id: true },
  })
  const step = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "emissao_documental", stepKey: "solicitar_certidao",
      ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "EM_ANDAMENTO", startedAt: new Date(),
      necessidadeId: nec.id, documentoId: doc.id, pessoaId: pes.id, papel: "equipe_documental",
      slaDays: 5, // TIER 2 — o default do passo/workflow, para contraste com a regra do órgão.
      chaveIdempotencia: `${MARCA}-step-${proc.id}`,
    },
    select: { id: true },
  })
  await reconciliarTarefas({ processoId: proc.id })
  const t = await prisma.tarefa.findFirstOrThrow({ where: { processoId: proc.id }, select: { id: true, dataPrazo: true } })
  return { processoId: proc.id, documentoId: doc.id, stepInstanceId: step.id, tarefaId: t.id }
}

const usuario = (nome: string) =>
  prisma.usuario.create({ data: { nome, email: `${nome.toLowerCase()}.${++seq}@slacartorio.test`, senha: "x", tipo: "assistente" }, select: { id: true, nome: true } })

async function main() {
  exigirBancoDeTeste("mandato-sla-cartorio-override.test.ts — Bloco 2 (SLA por cartório + override local)")
  await limpar()
  console.log("MANDATO BLOCO 2 — REGRAS TEMPORAIS POR TERCEIRO/CARTÓRIO + OVERRIDE LOCAL\n")

  const marco = await usuario("Marco")

  // ══════════════════════════════════════════════════════════════════════
  secao("1) CADASTRO — dois cartórios reais, regras temporais distintas (o exemplo literal do mandato)")
  // ══════════════════════════════════════════════════════════════════════
  const cartorioX = await prisma.orgaoProtocolo.create({ data: { name: `${MARCA} Cartório X`, type: "cartorio" }, select: { id: true } })
  const cartorioLento = await prisma.orgaoProtocolo.create({ data: { name: `${MARCA} Cartório Lento`, type: "cartorio" }, select: { id: true } })
  await prisma.regraTemporalOrgao.create({
    data: { stepKey: "solicitar_certidao", orgaoProtocoloId: cartorioX.id, slaDays: 2, followUpDays: 3, chaveRegra: `${MARCA}-regra-x-solicitar` },
  })
  ok("1.1) regra do Cartório X cadastrada (confirmação estimada 2 dias, 1º follow-up 3 dias)", true)

  // ══════════════════════════════════════════════════════════════════════
  secao("2) PRECEDÊNCIA — cartório específico vence sobre o default do Step/Workflow")
  // ══════════════════════════════════════════════════════════════════════
  const r1 = await resolverPoliticaTemporal(prisma, { stepKey: "solicitar_certidao", orgaoProtocoloId: cartorioX.id, slaDaysDoPasso: 5 })
  ok("2.1) com regra do Cartório X: slaDays=2 (NÃO 5, o default do passo)", r1.slaDays === 2, JSON.stringify(r1))
  ok("2.1) origem reportada é ORGAO", r1.origem === "ORGAO")
  ok("2.1) followUpDays vem do cadastro do órgão", r1.followUpDays === 3)

  const r2 = await resolverPoliticaTemporal(prisma, { stepKey: "solicitar_certidao", orgaoProtocoloId: cartorioLento.id, slaDaysDoPasso: 5 })
  ok("2.2) sem regra para o Cartório Lento: cai para o default do passo (5)", r2.slaDays === 5, JSON.stringify(r2))
  ok("2.2) origem reportada é PASSO", r2.origem === "PASSO")

  const r3 = await resolverPoliticaTemporal(prisma, { stepKey: "solicitar_certidao", orgaoProtocoloId: cartorioLento.id, slaDaysDoPasso: null })
  ok("2.3) sem regra de órgão E sem SLA do passo: sem prazo (nunca inventa data)", r3.slaDays === null, JSON.stringify(r3))
  ok("2.3) origem reportada é DEFAULT", r3.origem === "DEFAULT")

  const r4 = await resolverPoliticaTemporal(prisma, { stepKey: "aguardar_retorno_do_cartorio", orgaoProtocoloId: cartorioX.id, slaDaysDoPasso: 20 })
  ok("2.4) regra é POR PASSO, não vale para outro passo do mesmo órgão sem cadastro próprio", r4.slaDays === 20 && r4.origem === "PASSO", JSON.stringify(r4))

  // Segundo passo, com sua PRÓPRIA regra — prova o exemplo completo do mandato
  // ("emissão estimada 15 dias, follow-up da emissão 7 dias").
  await prisma.regraTemporalOrgao.create({
    data: { stepKey: "aguardar_retorno_do_cartorio", orgaoProtocoloId: cartorioX.id, slaDays: 15, followUpDays: 7, chaveRegra: `${MARCA}-regra-x-aguardar` },
  })
  const r5 = await resolverPoliticaTemporal(prisma, { stepKey: "aguardar_retorno_do_cartorio", orgaoProtocoloId: cartorioX.id, slaDaysDoPasso: 20 })
  ok("2.5) o exemplo literal do mandato: Cartório X — emissão estimada 15, follow-up 7", r5.slaDays === 15 && r5.followUpDays === 7, JSON.stringify(r5))

  secao("2.6) regra DESATIVADA não vale mais (ativo=false) — volta para o default do passo")
  const orgTemp = await prisma.orgaoProtocolo.create({ data: { name: `${MARCA} Cartório Desativado`, type: "cartorio" }, select: { id: true } })
  await prisma.regraTemporalOrgao.create({
    data: { stepKey: "solicitar_certidao", orgaoProtocoloId: orgTemp.id, slaDays: 1, ativo: false, chaveRegra: `${MARCA}-regra-desativada` },
  })
  const r6 = await resolverPoliticaTemporal(prisma, { stepKey: "solicitar_certidao", orgaoProtocoloId: orgTemp.id, slaDaysDoPasso: 5 })
  ok("2.6) regra ativo=false é ignorada", r6.slaDays === 5 && r6.origem === "PASSO", JSON.stringify(r6))

  // ══════════════════════════════════════════════════════════════════════
  secao("3) WIRING REAL — registrarSolicitacaoDocumento grava orgaoId estrutural e resolve o prazo automaticamente")
  // ══════════════════════════════════════════════════════════════════════
  const p1 = await palco()
  const ctx = { usuarioId: marco.id, isAdmin: true, permissoes: { "workflow.iniciarPasso": true, "workflow.concluirPasso": true } }
  const antesEnvio = new Date()
  const resultado = await registrarSolicitacaoDocumento(
    p1.documentoId, p1.stepInstanceId,
    { canal: "EMAIL", destinatarioNome: "Cartório X — 1º Ofício", orgaoId: cartorioX.id, requerimento: { url: "https://exemplo.test/requerimento.pdf" } },
    ctx,
  )
  ok("3.1) registrarSolicitacaoDocumento sucede", resultado.ok === true, JSON.stringify(resultado).slice(0, 200))

  const sol = await prisma.solicitacaoDocumento.findUniqueOrThrow({ where: { id: (resultado as { ok: true; solicitacaoId: number }).solicitacaoId }, select: { orgaoId: true, prazoEsperadoDias: true, previsaoRetorno: true, destinatarioNome: true } })
  ok("3.2) orgaoId GRAVADO estruturalmente (achado do mandato: nunca era gravado antes)", sol.orgaoId === cartorioX.id, String(sol.orgaoId))
  ok("3.3) prazoEsperadoDias resolvido pela regra do Cartório X (2, não o default do passo=5)", sol.prazoEsperadoDias === 2, String(sol.prazoEsperadoDias))
  ok("3.4) previsaoRetorno (dimensão C do motor temporal) foi PREENCHIDA — achado do mandato: nunca era escrita antes", sol.previsaoRetorno != null, String(sol.previsaoRetorno))
  ok("3.5) previsaoRetorno é depois do envio (dias úteis à frente, nunca no passado)", sol.previsaoRetorno! > antesEnvio)

  secao("3.6) operador digita um prazo manualmente — isso VENCE a regra do cartório (o dado mais forte é a promessa desta vez)")
  const p2 = await palco()
  const resultado2 = await registrarSolicitacaoDocumento(
    p2.documentoId, p2.stepInstanceId,
    { canal: "EMAIL", destinatarioNome: "Cartório X — 1º Ofício", orgaoId: cartorioX.id, prazoEsperadoDias: 30, requerimento: { url: "https://exemplo.test/requerimento2.pdf" } },
    ctx,
  )
  ok("3.6) sucede", resultado2.ok === true)
  const sol2 = await prisma.solicitacaoDocumento.findUniqueOrThrow({ where: { id: (resultado2 as { ok: true; solicitacaoId: number }).solicitacaoId }, select: { prazoEsperadoDias: true } })
  ok("3.6) prazo digitado pelo operador (30) prevalece sobre a regra do cartório (2)", sol2.prazoEsperadoDias === 30, String(sol2.prazoEsperadoDias))

  // ══════════════════════════════════════════════════════════════════════
  secao("4) OVERRIDE LOCAL PONTUAL (4º degrau) — reaproveita alterarPrazo, NÃO altera cadastro")
  // ══════════════════════════════════════════════════════════════════════
  const p3 = await palco()
  const prazoAntesOverride = await prisma.tarefa.findUniqueOrThrow({ where: { id: p3.tarefaId }, select: { dataPrazo: true } })
  const novoPrazo = new Date(Date.now() + 45 * 86400000)
  const rOverride = await alterarPrazo({ tarefaId: p3.tarefaId, autorId: marco.id, novoPrazo, motivo: "Cartório informou por telefone que este pedido específico vai demorar 45 dias (feriado local prolongado)." })
  ok("4.1) override local sucede", rOverride.ok === true, JSON.stringify(rOverride))
  const prazoDepoisOverride = await prisma.tarefa.findUniqueOrThrow({ where: { id: p3.tarefaId }, select: { dataPrazo: true } })
  ok("4.2) VALOR — o prazo da Tarefa mudou para o valor informado", prazoDepoisOverride.dataPrazo?.getTime() === novoPrazo.getTime())
  const logOverride = await prisma.logAuditoria.findFirst({ where: { entidade: "Tarefa", entidadeId: p3.tarefaId, acao: "TAREFA_PRAZO_ALTERADO" }, orderBy: { id: "desc" } })
  ok("4.3) MOTIVO registrado", (logOverride?.detalhes as Record<string, unknown> | null)?.motivo === "Cartório informou por telefone que este pedido específico vai demorar 45 dias (feriado local prolongado).")
  ok("4.4) AUTOR registrado", logOverride?.usuarioId === marco.id)
  ok("4.5) DATA/HORA registrada (LogAuditoria.criadoEm)", logOverride != null)
  ok("4.6) ORIGEM/EVIDÊNCIA — valor anterior preservado no detalhe ('de')", (logOverride?.detalhes as Record<string, unknown> | null)?.de === prazoAntesOverride.dataPrazo?.toISOString())
  const regraIntacta = await prisma.regraTemporalOrgao.findUnique({ where: { chaveRegra: `${MARCA}-regra-x-solicitar` }, select: { slaDays: true } })
  ok("4.7) NÃO altera configuração global — RegraTemporalOrgao do Cartório X continua com slaDays=2 após o override local", regraIntacta?.slaDays === 2, String(regraIntacta?.slaDays))
  const r7 = await resolverPoliticaTemporal(prisma, { stepKey: "solicitar_certidao", orgaoProtocoloId: cartorioX.id, slaDaysDoPasso: 5 })
  ok("4.8) outra resolução para o MESMO (passo, órgão) continua devolvendo 2 — override é só desta Tarefa, não vaza para o cadastro", r7.slaDays === 2)

  await limpar()

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
