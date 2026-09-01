// scripts/profissional-e-judicial.test.ts
//
// AS DUAS ÚLTIMAS LACUNAS: o advogado e o número do processo judicial.
//
// Nenhuma das duas cabia onde já havia lugar. `Pessoa` é o indivíduo da árvore
// genealógica; `Usuario` é conta de login; `OrgaoProtocolo` é pessoa jurídica, e
// pendurar OAB numa empresa é dizer que a inscrição é dela. Não existe entidade de
// processo judicial, e criar uma vazia para guardar uma string seria estrutura sem
// dono — o pedido de retificação JÁ É o procedimento.
//
//   node scripts/mrg-banco-teste.mjs up && npm run db:push:teste
//   PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//   npx tsx scripts/profissional-e-judicial.test.ts

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { PrismaClient, Prisma } from "@prisma/client"
import { CONFIGURACAO } from "./_configuracao-retificacao"
import { validarConfiguracao } from "../src/services/validacao-de-publicacao"
import { efeitosDaFase, efeito } from "../src/lib/motor/catalogo-de-efeitos"
import { ALVOS_DE_REFERENCIA, alvoDoCampo } from "../src/lib/motor/fontes-de-campo"
import { listarAlvo, resolverReferencia, validarReferencia } from "../src/services/referencia-canonica"
import { abrirPacoteDeRetificacao, pacotesAbertos } from "../src/services/retificacao-canonica"
import { planejarMaterializacao } from "../src/services/phase-workflow-escopo"
import { montarChavePasso } from "../src/services/phase-workflow-helpers"
import { executarAcaoCadastrada } from "../src/services/executar-acao-cadastrada"
import { garantirTentativa, tentativasDoPasso, MOTIVOS_DE_TENTATIVA } from "../src/services/execucao-do-passo"
import { avaliarCondicao, type Condicao } from "../src/lib/motor/condicoes"
import { PRAZO_HERDADO } from "../lib/operacional/tempo-operacional"

const prisma = new PrismaClient()
const M = "PJU"
const FASE = "retificacao_registros"
const ROOT = join(__dirname, "..")
const read = (r: string) => (existsSync(join(ROOT, r)) ? readFileSync(join(ROOT, r), "utf8") : "")
const PERMS = ["tarefas.editar", "documentos.editar", "processos.editar", "workflow.concluirPasso"]

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: `${M} ` } }, select: { id: true } })
  for (const p of procs) {
    await prisma.stepExecution.deleteMany({ where: { stepInstance: { processoId: p.id } } })
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: p.id } })
    await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: p.id } })
    await prisma.tarefa.deleteMany({ where: { processoId: p.id } })
    await prisma.workflowEvento.deleteMany({ where: { processoId: p.id } })
    await prisma.protocolo.deleteMany({ where: { processoId: p.id } })
    await prisma.retificacaoPacoteDivergencia.deleteMany({ where: { pacote: { processoId: p.id } } })
    await prisma.retificacaoPacote.deleteMany({ where: { processoId: p.id } })
    await prisma.divergencia.deleteMany({ where: { analise: { processoId: p.id } } })
    await prisma.analiseDocumental.deleteMany({ where: { processoId: p.id } })
    await prisma.processo.delete({ where: { id: p.id } }).catch(() => null)
  }
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: `${M} ` } } })
  await prisma.registroProfissional.deleteMany({ where: { profissional: { nome: { startsWith: `${M} ` } } } })
  await prisma.profissional.deleteMany({ where: { nome: { startsWith: `${M} ` } } })
  await prisma.categoriaProfissional.deleteMany({ where: { code: { startsWith: `${M.toLowerCase()}_` } } })
  await prisma.orgaoProtocolo.deleteMany({ where: { name: { startsWith: `${M} ` } } })
  const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: `${M}::ret` }, select: { id: true } })
  if (wf) {
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: `${M.toLowerCase()}_` } } })
}

async function main() {
  await limpar()

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n1 — O PROFISSIONAL É CADASTRO, NÃO TEXTO")
  // ══════════════════════════════════════════════════════════════════════════
  // A CATEGORIA É CADASTRO. O palco cadastra a dele, como quem administra faria.
  const cat = await prisma.categoriaProfissional.upsert({
    where: { code: `${M.toLowerCase()}_advogado` },
    create: { code: `${M.toLowerCase()}_advogado`, nome: "Advogado", ordem: 1 },
    update: {},
    select: { id: true },
  })
  const escritorio = await prisma.orgaoProtocolo.create({
    data: { name: `${M} Silva & Associados`, type: "outro", ativo: true }, select: { id: true },
  })
  const adv = await prisma.profissional.create({
    data: {
      nome: `${M} Ana Ribeiro`, categoriaId: cat.id, organizacaoId: escritorio.id, ativo: true,
      registros: { create: [{ tipo: "OAB", numero: "123456", jurisdicao: "SP" }] },
    },
    select: { id: true },
  })
  const advSemOrg = await prisma.profissional.create({
    data: { nome: `${M} Bruno Autônomo`, categoriaId: cat.id, ativo: true,
      registros: { create: [{ tipo: "OAB", numero: "999999", jurisdicao: "RJ" }] } },
    select: { id: true },
  })
  const inativo = await prisma.profissional.create({
    data: { nome: `${M} Carla Inativa`, categoriaId: cat.id, ativo: false }, select: { id: true },
  })

  check("o profissional não é Pessoa, Usuário nem Organização",
    /model Profissional \{/.test(read("prisma/schema.prisma")) &&
    ALVOS_DE_REFERENCIA.PROFISSIONAL.entidade === "Profissional")

  // O REGISTRO É TABELA, e "OAB" é um valor dele — não uma coluna.
  const schema = read("prisma/schema.prisma")
  // O `oab String?` que sobrou está em `RetificacaoPacote`, e é LEGADO — preservado
  // porque apagar coluna é apagar o que já foi digitado. O que importa é que o dono
  // canônico exista e que nada novo escreva no texto.
  check("o registro de classe é entidade própria, e OAB é um VALOR de `tipo`",
    /model RegistroProfissional \{/.test(schema) &&
    /tipo\s+String\s+@db\.VarChar\(20\)/.test(schema.slice(schema.indexOf("model RegistroProfissional"))))
  // A PERGUNTA É SOBRE AS ESCRITAS NO PEDIDO. `Documento.cartorio` é outro conceito —
  // o cartório onde o registro foi LAVRADO, dado da certidão — e comparar por nome de
  // campo confundiria os dois.
  const escritasNoPacote = [read("src/services/efeitos-de-dominio.ts"), read("src/services/retificacao-canonica.ts"),
    read("src/app/api/processos/[processoId]/retificacoes/route.ts")]
    .join("\n")
    .split(/retificacaoPacote\.(?:create|update|updateMany)/).slice(1)
    .map((t) => t.slice(0, 700)).join("\n")
  check("nenhum caminho canônico escreve advogado/oab/tribunal/vara/comarca no pedido",
    !/\b(advogado|oab|tribunal|vara|comarca|cartorio)\s*:/.test(escritasNoPacote),
    escritasNoPacote.slice(0, 200))
  check("e o legado segue declarado no schema, preservado em vez de apagado",
    /LEGADO TEXTUAL — PRESERVADO, NAO ESCRITO/.test(schema))
  check("a mesma inscrição não se repete", /@@unique\(\[tipo, numero, jurisdicao\]\)/.test(schema))

  let repetiu = false
  try {
    await prisma.registroProfissional.create({ data: { profissionalId: advSemOrg.id, tipo: "OAB", numero: "123456", jurisdicao: "SP" } })
  } catch { repetiu = true }
  check("e o banco recusa a segunda inscrição igual", repetiu)

  // O MESMO PROFISSIONAL EM DUAS UFs — o que três colunas não permitiriam.
  await prisma.registroProfissional.create({ data: { profissionalId: adv.id, tipo: "OAB", numero: "654321", jurisdicao: "RJ" } })
  check("o mesmo advogado pode ter inscrição em mais de uma jurisdição",
    (await prisma.registroProfissional.count({ where: { profissionalId: adv.id } })) === 2)

  // A PROJEÇÃO monta "Nome — OAB 123456/SP" na leitura, sem gravar texto.
  const proj = await resolverReferencia("PROFISSIONAL", adv.id)
  check("nome e OAB/UF são PROJEÇÃO, montadas na leitura",
    !!proj && proj.label.includes("OAB 123456/SP") && proj.label.startsWith(`${M} Ana Ribeiro`), proj?.label)
  check("e o escritório aparece como contexto, sem virar a identidade do profissional",
    !!proj?.descricao?.includes("Silva & Associados"), proj?.descricao ?? "")
  const projAutonomo = await resolverReferencia("PROFISSIONAL", advSemOrg.id)
  check("profissional autônomo existe — o vínculo com organização é opcional",
    !!projAutonomo && !projAutonomo.descricao?.includes("&"), projAutonomo?.descricao ?? "")

  // INATIVO: fora da escolha nova, dentro do histórico.
  const vInativo = await validarReferencia({ alvo: "PROFISSIONAL", valor: inativo.id, rotuloDoCampo: "Advogado", permissoes: PERMS })
  check("profissional inativo não pode ser escolhido agora", !vInativo.ok && vInativo.motivo === "INATIVO")
  check("mas continua resolvendo no histórico", (await resolverReferencia("PROFISSIONAL", inativo.id))?.ativo === false)
  check("e sai da lista de quem vai escolher",
    !(await listarAlvo("PROFISSIONAL")).some((e) => e.id === inativo.id))

  // RENOMEAR/CORRIGIR O CADASTRO não pede regravação de execução nenhuma.
  await prisma.registroProfissional.updateMany({ where: { profissionalId: adv.id, numero: "123456" }, data: { numero: "123457" } })
  const depoisDeCorrigir = await resolverReferencia("PROFISSIONAL", adv.id)
  check("corrigir a OAB muda o que a leitura devolve, sem tocar em execução",
    depoisDeCorrigir?.label.includes("123457") === true, depoisDeCorrigir?.label)

  // A CAPACIDADE É GENÉRICA: o segundo alvo custou declaração + resolvedor.
  const registro = read("src/services/referencia-canonica.ts")
  check("o segundo alvo não pediu mudança no validador, na leitura da etapa nem no painel",
    !/PROFISSIONAL/.test(read("src/services/validacao-de-publicacao.ts")) &&
    !/PROFISSIONAL/.test(read("src/app/api/workflow-step-instances/[id]/execucao/route.ts")) &&
    !/PROFISSIONAL/.test(read("src/components/kanban/workflow/PainelDeclarativoDaEtapa.tsx")) &&
    /PROFISSIONAL: \{/.test(registro))

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n2 — ADMINISTRATIVO × JUDICIAL, POR CONDIÇÃO DECLARADA")
  // ══════════════════════════════════════════════════════════════════════════
  const cfg1 = CONFIGURACAO.definir_modo_de_retificacao
  const campoAdv = cfg1.campos.find((c) => c.key === "advogado_responsavel")
  const campoNum = cfg1.campos.find((c) => c.key === "numero_processo_judicial")
  check("o advogado é referência ao cadastro, nunca texto", campoAdv?.tipo === "referencia" && campoAdv?.referencia === "PROFISSIONAL")
  check("os dois campos judiciais têm condição declarada",
    !!campoAdv?.condicao && !!campoNum?.condicao)
  check("na via administrativa eles não aparecem",
    !avaliarCondicao(campoAdv!.condicao as Condicao, { valores: { modo: "administrativa" } }) &&
    !avaliarCondicao(campoNum!.condicao as Condicao, { valores: { modo: "administrativa" } }))
  check("na via judicial eles aparecem",
    avaliarCondicao(campoAdv!.condicao as Condicao, { valores: { modo: "judicial" } }))
  check("e são cobrados por REQUISITO CONDICIONAL, não por campo obrigatório",
    !campoAdv?.obrigatorio && !campoNum?.obrigatorio &&
    (cfg1.requisitos ?? []).filter((r) => r.condicao).length === 2)

  // ZERO regra por fase/passo no runtime genérico.
  const semComentario = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n")
  const runtime = ["src/lib/motor/condicoes.ts", "src/lib/motor/fontes-de-campo.ts",
    "src/services/referencia-canonica.ts", "src/services/executar-acao-cadastrada.ts",
    "src/services/phase-workflow-escopo.ts"].map((f) => semComentario(read(f))).join("\n")
  check("nenhum `if` por fase ou por passo no runtime genérico",
    !/phaseKey\s*===\s*"|stepKey\s*===\s*"|faseMacroKey\s*===\s*"/.test(runtime))

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n3 — O NÚMERO JUDICIAL NÃO É PROTOCOLO")
  // ══════════════════════════════════════════════════════════════════════════
  const efPlano = efeito("REGISTER_RETIFICATION_PLAN")
  const efProt = efeito("REGISTER_PROTOCOL")
  check("são dois efeitos distintos, com donos distintos",
    !!efPlano && !!efProt && efPlano.key !== efProt.key)
  check("o número judicial vai para o pedido; o protocolo, para Protocolo",
    efPlano!.camposConsumidos?.includes("numero_processo_judicial") === true &&
    efProt!.camposConsumidos?.includes("numero_protocolo") === true &&
    !efPlano!.camposConsumidos?.includes("numero_protocolo"))
  check("os dois exigem autorização nominal da fase",
    efPlano!.exigeAutorizacaoExplicita === true && efProt!.exigeAutorizacaoExplicita === true)
  check("`processoNum` é do pedido, e nenhuma entidade vazia foi criada para ele",
    /processoNum {4}String\?/.test(schema) && !/model ProcessoJudicial|model AcaoJudicial/.test(schema))

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n4 — DOIS PEDIDOS, DOIS ADVOGADOS, DOIS PROCESSOS")
  // ══════════════════════════════════════════════════════════════════════════
  const arv = await prisma.arvore.create({ data: { nome: `${M} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${M} processo`, arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: FASE },
    select: { id: true },
  })
  const analise = await prisma.analiseDocumental.create({ data: { processoId: proc.id }, select: { id: true } })
  const divs = await Promise.all([1, 2, 3].map((n) =>
    prisma.divergencia.create({
      data: { analiseId: analise.id, pessoaNome: `${M} P`, documentoTitulo: `${M} doc`, campo: `c${n}`,
        campoLabel: `C${n}`, tipo: "nome", severidade: "media", status: "retificacao" },
      select: { id: true },
    })))

  // O PEDIDO NASCE SEM MODO — agrupar as divergências vem antes de decidir o caminho.
  const pacA = await abrirPacoteDeRetificacao({ processoId: proc.id, divergenciaIds: [divs[0].id, divs[1].id] })
  const pacB = await abrirPacoteDeRetificacao({ processoId: proc.id, divergenciaIds: [divs[2].id] })
  check("o pedido pode ser aberto antes de o modo estar decidido",
    (await prisma.retificacaoPacote.findUnique({ where: { id: pacA.pacoteId }, select: { tipo: true } }))?.tipo === null)

  const chaves = Object.keys(CONFIGURACAO)
  const escopo = [...efeitosDaFase(FASE, null), "REGISTER_PROTOCOL", "REGISTER_RETIFICATION_PLAN"]
  await prisma.catalogoFase.create({
    data: { phaseKey: `${M.toLowerCase()}_ret`, label: "Retificação (teste)", escopo: "PROCESSO",
      ordemPadrao: 97, slaDiasPadrao: 30, efeitosPermitidos: escopo as never },
  })
  const wf = await prisma.phaseInternalWorkflow.create({
    data: {
      wfUid: `${M}::ret`, phaseKey: `${M.toLowerCase()}_ret`, name: "Retificação", versao: 1, execucao: "SEQUENCIAL",
      passos: { create: chaves.map((k, i) => ({ key: k, label: k, ordem: i + 1, createsTask: true, required: true,
        executorKey: "padrao", cardinalidade: "RETIFICACAO", slaDays: PRAZO_HERDADO, dependeDe: CONFIGURACAO[k].dependeDe as never })) },
    },
    select: { id: true, passos: { select: { id: true, key: true }, orderBy: { ordem: "asc" } } },
  })
  for (const p of wf.passos) {
    const c = CONFIGURACAO[p.key]
    for (const [i, campo] of c.campos.entries()) {
      const f = await prisma.stepField.create({
        data: { stepId: p.id, key: campo.key, label: campo.label, tipo: campo.tipo,
          obrigatorio: campo.obrigatorio ?? false, ajuda: campo.ajuda ?? null, ordem: i + 1,
          ...(campo.referencia ? { opcoes: { referencia: campo.referencia } as never } : {}),
          ...(campo.condicao ? { condicao: campo.condicao as never } : {}) },
        select: { id: true },
      })
      if (campo.opcoes?.length) {
        await prisma.stepFieldOption.createMany({
          data: campo.opcoes.map((o, j) => ({ fieldId: f.id, key: o.key, label: o.label, ordem: j + 1 })),
        })
      }
    }
    await prisma.stepAction.createMany({
      data: c.acoes.map((a, i) => ({ stepId: p.id, key: a.key, label: a.label, effectKey: a.effectKey,
        descricao: a.descricao, requerCampos: (a.requerCampos ?? []) as never, ordem: i + 1 })) as Prisma.StepActionCreateManyInput[],
    })
    if (c.requisitos?.length) {
      await prisma.stepRequirement.createMany({
        data: c.requisitos.map((r, i) => ({ stepId: p.id, key: r.key, label: r.label, tipo: r.tipo,
          alvoKey: r.alvoKey ?? null, acaoKey: r.acaoKey ?? null, ordem: i + 1,
          ...(r.condicao ? { condicao: r.condicao as never } : {}) })) as Prisma.StepRequirementCreateManyInput[],
      })
    }
    if (c.checkItens?.length) {
      await prisma.stepChecklistItem.createMany({
        data: c.checkItens.map((it, i) => ({ stepId: p.id, key: it.key, label: it.label, ordem: i + 1 })) as Prisma.StepChecklistItemCreateManyInput[],
      })
    }
  }
  const { publicarWorkflow } = await import("../src/services/publicacao-de-workflow")
  const pub = await publicarWorkflow({ workflowId: wf.id, actorId: null, versaoEsperada: 1 })
  check("o cadastro com campos condicionais e duas referências publica", pub.ok, JSON.stringify(pub))

  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: `${M.toLowerCase()}_ret`, ciclo: 1, status: "ATIVO",
      workflowDefinitionId: wf.id, workflowVersion: pub.versaoNova ?? 2, chaveIdempotencia: `${M}-i1` },
    select: { id: true },
  })
  const porPacote = new Map<number, Map<string, number>>()
  for (const pacote of [pacA.pacoteId, pacB.pacoteId]) {
    const mapa = new Map<string, number>()
    for (const [i, k] of chaves.entries()) {
      const si = await prisma.phaseWorkflowStepInstance.create({
        data: { workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: `${M.toLowerCase()}_ret`, ciclo: 1,
          stepKey: k, ordem: i + 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
          status: CONFIGURACAO[k].dependeDe.length === 0 ? "EM_ANDAMENTO" : "PENDENTE",
          dependeDeStepKeys: CONFIGURACAO[k].dependeDe as never, retificacaoPacoteId: pacote,
          stepDefinitionId: wf.passos[i].id, stepDefinitionVersion: pub.versaoNova ?? 2,
          chaveIdempotencia: montarChavePasso({ workflowInstanceId: inst.id, stepDefinitionId: wf.passos[i].id,
            stepKey: k, stepDefinitionVersion: pub.versaoNova ?? 2, ciclo: 1, retificacaoPacoteId: pacote }) },
        select: { id: true },
      })
      mapa.set(k, si.id)
    }
    porPacote.set(pacote, mapa)
  }

  // PACOTE A: judicial, com advogado e número do processo.
  const siA = porPacote.get(pacA.pacoteId)!.get("definir_modo_de_retificacao")!
  await garantirTentativa(siA, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })
  const semAdv = await executarAcaoCadastrada(siA, "modo_definido", { modo: "judicial" },
    { usuarioId: 1, permissoes: PERMS, correlationId: `${M}-a0` })
  check("na via judicial, concluir sem profissional é recusado", !semAdv.ok, JSON.stringify(semAdv))

  const rA = await executarAcaoCadastrada(siA, "modo_definido",
    { modo: "judicial", advogado_responsavel: adv.id, numero_processo_judicial: "0801234-56.2026.8.26.0100" },
    { usuarioId: 1, permissoes: PERMS, correlationId: `${M}-a1` })
  check("com profissional e número, a via judicial conclui", rA.ok, JSON.stringify(rA))

  // PACOTE B: administrativo, sem nenhum campo judicial.
  const siB = porPacote.get(pacB.pacoteId)!.get("definir_modo_de_retificacao")!
  await garantirTentativa(siB, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })
  const rB = await executarAcaoCadastrada(siB, "modo_definido", { modo: "administrativa" },
    { usuarioId: 1, permissoes: PERMS, correlationId: `${M}-b1` })
  check("na via administrativa, concluir SEM campos judiciais é aceito", rB.ok, JSON.stringify(rB))

  const [pA, pB] = await Promise.all([
    prisma.retificacaoPacote.findUnique({ where: { id: pacA.pacoteId }, select: { tipo: true, profissionalId: true, processoNum: true } }),
    prisma.retificacaoPacote.findUnique({ where: { id: pacB.pacoteId }, select: { tipo: true, profissionalId: true, processoNum: true } }),
  ])
  check("o modo, o advogado e o número foram para o PEDIDO",
    pA?.tipo === "judicial" && pA.profissionalId === adv.id && pA.processoNum === "0801234-56.2026.8.26.0100",
    JSON.stringify(pA))
  check("e o pedido administrativo não ganhou advogado nem processo judicial",
    pB?.tipo === "administrativa" && pB.profissionalId === null && pB.processoNum === null, JSON.stringify(pB))

  // NENHUMA SEGUNDA VERDADE.
  const tentA = (await tentativasDoPasso(siA)).find((t) => t.supersededAt == null)
  const valoresA = (tentA?.payload as { valores?: Record<string, unknown> })?.valores ?? {}
  check("o número judicial NÃO ficou copiado na execução", valoresA.numero_processo_judicial === undefined)
  check("o modo NÃO ficou copiado na execução", valoresA.modo === undefined)
  check("o advogado ficou como ID — referência, não nome", valoresA.advogado_responsavel === adv.id, String(valoresA.advogado_responsavel))
  check("e nenhum nome ou OAB foi copiado para o payload",
    !JSON.stringify(valoresA).includes("Ana Ribeiro") && !JSON.stringify(valoresA).includes("123457"))
  const subs = await prisma.subtaskExecution.count({ where: { stepInstance: { processoId: proc.id }, protocolo: { not: null } } })
  check("nenhuma segunda verdade em SubtaskExecution", subs === 0)

  // ISOLAMENTO com advogados e processos distintos.
  const adv2 = await prisma.profissional.create({ data: { nome: `${M} Dora Segunda`, categoriaId: cat.id, ativo: true }, select: { id: true } })
  await prisma.retificacaoPacote.update({ where: { id: pacB.pacoteId }, data: { tipo: "judicial", profissionalId: adv2.id, processoNum: "0807777-11.2026.8.26.0100" } })
  const [fA, fB] = await Promise.all([
    prisma.retificacaoPacote.findUnique({ where: { id: pacA.pacoteId }, select: { profissionalId: true, processoNum: true } }),
    prisma.retificacaoPacote.findUnique({ where: { id: pacB.pacoteId }, select: { profissionalId: true, processoNum: true } }),
  ])
  check("dois pedidos com advogados diferentes", fA?.profissionalId !== fB?.profissionalId)
  check("dois pedidos com processos judiciais diferentes", fA?.processoNum !== fB?.processoNum)

  // REABRIR UM não toca no outro.
  const { executarReabertura } = await import("../src/services/reabertura-de-execucao")
  const reab = await executarReabertura({ stepInstanceId: siA, motivoCodigo: "CORRECAO",
    justificativa: "advogado trocou", comDependentes: false, actorId: 1, correlationId: `${M}-r1` })
  check("reabrir o pedido A cria tentativa só nele",
    reab.ok && (await tentativasDoPasso(siA)).length >= 2 && (await tentativasDoPasso(siB)).length === 1)
  check("e o pedido B mantém o advogado e o processo dele",
    (await prisma.retificacaoPacote.findUnique({ where: { id: pacB.pacoteId }, select: { profissionalId: true } }))?.profissionalId === adv2.id)

  // RECONCILE IDEMPOTENTE.
  const ctx = { pessoaIds: [], necessidadeIds: [], documentoIds: [], retificacaoPacoteIds: [pacA.pacoteId, pacB.pacoteId], documentoIdPorNecessidade: new Map<number, number>() }
  const defs = chaves.map((k, i) => ({ key: k, label: k, ordem: i + 1, required: true, createsTask: true,
    slaDays: PRAZO_HERDADO, priority: "medium", owner: null, cardinalidade: "RETIFICACAO", executorKey: "padrao",
    dependeDe: CONFIGURACAO[k].dependeDe, completionRule: null, checklist: null, versao: 1 })) as never
  const p1 = planejarMaterializacao(defs, "SEQUENCIAL", "PROCESSO", ctx)
  const p2 = planejarMaterializacao(defs, "SEQUENCIAL", "PROCESSO", ctx)
  check("replanejar dá o mesmo plano — 12 alvos, 6 por pedido",
    p1.alvos.length === 12 &&
    JSON.stringify(p1.alvos.map((a) => [a.def.key, a.retificacaoPacoteId])) ===
    JSON.stringify(p2.alvos.map((a) => [a.def.key, a.retificacaoPacoteId])))
  check("e os pedidos encerrados saem do trabalho a fazer",
    (await pacotesAbertos(proc.id)).length === 2)

  // ── A CONFIGURAÇÃO CONTINUA PUBLICÁVEL ────────────────────────────────────
  const paraValidar = await prisma.phaseInternalWorkflowStep.findMany({
    where: { workflowId: wf.id },
    select: { key: true, label: true, executorKey: true, dependeDe: true,
      campos: { select: { key: true, tipo: true, obrigatorio: true, condicao: true, opcoes: true, opcoesCadastradas: { select: { key: true, ativo: true } } } },
      acoes: { select: { key: true, effectKey: true, requerCampos: true } },
      checkItens: { select: { key: true } },
      requisitos: { select: { key: true, tipo: true, alvoKey: true, acaoKey: true, condicao: true } } },
  })
  const problemas = validarConfiguracao(
    paraValidar.map((p) => ({ ...p, campos: p.campos.map((c) => ({ ...c, opcoes: c.opcoesCadastradas, opcoesLegado: c.opcoes })) })) as never,
    { phaseKey: FASE, efeitosPermitidosDaFase: escopo },
  )
  check("a configuração final passa na validação de publicação", problemas.length === 0, JSON.stringify(problemas.slice(0, 3)))
  check("e o alvo do campo de advogado é o cadastro de Profissionais",
    alvoDoCampo(paraValidar.find((p) => p.key === "definir_modo_de_retificacao")!.campos.find((c) => c.key === "advogado_responsavel")!.opcoes) === "PROFISSIONAL")

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n5 — A CENTRAL LÊ OS DONOS, NÃO O PAYLOAD")
  // ══════════════════════════════════════════════════════════════════════════
  const { contextoDaRetificacao } = await import("../src/services/contexto-da-retificacao")

  // Protocolar o pedido A para o contexto ter protocolo e órgão.
  const orgao = await prisma.orgaoProtocolo.create({
    data: { name: `${M} Tribunal de Teste`, type: "tribunal", city: "São Paulo", state: "SP", ativo: true },
    select: { id: true },
  })
  const siProt = porPacote.get(pacA.pacoteId)!.get("protocolar_retificacao")!
  await prisma.phaseWorkflowStepInstance.update({ where: { id: siProt }, data: { status: "EM_ANDAMENTO" } })
  await garantirTentativa(siProt, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })
  const rProt = await executarAcaoCadastrada(siProt, "protocolado",
    { orgao_receptor: orgao.id, numero_protocolo: "PROT-777", data_protocolo: "2026-08-24", setor_do_orgao: "2ª Vara de Registros" },
    { usuarioId: 1, permissoes: PERMS, correlationId: `${M}-p1` })
  check("protocolar grava no cadastro canônico", rProt.ok, JSON.stringify(rProt))
  // O protocolo é do pedido: a ligação sobe para a unidade, não fica só na tentativa.
  const protoCriado = await prisma.protocolo.findFirst({ where: { processoId: proc.id, origem: "ETAPA" }, select: { id: true } })
  if (protoCriado) await prisma.retificacaoPacote.update({ where: { id: pacA.pacoteId }, data: { protocoloId: protoCriado.id, orgaoId: orgao.id } })

  const ctxJud = await contextoDaRetificacao(porPacote.get(pacA.pacoteId)!.get("acompanhar_decisao")!)
  const blocos = (ctxJud?.blocos ?? []).map((b) => b.chave)
  check("(E) a Central recebe o contexto do PEDIDO, projetado dos donos", !!ctxJud && ctxJud.num === "PR-001", JSON.stringify(ctxJud?.num))
  check("(F) na via judicial aparecem o processo e o responsável", blocos.includes("judicial"), blocos.join(","))
  const itensJud = ctxJud!.blocos.find((b) => b.chave === "judicial")!.itens
  check("o número do processo vem do pedido",
    itensJud.some((i) => i.valor === "0801234-56.2026.8.26.0100"), JSON.stringify(itensJud))
  check("o advogado aparece com nome e OAB/UF montados na leitura",
    itensJud.some((i) => i.valor.includes(`${M} Ana Ribeiro`) && i.valor.includes("OAB 123457/SP")), JSON.stringify(itensJud))
  check("o protocolo e a vara aparecem, lidos de Protocolo",
    ctxJud!.blocos.some((b) => b.chave === "protocolo" && b.itens.some((i) => i.valor === "PROT-777")) &&
    ctxJud!.blocos.some((b) => b.itens.some((i) => i.valor === "2ª Vara de Registros")))
  check("o órgão receptor aparece, lido de Órgãos e Organizações",
    ctxJud!.blocos.some((b) => b.itens.some((i) => i.valor.includes("Tribunal de Teste"))))

  // (9) ADMINISTRATIVO NÃO MOSTRA BLOCO JUDICIAL VAZIO.
  // O PEDIDO B VIROU JUDICIAL no bloco de isolamento acima. Perguntar a ele sobre a
  // via administrativa mediria o estado errado — então a pergunta vai para um pedido
  // que É administrativo.
  const divAdm = await prisma.divergencia.create({
    data: { analiseId: analise.id, pessoaNome: `${M} P`, documentoTitulo: `${M} doc`, campo: "adm",
      campoLabel: "Adm", tipo: "nome", severidade: "baixa", status: "retificacao" },
    select: { id: true },
  })
  const pacC = await abrirPacoteDeRetificacao({ processoId: proc.id, tipo: "administrativa", divergenciaIds: [divAdm.id] })
  const siC = await prisma.phaseWorkflowStepInstance.create({
    data: { workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: `${M.toLowerCase()}_ret`, ciclo: 1,
      stepKey: "definir_modo_de_retificacao", ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
      status: "EM_ANDAMENTO", dependeDeStepKeys: [] as never, retificacaoPacoteId: pacC.pacoteId,
      stepDefinitionId: wf.passos[0].id, stepDefinitionVersion: pub.versaoNova ?? 2,
      chaveIdempotencia: montarChavePasso({ workflowInstanceId: inst.id, stepDefinitionId: wf.passos[0].id,
        stepKey: "definir_modo_de_retificacao", stepDefinitionVersion: pub.versaoNova ?? 2, ciclo: 1,
        retificacaoPacoteId: pacC.pacoteId }) },
    select: { id: true },
  })
  const ctxAdm = await contextoDaRetificacao(siC.id)
  check("(9) na via administrativa o bloco judicial NÃO aparece",
    !(ctxAdm?.blocos ?? []).some((b) => b.chave === "judicial"),
    (ctxAdm?.blocos ?? []).map((b) => b.chave).join(","))

  // CONTEXTUAL, não despejo: a etapa de validar não recebe o bloco judicial.
  const ctxValidar = await contextoDaRetificacao(porPacote.get(pacA.pacoteId)!.get("validar_retificacao")!)
  check("(8) cada etapa recebe só o que ajuda a fazer o que está na frente dela",
    !(ctxValidar?.blocos ?? []).some((b) => b.chave === "judicial") &&
    (ctxValidar?.blocos ?? []).some((b) => b.chave === "divergencias"),
    (ctxValidar?.blocos ?? []).map((b) => b.chave).join(","))

  // (10) NENHUMA SEGUNDA VERDADE: o contexto é projeção, não coluna.
  const fonte = read("src/services/contexto-da-retificacao.ts")
  check("(10) o contexto é lido dos donos, e nada é gravado para a tela",
    !/\.update\(|\.create\(|\.upsert\(/.test(fonte) && fonte.includes("prisma.retificacaoPacote.findUnique"))

  // (16) PROFISSIONAL INATIVADO DEPOIS DE USADO.
  await prisma.profissional.update({ where: { id: adv.id }, data: { ativo: false } })
  const ctxDepois = await contextoDaRetificacao(porPacote.get(pacA.pacoteId)!.get("acompanhar_decisao")!)
  const respDepois = ctxDepois!.blocos.find((b) => b.chave === "judicial")!.itens.find((i) => i.rotulo === "Responsável")!
  check("(16) inativar o profissional NÃO quebra o histórico — ele continua nomeado",
    respDepois.valor.includes(`${M} Ana Ribeiro`), respDepois.valor)
  check("(16b) e a tela diz que ele saiu de circulação, em vez de fingir que nada mudou",
    (respDepois.detalhe ?? "").includes("fora de circulação"), respDepois.detalhe ?? "")
  check("(16c) a relação histórica continua no banco",
    (await prisma.retificacaoPacote.findUnique({ where: { id: pacA.pacoteId }, select: { profissionalId: true } }))?.profissionalId === adv.id)
  check("(16d) e ele some das novas escolhas",
    !(await listarAlvo("PROFISSIONAL")).some((e) => e.id === adv.id))
  await prisma.profissional.update({ where: { id: adv.id }, data: { ativo: true } })

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n6 — O CADASTRO É ADMINISTRÁVEL PELA INTERFACE")
  // ══════════════════════════════════════════════════════════════════════════
  const nav = read("src/components/gerenciamentoComponents/managementNavigation.tsx")
  check("Profissionais está no menu, no módulo das partes externas",
    /a\(27, "profissionais", "Profissionais"/.test(nav) && nav.includes('"Organizações"'))
  // A PERGUNTA É EM QUAL MÓDULO ele caiu. Procurar "retificacao" perto de
  // "profissional" no arquivo inteiro acharia qualquer coisa — o arquivo tem os onze
  // módulos. O recorte é o bloco do módulo.
  const blocoOrgaos = nav.slice(nav.indexOf('key: "grp_orgaos"'), nav.indexOf('key: "grp_usuarios"'))
  const blocoWorkflow = nav.slice(nav.indexOf('key: "grp_workflow"'), nav.indexOf('key: "grp_automacoes"'))
  check("e não foi criado menu isolado nem escondido dentro de Workflow/Retificação",
    blocoOrgaos.includes('"profissionais"') && !blocoWorkflow.includes('"profissionais"'))
  check("a tela está registrada no roteador do administrador",
    /profissionais: ProfissionaisTab/.test(read("src/app/administrator/page.tsx")))
  const tela = read("src/components/gerenciamentoComponents/ProfissionaisTab.tsx")
  for (const capacidade of [
    ["criar", "Novo profissional"], ["editar", "Editar"], ["pesquisar", "Buscar por nome"],
    ["ativar/inativar", "Tirar de circulação"], ["registros de classe", "Registros de classe"],
    ["escritório por referência", "— autônomo —"],
  ]) {
    check(`a tela permite ${capacidade[0]}`, tela.includes(capacidade[1]))
  }
  check("o escritório é ESCOLHIDO em Organizações, não recadastrado",
    tela.includes("orgaos-protocolo") && !/name:.*escritorio/i.test(tela))
  check("exclusão de quem já foi usado nem aparece como botão",
    /p\._count\.retificacoes === 0 && \(/.test(tela))
  const api = read("src/app/api/gerenciamento/profissionais/[id]/route.ts")
  check("e o servidor recusa apagar quem tem histórico, oferecendo a inativação",
    api.includes('error: "EM_USO"') && api.includes("Tire de circulação"))
  // A PROFISSÃO TAMBÉM VIROU CADASTRO. Texto livre fazia "advogado" e "Advogado"
  // serem duas, e ninguém conseguia perguntar quais existem.
  check("a categoria do profissional vem de cadastro, não de texto digitado",
    tela.includes("categorias.map((c)") && !tela.includes("CATEGORIAS_CONHECIDAS"))
  check("e ela tem tela própria, no mesmo módulo",
    read("src/lib/gerenciamento/cadastros-registry.ts").includes('"categorias-profissional"') &&
    read("src/app/administrator/page.tsx").includes('profcats: cad("categorias-profissional")'))
  check("categoria em uso não pode ser apagada",
    /protegerExclusao:[\s\S]{0,160}model: "profissional", campo: "categoriaId"/.test(read("src/lib/gerenciamento/cadastros-registry.ts")))
  check("a UI reflete o schema REAL: registros são lista, porque o modelo aceita vários",
    tela.includes("+ Registro") && /registros: \[\.\.\.f\.registros/.test(tela))

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n7 — NENHUMA CAPACIDADE FICOU SÓ EM API")
  // ══════════════════════════════════════════════════════════════════════════
  const painel = read("src/components/kanban/PedidosDeRetificacao.tsx")
  check("abrir pedido e agrupar divergências tem tela",
    painel.includes("Abrir pedido") && painel.includes("divergenciaIds"))
  check("a tela NÃO agrupa sozinha — quem decide marca a lista",
    painel.includes("selecionadas") && !/agruparPor|porPessoa|porDocumento/.test(painel))
  check("e ela está montada na Central da fase de Retificação",
    read("src/components/kanban/ProcessoCentralOperacional.tsx").includes("<PedidosDeRetificacao"))
  check("a lista de divergências disponíveis exclui as que já estão num pedido aberto",
    read("src/app/api/processos/[processoId]/retificacoes/divergencias/route.ts").includes("pacotes: { none:"))
  check("o botão não nasce morto: sem divergência disponível ele explica por quê",
    painel.includes("disabled={disponiveis.length === 0}") && painel.includes("title="))

  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) { falhas.forEach((f) => console.log(`   · ${f}`)); process.exitCode = 1 }
  await limpar()
}
void main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
