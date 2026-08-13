// scripts/motor-fases-passos.test.ts
//
// TESTE DE INTEGRAÇÃO do motor de fases: cada fase materializa EXATAMENTE os passos
// publicados no SEU workflow, na ordem e no escopo configurados — sem depender de
// necessidade documental, documento ou pessoa classificada.
//
// Roda contra o BANCO DE TESTE LOCAL (nunca produção):
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//   DIRECT_DATABASE_URL=...                                                  \
//   npx tsx scripts/motor-fases-passos.test.ts

import { PrismaClient } from "@prisma/client"
import { reconciliarFaseAtiva } from "../src/services/reconciliar-fase"
import { planejarMaterializacao } from "../src/services/phase-workflow-escopo"
import type { DefStep } from "../src/services/phase-workflow-helpers"

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

// Passos publicados por fase, exatamente como no cadastro de produção.
const CADASTRO: Array<{ phaseKey: string; nome: string; passos: string[] }> = [
  { phaseKey: "genealogia", nome: "Workflow Interno · Genealogia", passos: ["Localizar registro da certidão"] },
  { phaseKey: "emissao_documental", nome: "Workflow Interno · Emissão Documental", passos: ["Solicitar certidão", "Aguardar retorno do cartório", "Receber certidão", "Conferir certidão", "Validar certidão"] },
  { phaseKey: "analise_documental", nome: "Workflow Interno · Análise Documental", passos: ["Preparar pacote de análise", "Comparar nomes, datas, locais e filiação", "Registrar divergências", "Classificar criticidade", "Concluir necessidade de retificação"] },
  { phaseKey: "retificacao_registros", nome: "Workflow Interno · Retificação de Registros", passos: ["Definir modo de retificação", "Preparar requerimento/petição", "Protocolar retificação", "Acompanhar decisão", "Registrar averbação", "Validar retificação"] },
  { phaseKey: "emissao_documental_retificada", nome: "Workflow Interno · Emissão Documental Retificada", passos: ["Solicitar averbação", "Solicitar certidão retificada", "Aguardar retorno", "Receber certidão", "Conferir certidão", "Validar certidão retificada"] },
]

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")

async function limpar() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Processo","Arvore","Pessoa","Uniao","Documento","NecessidadeDocumental","NecessidadeDocumentalEvento","PhaseWorkflowInstance","PhaseWorkflowStepInstance","PhaseInternalWorkflow","PhaseInternalWorkflowStep","WorkflowEvento","DomainOutbox","Tarefa","MacroWorkflow","FaseMacro","MatrizDocumental","TipoDocumentoCadastro","ItemCatalogo","PhaseAdvanceLog","NecessidadeDocumental" RESTART IDENTITY CASCADE',
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

  // CATÁLOGO DE CERTIDÕES — espelha produção: TipoDocumentoCadastro com
  // legacyEnumKey (é por ele que a regra da árvore resolve o item mestre) e natureza
  // "certidao" (é o que torna a necessidade um alvo de localização registral).
  // A NATUREZA OPERACIONAL é obrigatória: sem ela o tipo documental não passa
  // pela política da fase, e a Genealogia recusa materializar dizendo
  // exatamente isso. Era um cadastro que este palco não tinha.
  const natureza = await prisma.naturezaOperacionalDocumento.upsert({
    where: { code: "MFP_CERTIDAO" }, update: {},
    create: { code: "MFP_CERTIDAO", name: "Certidão (palco)", exigeWorkflow: false },
  })
  for (const c of [
    { code: "IT - NAS", name: "Certidão de nascimento - Inteiro Teor", enumKey: "CERTIDAO_NASCIMENTO_INTEIRO_TEOR" },
    { code: "IT - CAS", name: "Certidão de casamento - Inteiro Teor", enumKey: "CERTIDAO_CASAMENTO_INTEIRO_TEOR" },
    { code: "IT - OBI", name: "Certidão de óbito - Inteiro Teor", enumKey: "CERTIDAO_OBITO_INTEIRO_TEOR" },
  ]) {
    const item = await prisma.itemCatalogo.create({ data: { code: c.code, name: c.name, natureza: "DOCUMENTO" } })
    await prisma.tipoDocumentoCadastro.create({
      data: {
        code: c.code, name: c.name, nature: "certidao", legacyEnumKey: c.enumKey,
        itemCatalogoId: item.id, naturezaOperacionalId: natureza.id,
      },
    })
  }

  // A POLÍTICA DA FASE — quais naturezas a Genealogia materializa. Fase sem
  // política declarada não materializa nada, de propósito: esquecimento de
  // cadastro não pode virar materialização indevida.
  const faseCatalogo = await prisma.catalogoFase.upsert({
    where: { phaseKey: "genealogia" }, update: {},
    create: { phaseKey: "genealogia", label: "Genealogia" },
  })
  await prisma.faseNaturezaPermitida.upsert({
    where: { catalogoFaseId_naturezaOperacionalId: { catalogoFaseId: faseCatalogo.id, naturezaOperacionalId: natureza.id } },
    update: { ativo: true },
    create: { catalogoFaseId: faseCatalogo.id, naturezaOperacionalId: natureza.id, ativo: true },
  })

  // A REGRA DOCUMENTAL PUBLICADA — é ela que cria a obrigação.
  //
  // Este palco assumia a "regra da árvore" (DOCUMENT_RULES, hardcoded), que foi
  // DESLIGADA: quem cria necessidade hoje é a Matriz Documental publicada, e a
  // instanciação da fase só LÊ. Sem publicar nada, a Genealogia passou a
  // responder SEM_ALVO_APLICAVEL — corretamente, e o palco é que envelheceu.
  await prisma.matrizDocumental.create({
    data: {
      tipoProcessoId: 0, aplicaTodosProcessos: true,
      documentTypeCode: "IT - NAS", documentosAceitos: ["IT - NAS"],
      codigo: "NASC_IT", nome: "Certidão de nascimento de cada pessoa da árvore",
      requisitoNome: "Certidão de nascimento - Inteiro Teor",
      status: "PUBLICADA", arquivado: false,
      faseExigencia: "genealogia", obrigatoriedade: "OBRIGATORIA",
      publicoAlvo: "TODAS_AS_PESSOAS_DA_ARVORE",
    },
  })

  // Macro do processo: uma FaseMacro por fase do cadastro.
  const macro = await prisma.macroWorkflow.create({
    data: { tipoProcessoId: tipo.id, name: "Macro ALE", versao: 1 },
  })
  for (let i = 0; i < CADASTRO.length; i++) {
    await prisma.faseMacro.create({
      data: { macroWorkflowId: macro.id, phaseKey: CADASTRO[i].phaseKey, label: CADASTRO[i].phaseKey, ordem: i, versao: 1 },
    })
  }

  // Workflow Interno publicado de cada fase, com os passos do cadastro.
  for (const f of CADASTRO) {
    const wf = await prisma.phaseInternalWorkflow.create({
      data: { wfUid: `all::${f.phaseKey}`, phaseKey: f.phaseKey, name: f.nome, tipoProcessoId: null, versao: 1 },
    })
    await prisma.phaseInternalWorkflowStep.createMany({
      data: f.passos.map((label, i) => ({
        workflowId: wf.id, key: slug(label), label, ordem: i + 1,
        createsTask: true, required: true, owner: "equipe_documental", slaDays: 5,
      })),
    })
  }
  return tipo.id
}

async function criarProcesso(tipoId: number, phaseKey: string, codigo: string) {
  const arvore = await prisma.arvore.create({ data: { nome: `Árvore ${codigo}` } })
  const pai = await prisma.pessoa.create({ data: { nome: "Joao", sobrenome: "Silva", arvoreId: arvore.id, linhaReta: true, requerente: "nao" } })
  await prisma.pessoa.create({ data: { nome: "Marco", sobrenome: "Rovatti", arvoreId: arvore.id, linhaReta: true, requerente: "maior", paiId: pai.id } })
  return prisma.processo.create({
    data: { nome: `Teste ${codigo}`, codigo, pais: "Alemanha", arvoreId: arvore.id, faseAtualKey: phaseKey, tipoProcessoMotorId: tipoId, workflowRuntime: "v2" },
  })
}

async function passosDa(processoId: number) {
  return prisma.phaseWorkflowStepInstance.findMany({
    where: { processoId }, orderBy: [{ ciclo: "asc" }, { ordem: "asc" }],
    select: { id: true, stepKey: true, ordem: true, status: true, ciclo: true, faseMacroKey: true, obrigatorio: true, geraTarefa: true, slaDays: true, papel: true, pessoaId: true, necessidadeId: true, documentoId: true },
  })
}

async function main() {
  await limpar()
  const tipoId = await semear()

  // ── 1) cada fase materializa EXATAMENTE os seus passos publicados ──────────
  console.log("\n(1) Cada fase materializa somente os SEUS passos publicados")
  const processos: Record<string, number> = {}
  for (const f of CADASTRO) {
    // Emissão opera por DOCUMENTO: num processo recém-criado ainda não há documento
    // materializado, então ela é exercitada no bloco (8), depois do avanço real.
    if (f.phaseKey === "emissao_documental") continue
    const p = await criarProcesso(tipoId, f.phaseKey, `T-${f.phaseKey.slice(0, 8)}`)
    processos[f.phaseKey] = p.id
    const r = await reconciliarFaseAtiva(p.id)
    check(`${f.phaseKey}: reconciliação sem erro`, r.erro === null, r.erro ?? undefined)

    const passos = await passosDa(p.id)
    // Genealogia opera por NECESSIDADE (escopo canônico da fase): 1 instância do passo
    // publicado por certidão a localizar. As demais fases operam por PROCESSO.
    const alvos = f.phaseKey === "genealogia"
      ? await prisma.necessidadeDocumental.count({ where: { processoId: p.id, supersedePorId: null } })
      : 1
    const esperado = f.passos.length * alvos
    check(`${f.phaseKey}: ${esperado} instância(s) = ${f.passos.length} passo(s) × ${alvos} alvo(s)`, passos.length === esperado, `veio ${passos.length}`)
    check(`${f.phaseKey}: nenhum passo de outra fase`, passos.every((s) => s.faseMacroKey === f.phaseKey))
    const esperados = f.passos.map(slug)
    const ordemVista = [...new Set(passos.map((s) => s.stepKey))]
    check(`${f.phaseKey}: ordem oficial preservada`, ordemVista.join(",") === esperados.join(","), ordemVista.join(","))
    check(`${f.phaseKey}: a obrigação vem da REGRA PUBLICADA, sem documento materializado`,
      (await prisma.matrizDocumental.count({ where: { status: "PUBLICADA" } })) === 1 &&
      (await prisma.documento.count({ where: { pessoa: { arvoreId: (await prisma.processo.findUnique({ where: { id: p.id }, select: { arvoreId: true } }))!.arvoreId! } } })) === 0)
    check(`${f.phaseKey}: config preservada (obrigatório + gera tarefa + SLA + equipe)`,
      passos.every((s) => s.obrigatorio && s.geraTarefa && s.slaDays === 5 && s.papel === "equipe_documental"))
    check(`${f.phaseKey}: cardinalidade da fase respeitada`,
      f.phaseKey === "genealogia"
        ? passos.every((s) => s.necessidadeId !== null)
        : passos.every((s) => s.pessoaId === null && s.necessidadeId === null && s.documentoId === null))
  }

  console.log("\n(1b) Genealogia: um alvo por pessoa/registro, a partir da Regra publicada")
  {
    const pg = processos["genealogia"]
    const necs = await prisma.necessidadeDocumental.findMany({
      where: { processoId: pg }, select: { id: true, pessoaId: true, origem: true, ruleCode: true, itemCatalogoId: true },
    })
    // A origem mudou de dono, e é isto que se protege: a obrigação nasce da
    // Matriz PUBLICADA, não de regra escrita em código.
    check("necessidades vieram da REGRA DOCUMENTAL publicada",
      necs.length > 0 && necs.every((n) => n.ruleCode === "NASC_IT"),
      JSON.stringify(necs.map((n) => `${n.origem}/${n.ruleCode}`)))
    check("uma certidão de nascimento por pessoa da árvore", necs.filter((n) => n.ruleCode === "NASC_IT").length === 2, String(necs.length))
    const passos = await passosDa(pg)
    check("cada passo preserva o vínculo com o registro", passos.every((s) => s.necessidadeId != null))
    check("cada passo aponta para uma necessidade distinta", new Set(passos.map((s) => s.necessidadeId)).size === passos.length)
    const pessoaDaNec = new Map(necs.map((n) => [n.id, n.pessoaId]))
    check("o vínculo com a PESSOA é recuperável a partir do passo",
      passos.every((s) => pessoaDaNec.get(s.necessidadeId!) != null))
  }

  // ── 2) sequência configurada (SEQUENCIAL é o default) ──────────────────────
  console.log("\n(2) Sequência oficial: só o primeiro disponível")
  const pAnalise = processos["analise_documental"]
  const passosAnalise = await passosDa(pAnalise)
  check("primeiro passo DISPONIVEL", passosAnalise[0].status === "DISPONIVEL", passosAnalise[0].status)
  check("posteriores PENDENTE (bloqueados pela sequência)", passosAnalise.slice(1).every((s) => s.status === "PENDENTE"))
  check("tarefa criada só para o passo disponível",
    (await prisma.tarefa.count({ where: { processoId: pAnalise } })) === 1,
    String(await prisma.tarefa.count({ where: { processoId: pAnalise } })))

  // ── 3) idempotência ────────────────────────────────────────────────────────
  console.log("\n(3) Idempotência: reprocessar não duplica")
  const antes = await passosDa(pAnalise)
  const tarefasAntes = await prisma.tarefa.count({ where: { processoId: pAnalise } })
  for (let i = 0; i < 3; i++) await reconciliarFaseAtiva(pAnalise)
  const depois = await passosDa(pAnalise)
  check("3 reprocessamentos ⇒ mesma quantidade de passos", depois.length === antes.length, `${antes.length} → ${depois.length}`)
  check("3 reprocessamentos ⇒ mesmos ids de passo", depois.map((s) => s.id).join(",") === antes.map((s) => s.id).join(","))
  check("3 reprocessamentos ⇒ mesma quantidade de tarefas",
    (await prisma.tarefa.count({ where: { processoId: pAnalise } })) === tarefasAntes)

  // ── 4) instância pré-existente SEM passos converge (a regressão de prod) ───
  console.log("\n(4) Fase já ativa e sem passos: reconciliar completa, não duplica")
  const pGen = processos["genealogia"]
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: pGen } })
  await prisma.tarefa.deleteMany({ where: { processoId: pGen } })
  check("cenário: instância ativa existe e está sem passos",
    (await prisma.phaseWorkflowInstance.count({ where: { processoId: pGen, status: "ATIVO" } })) === 1 &&
    (await prisma.phaseWorkflowStepInstance.count({ where: { processoId: pGen } })) === 0)
  const rec = await reconciliarFaseAtiva(pGen)
  check("reconciliação recriou os passos publicados", rec.passosCriados === 2, JSON.stringify(rec))
  check("passos são os da Genealogia", (await passosDa(pGen)).every((s) => s.stepKey === slug("Localizar registro da certidão")))
  check("tarefa correspondente criada por alvo", rec.tarefasCriadas === 2, String(rec.tarefasCriadas))
  await reconciliarFaseAtiva(pGen)
  check("reconciliar de novo não duplica", (await passosDa(pGen)).length === 2)

  // ── 5) escopo PESSOA e DOCUMENTO vêm do cadastro (plano puro) ──────────────
  console.log("\n(5) Cardinalidade persistida governa o fan-out")
  const base: DefStep = {
    id: 1, key: "p1", label: "P1", description: null, ordem: 1, createsTask: true, required: true,
    owner: null, priority: "medium", slaDays: 0, completionRule: null, checklist: null, versao: 1, cardinalidade: null,
  }
  const ctx = { pessoaIds: [10, 11, 12], necessidadeIds: [70, 71], documentoIds: [900], documentoIdPorNecessidade: new Map([[70, 900]]) }
  check("PROCESSO ⇒ 1 alvo, sem entidade",
    planejarMaterializacao([base], "SEQUENCIAL", "PROCESSO", ctx).alvos.length === 1)
  const porPessoa = planejarMaterializacao([{ ...base, cardinalidade: "PESSOA" }], "SEQUENCIAL", "PROCESSO", ctx).alvos
  check("PESSOA ⇒ 1 alvo por pessoa", porPessoa.length === 3 && porPessoa.every((a) => a.pessoaId != null))
  const porDoc = planejarMaterializacao([{ ...base, cardinalidade: "NECESSIDADE" }], "SEQUENCIAL", "PROCESSO", ctx).alvos
  check("NECESSIDADE ⇒ 1 alvo por certidão", porDoc.length === 2 && porDoc.every((a) => a.necessidadeId != null))
  check("NECESSIDADE vincula o Documento quando já existe", porDoc.find((a) => a.necessidadeId === 70)?.documentoId === 900)
  const semEntidade = planejarMaterializacao([{ ...base, cardinalidade: "PESSOA" }], "SEQUENCIAL", "PROCESSO", { pessoaIds: [], necessidadeIds: [], documentoIds: [], documentoIdPorNecessidade: new Map() })
  check("cardinalidade sem alvo avisa explicitamente (nunca silencioso)",
    semEntidade.alvos.length === 0 && semEntidade.avisos.some((a) => a.code === "CARDINALIDADE_SEM_ALVO"))
  const paralelo = planejarMaterializacao(
    [base, { ...base, id: 2, key: "p2", ordem: 2 }], "PARALELO", "PROCESSO", ctx)
  check("PARALELO ⇒ todos DISPONIVEL, sem dependência",
    paralelo.alvos.every((a) => a.status === "DISPONIVEL" && a.dependeDeStepKeys.length === 0))
  const sequencial = planejarMaterializacao(
    [base, { ...base, id: 2, key: "p2", ordem: 2 }], "SEQUENCIAL", "PROCESSO", ctx)
  check("SEQUENCIAL ⇒ segundo PENDENTE e dependente do primeiro",
    sequencial.alvos[1].status === "PENDENTE" && sequencial.alvos[1].dependeDeStepKeys[0] === "p1")

  // ── 6) avanço de fase preserva histórico e materializa só a fase nova ──────
  console.log("\n(6) Avanço de fase: histórico preservado, workflow novo isolado")
  const pAv = processos["retificacao_registros"]
  const passosAntesAv = await passosDa(pAv)
  await prisma.processo.update({ where: { id: pAv }, data: { faseAtualKey: "emissao_documental_retificada" } })
  const rAv = await reconciliarFaseAtiva(pAv)
  check("nova fase reconciliada sem erro", rAv.erro === null, rAv.erro ?? undefined)
  const todos = await passosDa(pAv)
  const daNova = todos.filter((s) => s.faseMacroKey === "emissao_documental_retificada")
  const daAntiga = todos.filter((s) => s.faseMacroKey === "retificacao_registros")
  check("passos da fase anterior preservados", daAntiga.length === passosAntesAv.length && daAntiga.length === 6)
  check("nova fase recebeu só o seu workflow (6 passos)", daNova.length === 6)
  check("nenhum passo vazou entre as fases",
    daNova.every((s) => !daAntiga.some((a) => a.id === s.id)) &&
    new Set(todos.map((s) => s.faseMacroKey)).size === 2)

  // ── 7) retorno de fase cria ciclo novo sem tocar o antigo ──────────────────
  console.log("\n(7) Retorno de fase: novo ciclo, ciclo antigo intacto")
  const idsCicloUm = daNova.map((s) => s.id).sort()
  await prisma.phaseWorkflowInstance.updateMany({
    where: { processoId: pAv, faseMacroKey: "emissao_documental_retificada" },
    data: { status: "CONCLUIDO" },
  })
  const { instanciarWorkflowDaFase } = await import("../src/services/phase-workflow")
  const c2 = await instanciarWorkflowDaFase({ processoId: pAv, faseMacroKey: "emissao_documental_retificada", ciclo: 2, origem: "REABERTURA" })
  check("ciclo 2 instanciado", c2.success && c2.stepInstances.length === 6, c2.success ? String(c2.stepInstances.length) : c2.code)
  const apos = await passosDa(pAv)
  const ciclo1 = apos.filter((s) => s.faseMacroKey === "emissao_documental_retificada" && s.ciclo === 1)
  const ciclo2 = apos.filter((s) => s.faseMacroKey === "emissao_documental_retificada" && s.ciclo === 2)
  check("ciclo 1 intacto (mesmos ids)", ciclo1.map((s) => s.id).sort().join(",") === idsCicloUm.join(","))
  check("ciclo 2 tem instâncias próprias", ciclo2.length === 6 && ciclo2.every((s) => !idsCicloUm.includes(s.id)))

  // ── 8) fluxo oficial: executar as buscas conclui a fase e avança sozinho ──
  console.log("\n(8) Buscas concluídas ⇒ Genealogia conclui e avança para Emissão Documental")
  {
    const pg = processos["genealogia"]
    const { atualizarPassoV2 } = await import("../src/services/documento-operacao")
    const { garantirDocumentoDaNecessidade } = await import("../src/services/genealogia/operacao-necessidade")

    const passos = await passosDa(pg)
    check("2 buscas a executar", passos.length === 2)

    for (const s of passos) {
      // Abrir a busca materializa o Documento do registro (mesmo caminho do botão "Abrir").
      const docId = await garantirDocumentoDaNecessidade(pg, s.necessidadeId!)
      check(`busca do registro ${s.necessidadeId} abriu com documento próprio`, docId > 0)
      const r = await atualizarPassoV2(docId, s.id, { status: "concluida" })
      check(`busca do registro ${s.necessidadeId} concluída`, r.ok, r.ok ? "" : r.error)
    }

    const proc = await prisma.processo.findUnique({ where: { id: pg }, select: { faseAtualKey: true } })
    check("Genealogia avançou automaticamente para Emissão Documental",
      proc?.faseAtualKey === "emissao_documental", String(proc?.faseAtualKey))

    const instGen = await prisma.phaseWorkflowInstance.findFirst({ where: { processoId: pg, faseMacroKey: "genealogia" }, select: { status: true } })
    check("instância da Genealogia concluída", instGen?.status === "CONCLUIDO", String(instGen?.status))

    const todosPassos = await passosDa(pg)
    const daGen = todosPassos.filter((s) => s.faseMacroKey === "genealogia")
    check("histórico da Genealogia preservado (2 passos, concluídos)",
      daGen.length === 2 && daGen.every((s) => s.status === "CONCLUIDO"), JSON.stringify(daGen.map((s) => s.status)))

    const daEmissao = todosPassos.filter((s) => s.faseMacroKey === "emissao_documental")
    const keysEmissao = [...new Set(daEmissao.map((s) => s.stepKey))]
    check("Emissão Documental materializou exatamente os seus 5 passos publicados",
      keysEmissao.length === 5, keysEmissao.join(","))
    check("nenhum passo da Genealogia vazou para a Emissão",
      !keysEmissao.includes(slug("Localizar registro da certidão")))

    const evs = await prisma.workflowEvento.findMany({ where: { processoId: pg }, select: { tipo: true } })
    check("timeline registra conclusão de passo e avanço de fase",
      evs.some((e) => e.tipo === "PASSO_CONCLUIDO") && evs.some((e) => String(e.tipo).startsWith("FASE_AVANCADA")),
      [...new Set(evs.map((e) => e.tipo))].join(","))
  }

  console.log(`\n${falhas.length === 0 ? "✅" : "❌"} ${ok}/${ok + falhas.length} verificações`)
  if (falhas.length) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  · ${f}`)
    process.exitCode = 1
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
