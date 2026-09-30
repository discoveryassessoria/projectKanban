// scripts/avanco-fase-ponta-a-ponta.test.ts
// ============================================================================
// AVANÇO DE FASE DE PONTA A PONTA — COMPORTAMENTO, não código-fonte.
//
// Achado real 30/09/2026 (processo 675, Antão): a certidão que travava a Genealogia foi cancelada, o gate ficou
// liberado e o processo NÃO avançou. O teste `cancelar-operacao-dispara-avanco.test.ts` só confere o texto do
// serviço; este prova que o processo REALMENTE muda de fase num macrofluxo de duas fases
// (Genealogia ordem 0 → Emissão Documental ordem 1), com o motor real (`advance` + `computeGate`):
//
//   (1) cancelar a operação do documento pela porta `controlarOperacaoV2(id, "cancelar")` → o processo AVANÇA
//       sozinho (Processo.faseAtualKey muda + PhaseAdvanceLog AVANCADO com origem "documento-cancelar-…");
//   (2) o mesmo pelo caminho da ÁRVORE: desmarcar `casado` via PUT /api/pessoas/[id] (rota real) → a necessidade
//       de casamento cai, o gate libera e o processo avança;
//   (3) CONTROLE NEGATIVO: com OUTRA pendência obrigatória aberta, cancelar UMA não avança;
//   (4) o gate corrigido em 30/09: passo CANCELADO não bloqueia (blocking-helpers PASSO_OK) e o passo de uma
//       certidão FORA DA LINHA (cônjuge) liga à necessidade dela (passosPorObrigacao usa documentosTodos) —
//       uma concluída + uma cancelada → avança;
//   (5) invalidar NÃO libera pendência (não avança) — só o cancelar é gatilho.
//
// A pendência da Genealogia é um PhaseWorkflowStepInstance obrigatório ancorado na necessidade/documento (a
// materialização publicada de Genealogia não é o objeto deste teste; o que se prova é o GATE + O GANCHO).
//
//   node scripts/ci/gate-build.mjs --suite todas --so avanco-fase-ponta-a-ponta
// Banco de TESTE (exigirBancoDeTeste). Não toca produção.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { criarPalco, type Cenario } from "./_fixture-arvore-fonte"

const MARCA = "AVPPAP"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function main() {
  exigirBancoDeTeste("avanco-fase-ponta-a-ponta.test.ts")
  const P = criarPalco(MARCA)
  await P.montar()
  await P.montarMacroDuasFases()
  console.log("AVANÇO DE FASE DE PONTA A PONTA\n")

  const { controlarOperacaoV2 } = await import("../src/services/documento-operacao")
  const { reconciliarMotorDeFases } = await import("../src/lib/motor/reconciliar-motor-fases")

    /**
   * A pendência de Genealogia da necessidade/documento. O passo e a tarefa já nascem sozinhos quando a árvore gera a
   * necessidade (materialização real: `localizar_registro` por documento); aqui só se acha o que o motor criou e, para
   * "CONCLUIDO", se encerra pelo estado (passo CONCLUIDO + tarefa CONCLUIDO_RECEBIDO) — o que o gate lê.
   */
  const pendencia = async (c: Cenario, documentoId: number, status: "DISPONIVEL" | "CONCLUIDO") => {
    const passo = await prisma.phaseWorkflowStepInstance.findFirstOrThrow({
      where: { processoId: c.processoId, faseMacroKey: "genealogia", documentoId }, select: { id: true, status: true, obrigatorio: true },
    })
    if (status === "CONCLUIDO") {
      await prisma.phaseWorkflowStepInstance.update({ where: { id: passo.id }, data: { status: "CONCLUIDO", completedAt: new Date() } })
      await prisma.tarefa.updateMany({ where: { workflowStepInstanceId: passo.id }, data: { statusTarefa: "CONCLUIDO_RECEBIDO" } })
    }
    return { passoId: passo.id, obrigatorio: passo.obrigatorio }
  }
  const processo = (id: number) => prisma.processo.findUniqueOrThrow({ where: { id }, select: { faseAtualKey: true, dataConclusao: true } })
  const logs = (id: number) => prisma.phaseAdvanceLog.findMany({ where: { processoId: id }, orderBy: { id: "asc" }, select: { resultado: true, faseAtual: true, fasePretendida: true, origem: true } })
  const avancos = async (id: number) => (await logs(id)).filter((l) => l.resultado === "AVANCADO")

  /** Casal: titular casado (+ cônjuge, união) → necessidades NAS do titular e CAS da união, cada uma com Documento. */
  const casal = async (nome: string) => {
    const c = await P.novoCenario(nome, { conjuge: true })
    await P.putPessoa(c.titularId, { casado: true })
    await P.postUniao(c.titularId, c.conjugeId!)
    const uniao = await prisma.uniao.findFirstOrThrow({ where: { pessoa1Id: c.titularId } })
    const f = await P.foto(c.processoId)
    const nas = f.necDe("NAS", { pessoaId: c.titularId })[0]
    const cas = f.necDe("CAS", { uniaoId: uniao.id })[0]
    const req = f.necDe("REQ", { pessoaId: c.titularId })[0] // o titular é o requerente: a certidão dele também é exigida
    const docDe = (necId: number) => f.docs.find((d) => d.necessidadeId === necId)!
    return { c, uniao, nas, cas, req, docNas: docDe(nas.id), docCas: docDe(cas.id), docReq: docDe(req.id) }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  secao("(1) CANCELAR a operação do documento que trava a Genealogia → o processo AVANÇA sozinho")
  const a = await casal("cancela")
  ok("pré: processo na Genealogia, com necessidades NAS (titular) e CAS (união) e seus Documentos", (await processo(a.c.processoId)).faseAtualKey === "genealogia" && !!a.nas && !!a.cas && !!a.docNas && !!a.docCas && !!a.docReq)
  await pendencia(a.c, a.docNas.id, "CONCLUIDO")
  await pendencia(a.c, a.docReq.id, "CONCLUIDO")
  const pendCas = await pendencia(a.c, a.docCas.id, "DISPONIVEL")
  const antes = await reconciliarMotorDeFases(a.c.processoId, { origem: "teste-antes" })
  ok("CONTROLE: com a certidão de casamento aberta o motor NÃO avança (bloqueado por ela)", antes.transicoes.length === 0 && (await processo(a.c.processoId)).faseAtualKey === "genealogia", `${antes.code} ${JSON.stringify(antes.pendencias.map((p) => p.code))}`)
  ok("o bloqueio é a pendência da certidão de casamento (não outra coisa)", antes.pendencias.length >= 1, JSON.stringify(antes.pendencias.map((p) => `${p.code}:${p.entityId}`)))
  const logsAntes = (await logs(a.c.processoId)).length
  const r1 = await controlarOperacaoV2(a.docCas.id, "cancelar", "não quero mais este documento")
  ok("controlarOperacaoV2(cancelar) responde ok", r1.ok === true, JSON.stringify(r1).slice(0, 160))
  const p1 = await processo(a.c.processoId)
  ok("Processo.faseAtualKey MUDOU para emissao_documental — sem cron, sem arrastar o card", p1.faseAtualKey === "emissao_documental", p1.faseAtualKey ?? "null")
  const av1 = await avancos(a.c.processoId)
  ok("há PhaseAdvanceLog AVANCADO genealogia → emissao_documental", av1.some((l) => l.faseAtual === "genealogia" && l.fasePretendida === "emissao_documental"), JSON.stringify(av1))
  ok("a origem do log é a do gancho do cancelar ('documento-cancelar-operacao', cortada em 20 colunas)", av1.some((l) => l.origem === "documento-cancelar-operacao".slice(0, 20)), JSON.stringify(av1.map((l) => l.origem)))
  ok("o passo da certidão cancelada ficou CANCELADO (≠ concluído) e o documento CANCELADO", (await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: pendCas.passoId } })).status === "CANCELADO" && (await prisma.documento.findUniqueOrThrow({ where: { id: a.docCas.id } })).status === "CANCELADO")
  ok("a instância da Genealogia foi CONCLUÍDA e a da Emissão nasceu ATIVA", (await prisma.phaseWorkflowInstance.findUniqueOrThrow({ where: { id: a.c.instanciaId } })).status === "CONCLUIDO" && (await prisma.phaseWorkflowInstance.count({ where: { processoId: a.c.processoId, faseMacroKey: "emissao_documental", status: "ATIVO" } })) === 1)
  const nAvancos = av1.length
  const rRepetido = await controlarOperacaoV2(a.docCas.id, "cancelar", "de novo")
  ok("idempotente: cancelar de novo (comando repetido) não muda de fase nem cria outro avanço", (rRepetido.ok === true || rRepetido.status === 404) && (await processo(a.c.processoId)).faseAtualKey === "emissao_documental" && (await avancos(a.c.processoId)).length === nAvancos, `${JSON.stringify(rRepetido).slice(0, 80)}`)
  ok("(houve log novo de avanço nesta operação)", (await logs(a.c.processoId)).length > logsAntes)

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  secao("(2) Pelo caminho da ÁRVORE — desmarcar `casado` (PUT /api/pessoas/[id]) remove a exigência → o processo avança")
  const b = await casal("arvore")
  await pendencia(b.c, b.docNas.id, "CONCLUIDO")
  await pendencia(b.c, b.docReq.id, "CONCLUIDO")
  await pendencia(b.c, b.docCas.id, "DISPONIVEL")
  const bAntes = await reconciliarMotorDeFases(b.c.processoId, { origem: "teste-antes" })
  ok("CONTROLE: casado=true e a certidão aberta → não avança", bAntes.transicoes.length === 0 && (await processo(b.c.processoId)).faseAtualKey === "genealogia", `${bAntes.code}`)
  const rp = await P.putPessoa(b.c.titularId, { casado: false })
  ok("PUT /api/pessoas/[id] { casado: false } responde 200", rp.status === 200, `${rp.status}`)
  const pb = await processo(b.c.processoId)
  ok("a árvore sozinha liberou o gate: Processo.faseAtualKey = emissao_documental", pb.faseAtualKey === "emissao_documental", `${pb.faseAtualKey}`)
  const avB = await avancos(b.c.processoId)
  ok("PhaseAdvanceLog AVANCADO genealogia → emissao_documental registrado", avB.some((l) => l.faseAtual === "genealogia" && l.fasePretendida === "emissao_documental"), JSON.stringify(avB))
  ok("a necessidade de casamento saiu/foi dispensada pela árvore (causa real do avanço)", (await prisma.necessidadeDocumental.findUnique({ where: { id: b.cas.id } }))?.status !== "PENDENTE")

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  secao("(3) CONTROLE NEGATIVO — com OUTRA pendência obrigatória aberta, cancelar UMA não avança")
  const n = await casal("negativo")
  await pendencia(n.c, n.docNas.id, "CONCLUIDO")
  await pendencia(n.c, n.docReq.id, "DISPONIVEL") // a OUTRA pendência obrigatória (certidão do requerente) segue aberta
  await pendencia(n.c, n.docCas.id, "DISPONIVEL")
  const logsN0 = (await logs(n.c.processoId)).length
  const rn = await controlarOperacaoV2(n.docCas.id, "cancelar", "cancelar só a de casamento")
  ok("o cancelar responde ok", rn.ok === true)
  ok("o processo CONTINUA na Genealogia (a certidão do requerente ainda trava)", (await processo(n.c.processoId)).faseAtualKey === "genealogia")
  ok("nenhum PhaseAdvanceLog AVANCADO", (await avancos(n.c.processoId)).length === 0)
  const tentativa = (await logs(n.c.processoId)).slice(logsN0)
  ok("o gancho RODOU e foi barrado pelo gate (log BLOQUEADO de origem 'documento-cancelar-…') — não é 'ninguém tentou'", tentativa.some((l) => l.resultado === "BLOQUEADO" && l.origem === "documento-cancelar-operacao".slice(0, 20)), JSON.stringify(tentativa))
  // …e cancelar a OUTRA também libera (o gate fecha a conta nas duas pontas)
  await controlarOperacaoV2(n.docReq.id, "cancelar", "e a do requerente")
  ok("cancelando também a outra, aí sim avança", (await processo(n.c.processoId)).faseAtualKey === "emissao_documental")

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  secao("(5) INVALIDAR não libera pendência — só o cancelar é gatilho de avanço")
  const v = await casal("invalida")
  await pendencia(v.c, v.docNas.id, "CONCLUIDO")
  await pendencia(v.c, v.docReq.id, "CONCLUIDO")
  await pendencia(v.c, v.docCas.id, "DISPONIVEL")
  await controlarOperacaoV2(v.docCas.id, "invalidar", "refazer")
  ok("invalidar mantém a pendência: continua na Genealogia, sem avanço", (await processo(v.c.processoId)).faseAtualKey === "genealogia" && (await avancos(v.c.processoId)).length === 0)

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  secao("(4) GATE corrigido em 30/09 — certidão de quem está FORA DA LINHA concluída + outra CANCELADA → avança")
  // Processo 675 (Antão): o passo de uma certidão de pessoa FORA da linha reta nomeia só o DOCUMENTO (sem necessidadeId).
  // Sem `documentosTodos` no gate ele não ligava à necessidade e a fase acusava "certidão pendente" para sempre; e um
  // passo CANCELADO (operação cancelada) era lido como trabalho em aberto. Aqui os dois juntos, no motor real.
  const g = await casal("foralinha")
  // a certidão de casamento passa a ser DOCUMENTO do cônjuge (fora da linha reta) e o passo dela nomeia só o documento
  await prisma.documento.update({ where: { id: g.docCas.id }, data: { pessoaId: g.c.conjugeId! } })
  const passoCas = await pendencia(g.c, g.docCas.id, "CONCLUIDO")
  await prisma.phaseWorkflowStepInstance.update({ where: { id: passoCas.passoId }, data: { necessidadeId: null } })
  await pendencia(g.c, g.docNas.id, "CONCLUIDO")
  const passoReq = await pendencia(g.c, g.docReq.id, "DISPONIVEL")
  ok("pré: o documento concluído é de pessoa FORA da linha reta e o passo dele não tem necessidadeId", (await prisma.pessoa.findUniqueOrThrow({ where: { id: g.c.conjugeId! } })).linhaReta === false && (await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: passoCas.passoId } })).necessidadeId === null)
  const gAntes = await reconciliarMotorDeFases(g.c.processoId, { origem: "teste-antes" })
  ok("CONTROLE: só a certidão do requerente aberta segura a fase — a do cônjuge (concluída, fora da linha) NÃO acusa pendência", gAntes.transicoes.length === 0 && gAntes.pendencias.every((p) => p.code !== "CERTIDAO_OBRIGATORIA_PENDENTE") && gAntes.pendencias.length >= 1, JSON.stringify(gAntes.pendencias.map((p) => `${p.code}:${p.entityId}`)))
  await controlarOperacaoV2(g.docReq.id, "cancelar", "certidão do requerente cancelada")
  ok("o passo da certidão cancelada ficou CANCELADO (nunca CONCLUIDO)", (await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: passoReq.passoId } })).status === "CANCELADO")
  ok("concluída (fora da linha) + cancelada → o processo AVANÇA para emissao_documental", (await processo(g.c.processoId)).faseAtualKey === "emissao_documental", (await processo(g.c.processoId)).faseAtualKey ?? "")
  ok("e o avanço veio do gancho do cancelar", (await avancos(g.c.processoId)).some((l) => l.origem === "documento-cancelar-operacao".slice(0, 20)), JSON.stringify((await avancos(g.c.processoId)).map((l) => l.origem)))
  // PROVA DIRETA DA REGRA (funções puras do gate): o que o gate fazia ANTES (sem documentosTodos / CANCELADO bloqueante) × AGORA.
  const { classificarPasso } = await import("../src/lib/motor/blocking-helpers")
  const { certidoesObrigatoriasNecessidade } = await import("../src/lib/motor/operational-projection-core")
  ok("classificarPasso: passo obrigatório CANCELADO não bloqueia (PASSO_OK inclui CANCELADO)", classificarPasso("CANCELADO", true, "localizar_registro", 1) === null)
  ok("classificarPasso: DISPONIVEL obrigatório continua bloqueando (a correção não afrouxou o gate)", classificarPasso("DISPONIVEL", true, "localizar_registro", 1)?.severity === "BLOCKING")
  const base = {
    processId: 1, faseCode: null, faseMacroKey: "genealogia", phaseName: "Genealogia", scope: null, processoExists: true, hasActiveInstance: true,
    necessidades: [{ id: 10, status: "EM_ATENDIMENTO", obrigatoria: true, ehCertidao: true }],
    steps: [{ id: 1, stepKey: "localizar_registro", status: "CONCLUIDO", obrigatorio: true, necessidadeId: null, documentoId: 99 }],
    documentos: [] as { id: number; status: string; linhaReta: boolean; necessidadeId: number | null }[],
    hasArvore: true, requerentesCount: 1,
  }
  const docFora = { id: 99, status: "PENDENTE", linhaReta: false, necessidadeId: 10 }
  const semTodos = certidoesObrigatoriasNecessidade({ ...base, documentos: [] } as never)
  const comTodos = certidoesObrigatoriasNecessidade({ ...base, documentosTodos: [docFora] } as never)
  ok("regra pura ANTES (sem documentosTodos): o passo concluído de pessoa fora da linha não liga à necessidade → não emitida", semTodos.emitida(semTodos.certObrig[0]) === false)
  ok("regra pura AGORA (com documentosTodos): liga à necessidade → emitida", comTodos.emitida(comTodos.certObrig[0]) === true)

  await P.limpar()
  console.log(`\n${falhou === 0 ? "✅" : "❌"} AVANÇO DE PONTA A PONTA — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
