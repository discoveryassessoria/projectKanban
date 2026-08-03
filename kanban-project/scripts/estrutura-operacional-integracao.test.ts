// scripts/estrutura-operacional-integracao.test.ts
//
// TESTE DE INTEGRAÇÃO da ESTRUTURA OPERACIONAL contra o BANCO REAL.
//
// Cenário do enunciado, materializado pelo motor oficial (reconciliarFaseAtiva) e
// lido pela consulta oficial (getPhaseOperationalStructure):
//
//   Marco  (requerente) → Certidão de Nascimento
//   João   (pai)        → Certidão de Nascimento
//   Tereza (mãe)        → Certidão de Nascimento + Certidão de Casamento
//   Ana    (avó)        → nenhum documento aplicável
//
// Esperado: 4 pessoas na Central · 3 com trabalho · 4 documentos · 4 workflows
// documentais · 5 passos por documento · 20 instâncias · sequência INDEPENDENTE por
// documento (concluir o passo do João não mexe no da Tereza).
//
// Roda contra o BANCO DE TESTE LOCAL (nunca produção):
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//   DIRECT_DATABASE_URL=...                                                  \
//   npx tsx scripts/estrutura-operacional-integracao.test.ts

import { PrismaClient } from "@prisma/client"
import { reconciliarFaseAtiva } from "../src/services/reconciliar-fase"
import { getPhaseOperationalStructure } from "../src/lib/process-stage/estrutura-operacional"
import { atualizarPassoV2 } from "../src/services/documento-operacao"

const url = process.env.PRISMA_DATABASE_URL ?? ""
if (!/discovery_test/.test(url)) {
  console.error("❌ recusado: este teste só roda no banco de teste local (discovery_test).")
  process.exit(1)
}

const prisma = new PrismaClient()
let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

const PASSOS_EMISSAO = [
  "Solicitar certidão",
  "Aguardar retorno do cartório",
  "Receber certidão",
  "Conferir certidão",
  "Validar certidão",
]

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")

async function limpar() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Processo","Arvore","Pessoa","Uniao","Documento","NecessidadeDocumental","NecessidadeDocumentalEvento","PhaseWorkflowInstance","PhaseWorkflowStepInstance","PhaseInternalWorkflow","PhaseInternalWorkflowStep","WorkflowEvento","DomainOutbox","Tarefa","MacroWorkflow","FaseMacro","MatrizDocumental","TipoDocumentoCadastro","ItemCatalogo","PhaseAdvanceLog" RESTART IDENTITY CASCADE',
  )
}

async function semear() {
  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })
  const tipo = await prisma.tipoProcessoNacionalidade.upsert({
    where: { code: "ALE-ADM" }, update: {},
    create: {
      code: "ALE-ADM", name: "Nacionalidade Alemã", countryKey: "alemanha", countryLabel: "Alemanha",
      nationalityKey: "alema", nationalityLabel: "Alemã", modalityKey: "administrativa",
      modalityLabel: "Administrativa", processFamily: "CIDADANIA", serviceNature: "PROCESSO",
    },
  })

  for (const c of [
    { code: "IT - NAS", name: "Certidão de nascimento - Inteiro Teor", enumKey: "CERTIDAO_NASCIMENTO_INTEIRO_TEOR" },
    { code: "IT - CAS", name: "Certidão de casamento - Inteiro Teor", enumKey: "CERTIDAO_CASAMENTO_INTEIRO_TEOR" },
    { code: "IT - OBI", name: "Certidão de óbito - Inteiro Teor", enumKey: "CERTIDAO_OBITO_INTEIRO_TEOR" },
  ]) {
    const item = await prisma.itemCatalogo.create({ data: { code: c.code, name: c.name, natureza: "DOCUMENTO" } })
    await prisma.tipoDocumentoCadastro.create({
      data: { code: c.code, name: c.name, nature: "certidao", legacyEnumKey: c.enumKey, itemCatalogoId: item.id },
    })
  }

  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, name: "Macro ALE", versao: 1 } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: "emissao_documental", label: "emissao_documental", ordem: 0, versao: 1 } })

  // WORKFLOW INTERNO PUBLICADO da Emissão — a ÚNICA definição dos passos.
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: "all::emissao_documental", phaseKey: "emissao_documental", name: "Workflow Interno · Emissão Documental", tipoProcessoId: null, versao: 1, execucao: "SEQUENCIAL" },
  })
  await prisma.phaseInternalWorkflowStep.createMany({
    data: PASSOS_EMISSAO.map((label, i) => ({
      workflowId: wf.id, key: slug(label), label, ordem: i + 1,
      createsTask: true, required: true, owner: "equipe_documental", slaDays: 5,
    })),
  })
  return tipo.id
}

async function main() {
  await limpar()
  const tipoId = await semear()

  // ── ÁRVORE DO CENÁRIO ──────────────────────────────────────────────────────
  const arvore = await prisma.arvore.create({ data: { nome: "Árvore Teste" } })
  const ana = await prisma.pessoa.create({ data: { nome: "Ana", sobrenome: "Silva", sexo: "F", arvoreId: arvore.id, linhaReta: true, requerente: "nao" } })
  const joao = await prisma.pessoa.create({ data: { nome: "João", sobrenome: "Silva", sexo: "M", arvoreId: arvore.id, linhaReta: true, requerente: "nao", maeId: ana.id } })
  const tereza = await prisma.pessoa.create({ data: { nome: "Tereza", sobrenome: "Silva", sexo: "F", arvoreId: arvore.id, linhaReta: false, requerente: "nao" } })
  const marco = await prisma.pessoa.create({ data: { nome: "Marco", sobrenome: "Rovatti", sexo: "M", arvoreId: arvore.id, linhaReta: true, requerente: "maior", paiId: joao.id, maeId: tereza.id } })
  await prisma.uniao.create({ data: { pessoa1Id: tereza.id, pessoa2Id: joao.id } })

  const processo = await prisma.processo.create({
    data: { nome: "Processo Teste", codigo: "T-EST", pais: "Alemanha", arvoreId: arvore.id, faseAtualKey: "emissao_documental", tipoProcessoMotorId: tipoId, workflowRuntime: "v2" },
  })

  // 4 CERTIDÕES EXIGIDAS + os documentos que as atendem, exatamente como em produção:
  // a Emissão opera por DOCUMENTO, então a instância do passo carrega SÓ o
  // `documentoId` — a identidade da certidão (requisito, titular, país) vem da
  // NECESSIDADE ligada a esse documento. É por esse caminho que o alvo é resolvido.
  const itemNasc = (await prisma.itemCatalogo.findFirst({ where: { code: "IT - NAS" } }))!
  const itemCas = (await prisma.itemCatalogo.findFirst({ where: { code: "IT - CAS" } }))!
  const uniao = (await prisma.uniao.findFirst({ where: { pessoa1Id: tereza.id } }))!
  const nec = async (itemId: number, sujeito: { pessoaId?: number; uniaoId?: number }, chave: string) =>
    prisma.necessidadeDocumental.create({
      data: { processoId: processo.id, itemCatalogoId: itemId, ...sujeito, origem: "ARVORE", obrigatoriedade: "OBRIGATORIA", chaveIdempotencia: chave },
    })
  const necs = {
    marcoNasc: await nec(itemNasc.id, { pessoaId: marco.id }, "n|marco|nasc"),
    joaoNasc: await nec(itemNasc.id, { pessoaId: joao.id }, "n|joao|nasc"),
    terezaNasc: await nec(itemNasc.id, { pessoaId: tereza.id }, "n|tereza|nasc"),
    terezaCas: await nec(itemCas.id, { uniaoId: uniao.id }, "n|tereza|cas"),
  }
  const doc = async (pessoaId: number, tipo: "CERTIDAO_NASCIMENTO" | "CERTIDAO_CASAMENTO", necessidadeId: number) =>
    prisma.documento.create({ data: { pessoaId, tipo, status: "PENDENTE", necessidadeId } })
  const docs = {
    marcoNasc: await doc(marco.id, "CERTIDAO_NASCIMENTO", necs.marcoNasc.id),
    joaoNasc: await doc(joao.id, "CERTIDAO_NASCIMENTO", necs.joaoNasc.id),
    terezaNasc: await doc(tereza.id, "CERTIDAO_NASCIMENTO", necs.terezaNasc.id),
    terezaCas: await doc(tereza.id, "CERTIDAO_CASAMENTO", necs.terezaCas.id),
  }

  const r = await reconciliarFaseAtiva(processo.id)
  check("reconciliação da fase sem erro", r.erro === null, r.erro ?? undefined)

  // ── ESTRUTURA OFICIAL ──────────────────────────────────────────────────────
  console.log("\n(1) Contagens do cenário")
  const { estrutura } = await getPhaseOperationalStructure({ processoId: processo.id, faseMacroKey: "emissao_documental" })
  const linhas = [...estrutura.linhaPrincipal, ...estrutura.foraDaLinha, ...estrutura.pendenteClassificacao]
  const de = (id: number) => linhas.find((l) => l.pessoa.pessoaId === id)!

  const instancias = await prisma.phaseWorkflowStepInstance.count({ where: { processoId: processo.id } })
  check("20 instâncias de passo no banco (5 passos × 4 documentos)", instancias === 20, String(instancias))
  check("4 pessoas na Central", linhas.length === 4, String(linhas.length))
  check("3 pessoas com trabalho", estrutura.resumo.pessoasComTrabalho === 3, String(estrutura.resumo.pessoasComTrabalho))
  check("4 documentos", estrutura.resumo.documentos === 4, String(estrutura.resumo.documentos))
  check("4 workflows documentais (um por documento)", linhas.flatMap((l) => l.documentos).length === 4)
  check("5 passos dentro de CADA documento", linhas.flatMap((l) => l.documentos).every((d) => d.passos.length === 5))
  check("20 passos na estrutura (nada perdido no agrupamento)", linhas.flatMap((l) => l.documentos).flatMap((d) => d.passos).length === 20)
  check("nenhuma lista global redundante (sem passo de escopo PROCESSO)", estrutura.globais.length === 0)
  // A regressão medida em produção: passo escopado por DOCUMENTO cuja identidade e
  // titular vêm da NECESSIDADE que o documento atende. Sem resolver esse vínculo, as
  // 4 certidões caíam em "sem dono" e as 3 pessoas apareciam sem trabalho.
  check("nenhum documento sem dono", estrutura.semDono.length === 0, JSON.stringify(estrutura.semDono.map((d) => d.chave)))
  check("a certidão é identificada pelo REQUISITO da necessidade, não pelo enum do documento",
    linhas.flatMap((l) => l.documentos).every((d) => /Inteiro Teor/.test(d.titulo)),
    linhas.flatMap((l) => l.documentos).map((d) => d.titulo).join(" | "))
  check("certidão de casamento (sujeito UNIÃO) fica com o titular certo",
    de(tereza.id).documentos.some((d) => /casamento/i.test(d.titulo)))

  console.log("\n(2) Cada certidão dentro da pessoa certa")
  check("Marco tem 1 documento", de(marco.id).documentos.length === 1)
  check("João tem 1 documento", de(joao.id).documentos.length === 1)
  check("Tereza tem 2 documentos", de(tereza.id).documentos.length === 2, String(de(tereza.id).documentos.length))
  check("Ana não tem documento aplicável", de(ana.id).semTrabalhoAplicavel === true)
  check("Ana continua VISÍVEL na Central", de(ana.id) != null)
  check("Tereza (fora da linha reta) fica no grupo 'fora da linhagem'", estrutura.foraDaLinha.some((l) => l.pessoa.pessoaId === tereza.id))
  check("documento do Marco é o dele", de(marco.id).documentos[0].documentoId === docs.marcoNasc.id)
  check("documento do João é o dele", de(joao.id).documentos[0].documentoId === docs.joaoNasc.id)
  check("os dois documentos da Tereza são os dela",
    de(tereza.id).documentos.map((d) => d.documentoId).sort((a, b) => (a ?? 0) - (b ?? 0)).join() ===
    [docs.terezaNasc.id, docs.terezaCas.id].sort((a, b) => a - b).join())
  check("nenhum documento aparece em duas pessoas", (() => {
    const ids = linhas.flatMap((l) => l.documentos.map((d) => d.documentoId))
    return ids.length === new Set(ids).size
  })())

  console.log("\n(3) Sequência independente por documento")
  const antes = linhas.flatMap((l) => l.documentos)
  check("o 1º passo de cada documento está disponível", antes.every((d) => d.passos[0].disponivel))
  check("os demais estão bloqueados", antes.every((d) => d.passos.slice(1).every((p) => p.bloqueado)))

  // Marco conclui "Solicitar certidão" do documento DELE, pelo serviço oficial.
  const passoMarco = de(marco.id).documentos[0].passos[0]
  const res = await atualizarPassoV2(docs.marcoNasc.id, passoMarco.stepInstanceId, { status: "CONCLUIDO" })
  check("concluir o passo pelo serviço oficial funciona", res.ok === true)

  const { estrutura: e2 } = await getPhaseOperationalStructure({ processoId: processo.id, faseMacroKey: "emissao_documental" })
  const linhas2 = [...e2.linhaPrincipal, ...e2.foraDaLinha, ...e2.pendenteClassificacao]
  const de2 = (id: number) => linhas2.find((l) => l.pessoa.pessoaId === id)!
  const docMarco = de2(marco.id).documentos[0]

  check("o passo concluído do Marco aparece concluído", docMarco.passos[0].balde === "CONCLUIDA")
  check("o PRÓXIMO passo do documento do Marco liberou", docMarco.passos[1].disponivel, docMarco.passos[1].status)
  check("o documento do João permanece INTACTO", (() => {
    const d = de2(joao.id).documentos[0]
    return d.passos[0].disponivel && d.passos.slice(1).every((p) => p.bloqueado)
  })())
  check("os documentos da Tereza permanecem INTACTOS", de2(tereza.id).documentos.every((d) => d.passos[0].disponivel && d.passos.slice(1).every((p) => p.bloqueado)))

  console.log("\n(4) Progresso")
  check("progresso do documento do Marco = 1/5 (20%)", docMarco.progresso.concluidos === 1 && docMarco.progresso.total === 5 && docMarco.progresso.pct === 20)
  check("progresso do Marco (1 documento) = o do documento", de2(marco.id).progresso.pct === 20)
  check("progresso da Tereza soma os 2 documentos dela", de2(tereza.id).progresso.total === 10 && de2(tereza.id).progresso.concluidos === 0)
  check("Ana não entra em denominador nenhum", de2(ana.id).progresso.total === 0)
  check("contadores da fase: 20 obrigatórios, 1 concluído", e2.resumo.passosObrigatorios === 20 && e2.resumo.passosObrigatoriosConcluidos === 1)
  check("concluir um passo não conclui documento nenhum", e2.resumo.documentosConcluidos === 0)

  console.log("\n(5) Recarregar não duplica e não perde histórico")
  const { estrutura: e3 } = await getPhaseOperationalStructure({ processoId: processo.id, faseMacroKey: "emissao_documental" })
  check("segunda leitura devolve exatamente a mesma estrutura", JSON.stringify(e3) === JSON.stringify(e2))
  await reconciliarFaseAtiva(processo.id)
  const depois = await prisma.phaseWorkflowStepInstance.count({ where: { processoId: processo.id } })
  check("reconciliar de novo NÃO duplica instâncias", depois === 20, String(depois))
  const concluidoAindaConcluido = await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: passoMarco.stepInstanceId }, select: { status: true, completedAt: true } })
  check("o passo concluído continua concluído (histórico preservado)", concluidoAindaConcluido?.status === "CONCLUIDO" && concluidoAindaConcluido?.completedAt != null)
  const eventos = await prisma.workflowEvento.count({ where: { processoId: processo.id, tipo: "PASSO_CONCLUIDO" } })
  check("a conclusão deixou rastro no Diário Operacional", eventos >= 1, String(eventos))

  console.log("\n(6) Conclusão de documento × conclusão de fase")
  // Conclui o documento do Marco inteiro, um passo por vez, pelo serviço oficial.
  for (let i = 1; i < 5; i++) {
    const { estrutura: eLoop } = await getPhaseOperationalStructure({ processoId: processo.id, faseMacroKey: "emissao_documental" })
    const d = [...eLoop.linhaPrincipal, ...eLoop.foraDaLinha].find((l) => l.pessoa.pessoaId === marco.id)!.documentos[0]
    const alvo = d.passos.find((p) => p.balde !== "CONCLUIDA")!
    await atualizarPassoV2(docs.marcoNasc.id, alvo.stepInstanceId, { status: "CONCLUIDO" })
  }
  const { estrutura: e4 } = await getPhaseOperationalStructure({ processoId: processo.id, faseMacroKey: "emissao_documental" })
  const linhas4 = [...e4.linhaPrincipal, ...e4.foraDaLinha, ...e4.pendenteClassificacao]
  const docMarco4 = linhas4.find((l) => l.pessoa.pessoaId === marco.id)!.documentos[0]
  check("o documento do Marco está concluído (5/5)", docMarco4.concluido && docMarco4.progresso.pct === 100)
  check("um documento concluído NÃO conclui a fase", e4.resumo.documentosConcluidos === 1 && e4.resumo.documentosPendentes === 3)
  const proc = await prisma.processo.findUnique({ where: { id: processo.id }, select: { faseAtualKey: true } })
  check("a fase NÃO avançou com documentos pendentes", proc?.faseAtualKey === "emissao_documental", String(proc?.faseAtualKey))
  check("os outros documentos seguem intactos", linhas4.flatMap((l) => l.documentos).filter((d) => d.chave !== docMarco4.chave).every((d) => d.progresso.concluidos === 0))

  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length > 0) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  · ${f}`)
  }
  await prisma.$disconnect()
  process.exit(falhas.length === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
