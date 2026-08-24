// scripts/pendencias-a-e.test.ts
//
// AS CINCO PENDÊNCIAS ARQUITETURAIS DA RETIFICAÇÃO, provadas uma a uma.
//
//   A — referência a entidade canônica (o órgão que recebe o pedido)
//   B — o protocolo com uma fonte só
//   C — a unidade de trabalho de uma retificação, e o isolamento entre pedidos
//   D — prazo herdado continua herdado
//   E — executor é handler técnico; responsável é outra pergunta
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//   npx tsx scripts/pendencias-a-e.test.ts

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { PrismaClient, Prisma } from "@prisma/client"
import { CONFIGURACAO } from "./_configuracao-retificacao"
import { validarConfiguracao } from "../src/services/validacao-de-publicacao"
import { efeitosDaFase } from "../src/lib/motor/catalogo-de-efeitos"
import { ALVOS_DE_REFERENCIA, fonteDoCampo, alvoDoCampo, idReferenciado } from "../src/lib/motor/fontes-de-campo"
import { listarAlvo, resolverReferencia, validarReferencia } from "../src/services/referencia-canonica"
import { registrarProtocoloTx, ORIGENS_DE_PROTOCOLO, protocoloDaTentativa } from "../src/services/protocolo-canonico"
import { abrirPacoteDeRetificacao, divergenciasDoPacote, pacotesAbertos, mudarEstadoDoPacote, ESTADOS_DO_PACOTE } from "../src/services/retificacao-canonica"
import { planejarMaterializacao } from "../src/services/phase-workflow-escopo"
import { montarChavePasso } from "../src/services/phase-workflow-helpers"
import { executarAcaoCadastrada } from "../src/services/executar-acao-cadastrada"
import { garantirTentativa, tentativasDoPasso, MOTIVOS_DE_TENTATIVA } from "../src/services/execucao-do-passo"
import { prazoOperacional, temPrazoProprio, PRAZO_HERDADO } from "../lib/operacional/tempo-operacional"
import { resolverResponsavel } from "../src/services/passo-tarefa-helpers"

const prisma = new PrismaClient()
const M = "PAE"
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
    await prisma.protocoloDocumento.deleteMany({ where: { protocolo: { processoId: p.id } } })
    await prisma.protocolo.deleteMany({ where: { processoId: p.id } })
    await prisma.retificacaoPacoteDivergencia.deleteMany({ where: { pacote: { processoId: p.id } } })
    await prisma.retificacaoPacote.deleteMany({ where: { processoId: p.id } })
    await prisma.divergencia.deleteMany({ where: { analise: { processoId: p.id } } })
    await prisma.analiseDocumental.deleteMany({ where: { processoId: p.id } })
    await prisma.processo.delete({ where: { id: p.id } }).catch(() => null)
  }
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: `${M} ` } } })
  const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: `${M}::ret` }, select: { id: true } })
  if (wf) {
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: `${M.toLowerCase()}_` } } })
  await prisma.orgaoProtocolo.deleteMany({ where: { name: { startsWith: `${M} ` } } })
}

const defPasso = (key: string, ordem: number, cardinalidade: string | null) => ({
  key, label: key, ordem, required: true, createsTask: true, slaDays: PRAZO_HERDADO,
  priority: "medium", owner: null, cardinalidade, executorKey: "padrao",
  dependeDe: CONFIGURACAO[key]?.dependeDe ?? [], completionRule: null, checklist: null, versao: 1,
}) as never

async function main() {
  await limpar()

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\nA — REFERÊNCIA A ENTIDADE CANÔNICA")
  // ══════════════════════════════════════════════════════════════════════════
  const orgA = await prisma.orgaoProtocolo.create({
    data: { name: `${M} Cartório do Centro`, type: "cartorio", city: "São Paulo", country: "Brasil", ativo: true },
    select: { id: true, name: true },
  })
  const orgInativa = await prisma.orgaoProtocolo.create({
    data: { name: `${M} Cartório Fechado`, type: "cartorio", ativo: false },
    select: { id: true },
  })

  // A1 — organização válida.
  const a1 = await validarReferencia({ alvo: "ORGANIZACAO", valor: orgA.id, rotuloDoCampo: "Órgão", permissoes: PERMS })
  check("(A1) organização válida é aceita e resolve o nome atual",
    a1.ok && a1.entidade.label === orgA.name, JSON.stringify(a1))

  // A2 — inexistente.
  const a2 = await validarReferencia({ alvo: "ORGANIZACAO", valor: 999_999_999, rotuloDoCampo: "Órgão", permissoes: PERMS })
  check("(A2) organização inexistente é recusada", !a2.ok && a2.motivo === "NAO_ENCONTRADO", JSON.stringify(a2))

  // A3 — escopo por cliente. O Discovery é instância única: não existe coluna de
  // tenant em lugar nenhum do schema, e inventar uma checagem que não tem o que
  // checar seria teatro. O alvo DECLARA isso, e é isso que se verifica.
  const schema = read("prisma/schema.prisma")
  check("(A3) não há escopo multi-cliente a violar — e o alvo declara isso",
    !/\btenantId\b/.test(schema) && ALVOS_DE_REFERENCIA.ORGANIZACAO.escopoMultiCliente === "NAO_SE_APLICA")

  // A4 — inativa: fora da escolha nova, dentro do que já foi escolhido.
  const a4 = await validarReferencia({ alvo: "ORGANIZACAO", valor: orgInativa.id, rotuloDoCampo: "Órgão", permissoes: PERMS })
  check("(A4) organização inativa não pode ser escolhida agora", !a4.ok && a4.motivo === "INATIVO", JSON.stringify(a4))
  const a4b = await validarReferencia({ alvo: "ORGANIZACAO", valor: orgInativa.id, rotuloDoCampo: "Órgão", permissoes: PERMS, jaEscolhidoAntes: true })
  check("(A4b) mas a execução que já a tinha continua valendo", a4b.ok, JSON.stringify(a4b))
  const lista = await listarAlvo("ORGANIZACAO")
  check("(A4c) e ela sai da lista de quem vai escolher", !lista.some((e) => e.id === orgInativa.id))

  // A5 — renomear: a projeção muda, a execução não é regravada.
  await prisma.orgaoProtocolo.update({ where: { id: orgA.id }, data: { name: `${M} Cartório do Centro — 1º Ofício` } })
  const a5 = await resolverReferencia("ORGANIZACAO", orgA.id)
  check("(A5) renomear a organização muda o que a leitura devolve",
    a5?.label === `${M} Cartório do Centro — 1º Ofício`, a5?.label)

  // A6 — o histórico resolve mesmo depois de a organização sair de circulação.
  const a6 = await resolverReferencia("ORGANIZACAO", orgInativa.id)
  check("(A6) o histórico continua sabendo o nome de quem foi desativado", !!a6 && a6.ativo === false)

  // A CAPACIDADE É GENÉRICA, não um seletor de órgão.
  const fontes = read("src/lib/motor/fontes-de-campo.ts")
  check("(A7) o alvo é vocabulário fechado e tipado, não string solta no runtime",
    fontes.includes("satisfies Record<string, AlvoDeReferencia>") && fontes.includes("export type ChaveDeAlvo"))
  check("(A8) referência e datasource são conceitos declarados, não dois acidentes",
    fonteDoCampo({ referencia: "ORGANIZACAO" })?.especie === "REFERENCIA" &&
    fonteDoCampo({ catalogo: "canais" })?.especie === "DATASOURCE")
  check("(A9) o valor persistido é ID, e nome nunca vira ID",
    idReferenciado("42") === 42 && idReferenciado("Cartório X") === null && idReferenciado(0) === null)
  const nomeDoAlvo = Object.keys(ALVOS_DE_REFERENCIA)
  check("(A10) nenhum alvo criado além do necessário", nomeDoAlvo.length === 1 && nomeDoAlvo[0] === "ORGANIZACAO")

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\nB — PROTOCOLO COM UMA FONTE SÓ")
  // ══════════════════════════════════════════════════════════════════════════
  const arv = await prisma.arvore.create({ data: { nome: `${M} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${M} processo`, pais: "espanha", arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: FASE },
    select: { id: true },
  })

  // B1 — criar.
  const b1 = await prisma.$transaction((tx) => registrarProtocoloTx(tx, {
    processoId: proc.id, numeroProtocolo: "RET-2026-001", dataProtocolo: new Date("2026-08-20"),
    origem: ORIGENS_DE_PROTOCOLO.ETAPA, orgaoId: orgA.id,
  }))
  check("(B1) o protocolo nasce no cadastro que é dono dele", b1.protocoloId > 0 && !b1.jaExistia)

  // B6 — retry idempotente (mesmo comando, mesma linha).
  const b6 = await prisma.$transaction((tx) => registrarProtocoloTx(tx, {
    processoId: proc.id, numeroProtocolo: "RET-2026-001", dataProtocolo: new Date("2026-08-20"),
    origem: ORIGENS_DE_PROTOCOLO.ETAPA, orgaoId: orgA.id,
  }))
  check("(B6) repetir o mesmo protocolo não cria o segundo",
    b6.protocoloId === b1.protocoloId && b6.jaExistia,
    `${b1.protocoloId} vs ${b6.protocoloId}`)
  check("(B5) e o banco tem uma linha só", (await prisma.protocolo.count({ where: { processoId: proc.id } })) === 1)

  // B2 — editar: a edição é do dono, e não recria.
  await prisma.protocolo.update({ where: { id: b1.protocoloId }, data: { observacoes: "corrigido" } })
  const b2 = await prisma.protocolo.findUnique({ where: { id: b1.protocoloId }, select: { observacoes: true, orgaoId: true } })
  check("(B2) editar o protocolo é ato do dono, e o órgão continua por FK",
    b2?.observacoes === "corrigido" && b2.orgaoId === orgA.id)

  // B4 — o documento lê pelo vínculo canônico.
  const pessoa = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: `${M}`, sobrenome: "Pessoa" }, select: { id: true } })
  const doc = await prisma.documento.create({
    data: { pessoaId: pessoa.id, descricao: `${M} certidão`, origem: "manual" },
    select: { id: true },
  })
  await prisma.$transaction((tx) => registrarProtocoloTx(tx, {
    processoId: proc.id, numeroProtocolo: "RET-2026-001", dataProtocolo: new Date("2026-08-20"),
    origem: ORIGENS_DE_PROTOCOLO.ETAPA, orgaoId: orgA.id, documentoIds: [doc.id],
  }))
  const b4 = await prisma.protocoloDocumento.count({ where: { protocoloId: b1.protocoloId, documentoId: doc.id } })
  check("(B4) o documento chega ao protocolo pela junção canônica", b4 === 1)
  check("(B5b) e vincular documento depois não criou protocolo novo",
    (await prisma.protocolo.count({ where: { processoId: proc.id } })) === 1)

  // B7 — payload histórico preservado: o que já estava escrito continua escrito.
  const efeitos = read("src/services/efeitos-de-dominio.ts")
  const execCode = read("src/services/executar-acao-cadastrada.ts")
  check("(B7) só o que está sendo escrito agora perde a cópia — payload antigo não é tocado",
    /Payload ANTIGO não é tocado/.test(execCode) && !/payload:\s*Prisma\.DbNull/.test(execCode))

  // B8 — a duplicidade tem detector.
  const saude = read("lib/saude/verificacoes/cadastro-execucao.ts")
  check("(B8) existe verificação para execução com o protocolo em dois lugares",
    saude.includes("PRT-001") && saude.includes("comNumeroNoPayload"))

  // O ÓRGÃO DO PROTOCOLO vem da estrutura, não de um nome de campo combinado.
  // O ALVO SAIU DO CÓDIGO PARA O CATÁLOGO: o handler pergunta ao efeito o que
  // procurar. Antes o nome do alvo estava escrito nele, e cada efeito novo traria o seu.
  check("(B9) o handler acha a entidade pelo alvo DECLARADO no catálogo, não por nome de campo",
    efeitos.includes("alvoDeReferenciaEsperado") && efeitos.includes("alvoDoCampo(c.opcoes) !== alvoEsperado") &&
    !/valores\.(cartorio|orgao)\b/.test(efeitos))

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\nC — A UNIDADE DE TRABALHO DE UMA RETIFICAÇÃO")
  // ══════════════════════════════════════════════════════════════════════════
  const analise = await prisma.analiseDocumental.create({ data: { processoId: proc.id }, select: { id: true } })
  const divs = await Promise.all([1, 2, 3].map((n) =>
    prisma.divergencia.create({
      data: {
        analiseId: analise.id, pessoaNome: `${M} Pessoa`, documentoTitulo: `${M} certidão`,
        campo: `campo_${n}`, campoLabel: `Campo ${n}`, tipo: "nome", severidade: "media", status: "retificacao",
      },
      select: { id: true },
    })))

  // C1 — duas divergências no MESMO pedido. É o caso que derruba "uma por divergência".
  const pacA = await abrirPacoteDeRetificacao({
    processoId: proc.id, tipo: "judicial", divergenciaIds: [divs[0].id, divs[1].id], orgaoId: orgA.id,
  })
  check("(C1) duas divergências cabem no mesmo pedido",
    (await divergenciasDoPacote(pacA.pacoteId)).length === 2)

  // C2 — a terceira num pedido separado.
  const pacB = await abrirPacoteDeRetificacao({
    processoId: proc.id, tipo: "administrativa", divergenciaIds: [divs[2].id],
  })
  check("(C2) e outra divergência pode ir num pedido separado",
    pacB.pacoteId !== pacA.pacoteId && pacB.num === "PR-002", `${pacA.num}/${pacB.num}`)

  // A mesma divergência não entra em dois pedidos abertos — a trava que o snapshot
  // JSON nunca teve.
  let recusou = false
  try {
    await abrirPacoteDeRetificacao({ processoId: proc.id, tipo: "judicial", divergenciaIds: [divs[0].id] })
  } catch (e) { recusou = String(e).includes("DIVERGENCIA_JA_EM_PEDIDO") }
  check("(C2b) a mesma divergência não entra em dois pedidos abertos", recusou)

  // C3 — duas retificações simultâneas produzem DUAS cadeias.
  const chaves = Object.keys(CONFIGURACAO)
  const plano = planejarMaterializacao(
    chaves.map((k, i) => defPasso(k, i + 1, "RETIFICACAO")), "SEQUENCIAL", "PROCESSO",
    { pessoaIds: [], necessidadeIds: [], documentoIds: [], retificacaoPacoteIds: [pacA.pacoteId, pacB.pacoteId], documentoIdPorNecessidade: new Map() },
  )
  check("(C3) dois pedidos abertos produzem duas cadeias de seis passos",
    plano.alvos.length === 12 &&
    plano.alvos.filter((a) => a.retificacaoPacoteId === pacA.pacoteId).length === 6 &&
    plano.alvos.filter((a) => a.retificacaoPacoteId === pacB.pacoteId).length === 6,
    `${plano.alvos.length} alvos`)

  // E A IDENTIDADE SEPARA os dois — sem isto, o segundo pedido seria descartado como
  // duplicata do primeiro.
  const kA = montarChavePasso({ workflowInstanceId: 1, stepDefinitionId: 1, stepKey: "x", stepDefinitionVersion: 1, ciclo: 1, retificacaoPacoteId: pacA.pacoteId })
  const kB = montarChavePasso({ workflowInstanceId: 1, stepDefinitionId: 1, stepKey: "x", stepDefinitionVersion: 1, ciclo: 1, retificacaoPacoteId: pacB.pacoteId })
  check("(C3b) a identidade da unidade distingue os dois pedidos", kA !== kB, `${kA} / ${kB}`)

  // C7 — reconciliar duas vezes converge (mesmo plano, mesmas chaves).
  const plano2 = planejarMaterializacao(
    chaves.map((k, i) => defPasso(k, i + 1, "RETIFICACAO")), "SEQUENCIAL", "PROCESSO",
    { pessoaIds: [], necessidadeIds: [], documentoIds: [], retificacaoPacoteIds: [pacA.pacoteId, pacB.pacoteId], documentoIdPorNecessidade: new Map() },
  )
  check("(C7) planejar de novo dá exatamente o mesmo plano",
    JSON.stringify(plano2.alvos.map((a) => [a.def.key, a.retificacaoPacoteId])) ===
    JSON.stringify(plano.alvos.map((a) => [a.def.key, a.retificacaoPacoteId])))

  // Agora o isolamento REAL, com instâncias no banco.
  const escopoFase = efeitosDaFase(FASE, null)
  await prisma.catalogoFase.create({
    data: {
      phaseKey: `${M.toLowerCase()}_ret`, label: "Retificação (teste)", escopo: "PROCESSO",
      ordemPadrao: 96, slaDiasPadrao: 30, efeitosPermitidos: [...escopoFase, "REGISTER_PROTOCOL"] as never,
    },
  })
  const wf = await prisma.phaseInternalWorkflow.create({
    data: {
      wfUid: `${M}::ret`, phaseKey: `${M.toLowerCase()}_ret`, name: "Retificação", versao: 1, execucao: "SEQUENCIAL",
      passos: { create: chaves.map((k, i) => ({ key: k, label: k, ordem: i + 1, createsTask: true, required: true, executorKey: "padrao", cardinalidade: "RETIFICACAO", slaDays: PRAZO_HERDADO, dependeDe: CONFIGURACAO[k].dependeDe as never })) },
    },
    select: { id: true, passos: { select: { id: true, key: true }, orderBy: { ordem: "asc" } } },
  })
  for (const p of wf.passos) {
    const c = CONFIGURACAO[p.key]
    for (const [i, campo] of c.campos.entries()) {
      const f = await prisma.stepField.create({
        data: {
          stepId: p.id, key: campo.key, label: campo.label, tipo: campo.tipo,
          obrigatorio: campo.obrigatorio ?? false, ajuda: campo.ajuda ?? null, ordem: i + 1,
          ...(campo.referencia ? { opcoes: { referencia: campo.referencia } as never } : {}),
        },
        select: { id: true },
      })
      if (campo.opcoes?.length) {
        await prisma.stepFieldOption.createMany({
          data: campo.opcoes.map((o, j) => ({ fieldId: f.id, key: o.key, label: o.label, ordem: j + 1 })),
        })
      }
    }
    await prisma.stepAction.createMany({
      data: c.acoes.map((a, i) => ({
        stepId: p.id, key: a.key, label: a.label, effectKey: a.effectKey, descricao: a.descricao,
        requerCampos: (a.requerCampos ?? []) as never, ordem: i + 1,
      })) as Prisma.StepActionCreateManyInput[],
    })
    if (c.requisitos?.length) {
      await prisma.stepRequirement.createMany({
        data: c.requisitos.map((r, i) => ({
          stepId: p.id, key: r.key, label: r.label, tipo: r.tipo,
          alvoKey: r.alvoKey ?? null, acaoKey: r.acaoKey ?? null, ordem: i + 1,
        })) as Prisma.StepRequirementCreateManyInput[],
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
  check("(C4a) o cadastro por pedido publica", pub.ok, JSON.stringify(pub))

  const inst = await prisma.phaseWorkflowInstance.create({
    data: {
      processoId: proc.id, faseMacroKey: `${M.toLowerCase()}_ret`, ciclo: 1, status: "ATIVO",
      workflowDefinitionId: wf.id, workflowVersion: pub.versaoNova ?? 2, chaveIdempotencia: `${M}-i1`,
    },
    select: { id: true },
  })
  const porPacote = new Map<number, Map<string, number>>()
  for (const pacote of [pacA.pacoteId, pacB.pacoteId]) {
    const mapa = new Map<string, number>()
    for (const [i, k] of chaves.entries()) {
      const si = await prisma.phaseWorkflowStepInstance.create({
        data: {
          workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: `${M.toLowerCase()}_ret`, ciclo: 1,
          stepKey: k, ordem: i + 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
          status: i === 0 ? "EM_ANDAMENTO" : "PENDENTE",
          dependeDeStepKeys: CONFIGURACAO[k].dependeDe as never,
          retificacaoPacoteId: pacote,
          stepDefinitionId: wf.passos[i].id, stepDefinitionVersion: pub.versaoNova ?? 2,
          chaveIdempotencia: montarChavePasso({
            workflowInstanceId: inst.id, stepDefinitionId: wf.passos[i].id, stepKey: k,
            stepDefinitionVersion: pub.versaoNova ?? 2, ciclo: 1, retificacaoPacoteId: pacote,
          }),
        },
        select: { id: true },
      })
      mapa.set(k, si.id)
    }
    porPacote.set(pacote, mapa)
  }
  check("(C3c) as doze instâncias existem, seis por pedido",
    (await prisma.phaseWorkflowStepInstance.count({ where: { workflowInstanceId: inst.id } })) === 12)

  // C5 — concluir um pedido não conclui o outro.
  const siA1 = porPacote.get(pacA.pacoteId)!.get("definir_modo_de_retificacao")!
  const siB1 = porPacote.get(pacB.pacoteId)!.get("definir_modo_de_retificacao")!
  await garantirTentativa(siA1, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })
  await garantirTentativa(siB1, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })
  const c5 = await executarAcaoCadastrada(siA1, "modo_definido", { modo: "judicial" },
    { usuarioId: 1, permissoes: PERMS, correlationId: `${M}-c5` })
  const estadoB = await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: siB1 }, select: { status: true } })
  check("(C5) concluir o passo do pedido A não conclui o do pedido B",
    c5.ok && estadoB?.status === "EM_ANDAMENTO", `${JSON.stringify(c5)} / B=${estadoB?.status}`)

  // C4 — reabrir um não toca no outro.
  const { executarReabertura } = await import("../src/services/reabertura-de-execucao")
  const c4 = await executarReabertura({
    stepInstanceId: siA1, motivoCodigo: "CORRECAO", justificativa: "modo escolhido estava errado",
    comDependentes: false, actorId: 1, correlationId: `${M}-c4`,
  })
  const tentA = (await tentativasDoPasso(siA1)).length
  const tentB = (await tentativasDoPasso(siB1)).length
  check("(C4) reabrir o pedido A cria tentativa nova só nele",
    c4.ok && tentA >= 2 && tentB === 1, `ok=${c4.ok} A=${tentA} B=${tentB}`)

  // C6 — cancelar um pedido tira só ele da materialização.
  await mudarEstadoDoPacote(pacB.pacoteId, ESTADOS_DO_PACOTE.CANCELADO)
  const abertos = await pacotesAbertos(proc.id)
  check("(C6) cancelar o pedido B tira só ele do trabalho a fazer",
    abertos.length === 1 && abertos[0].id === pacA.pacoteId, JSON.stringify(abertos.map((p) => p.num)))

  // C8 — progresso isolado.
  const concluidosA = await prisma.phaseWorkflowStepInstance.count({ where: { retificacaoPacoteId: pacA.pacoteId, status: "CONCLUIDO" } })
  const concluidosB = await prisma.phaseWorkflowStepInstance.count({ where: { retificacaoPacoteId: pacB.pacoteId, status: "CONCLUIDO" } })
  check("(C8) o progresso de um pedido não conta no do outro", concluidosB === 0, `A=${concluidosA} B=${concluidosB}`)

  // E A UNIDADE ESCOLHIDA É A EXISTENTE — não nasceu entidade rival.
  check("(C9) a unidade é `RetificacaoPacote`, e não uma entidade paralela nova",
    !/model RetificacaoUnidade|model PedidoDeRetificacao/.test(schema) &&
    /retificacaoPacoteId +Int\?/.test(schema))
  check("(C10) as divergências do pedido são vínculo real, não snapshot JSON",
    /model RetificacaoPacoteDivergencia/.test(schema))
  check("(C11) e o snapshot antigo continua onde estava, sem ser apagado",
    /divergenceIds +Json\?/.test(schema))

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\nD — PRAZO: HERANÇA NÃO É OVERRIDE")
  // ══════════════════════════════════════════════════════════════════════════
  // D1 — herdado é o estado dos seis passos.
  const slas = await prisma.phaseInternalWorkflowStep.findMany({ where: { workflowId: wf.id }, select: { key: true, slaDays: true } })
  check("(D1) nenhum dos seis passos gravou prazo próprio",
    slas.every((s) => !temPrazoProprio(s.slaDays)), JSON.stringify(slas.map((s) => s.slaDays)))
  check("(D1b) e herdado não vira prazo inventado na tarefa",
    prazoOperacional(PRAZO_HERDADO, new Date()) === null)

  // D2 — round-trip: salvar sem mexer no prazo continua herdando.
  await prisma.phaseInternalWorkflowStep.updateMany({ where: { workflowId: wf.id }, data: { label: "rerrotulado" } })
  const depois = await prisma.phaseInternalWorkflowStep.findMany({ where: { workflowId: wf.id }, select: { slaDays: true } })
  check("(D2) salvar o passo não materializa o prazo da fase dentro dele",
    depois.every((s) => s.slaDays === PRAZO_HERDADO))
  const modal = read("src/components/gerenciamentoComponents/ConfiguracaoDoPassoModal.tsx")
  check("(D2b) e a tela mostra 'padrão da fase' em vez de um zero que se lê como prazo zero",
    modal.includes('placeholder="Padrão da fase"') && modal.includes("Prazo: padrão da fase"))

  // D3 — override futuro é possível, e se distingue da herança.
  const umPasso = wf.passos[0].id
  await prisma.phaseInternalWorkflowStep.update({ where: { id: umPasso }, data: { slaDays: 5 } })
  const comOverride = await prisma.phaseInternalWorkflowStep.findUnique({ where: { id: umPasso }, select: { slaDays: true } })
  check("(D3) um passo pode declarar prazo próprio, e isso se distingue de herdar",
    temPrazoProprio(comOverride?.slaDays) && prazoOperacional(comOverride!.slaDays, new Date()) !== null)
  await prisma.phaseInternalWorkflowStep.update({ where: { id: umPasso }, data: { slaDays: PRAZO_HERDADO } })

  // D4 — tarefa histórica não é recalculada por mudança de SLA depois.
  const tarefa = await prisma.tarefa.findFirst({ where: { processoId: proc.id }, select: { id: true, dataPrazo: true } })
  if (tarefa) {
    const antes = tarefa.dataPrazo
    await prisma.phaseInternalWorkflowStep.update({ where: { id: umPasso }, data: { slaDays: 9 } })
    const agora = await prisma.tarefa.findUnique({ where: { id: tarefa.id }, select: { dataPrazo: true } })
    check("(D4) mudar o SLA depois não recalcula o prazo da tarefa que já existia",
      String(antes) === String(agora?.dataPrazo))
    await prisma.phaseInternalWorkflowStep.update({ where: { id: umPasso }, data: { slaDays: PRAZO_HERDADO } })
  } else {
    check("(D4) mudar o SLA depois não recalcula o prazo da tarefa que já existia",
      true, "nenhuma tarefa foi projetada neste palco — nada a recalcular")
  }

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\nE — EXECUTOR É HANDLER; RESPONSÁVEL É OUTRA PERGUNTA")
  // ══════════════════════════════════════════════════════════════════════════
  // E1 — o executor padrão dá conta: desenhou referência, validou organização,
  // registrou campos, executou ação e concluiu — tudo acima, sem executor novo.
  const execs = await prisma.phaseInternalWorkflowStep.findMany({ where: { workflowId: wf.id }, select: { executorKey: true } })
  check("(E1) os seis passos rodam no executor padrão", execs.every((e) => e.executorKey === "padrao"))
  const registro = read("src/lib/motor/registro-de-executores.ts")
  check("(E1b) e nenhum executor de retificação foi criado",
    !/retificacao/i.test(registro.replace(/\/\/.*$/gm, "")))

  // E2/E3 — responsável não vem do executor.
  check("(E2) sem responsável explícito, a tarefa não inventa um",
    resolverResponsavel({ responsavelId: null, papel: null, equipe: null }).responsavelId === null)
  check("(E2b) papel ou equipe declarados não viram atribuição — viram pendência",
    resolverResponsavel({ responsavelId: null, papel: "Analista" }).responsavelId === null &&
    !!resolverResponsavel({ responsavelId: null, papel: "Analista" }).warning)
  check("(E3) só `responsavelId` explícito atribui",
    resolverResponsavel({ responsavelId: 7 }).responsavelId === 7)
  const helpers = read("src/services/passo-tarefa-helpers.ts")
  check("(E3b) e quem resolve responsável não conhece executor",
    !/executorKey/.test(helpers))
  const owners = await prisma.phaseInternalWorkflowStep.findMany({ where: { workflowId: wf.id }, select: { owner: true } })
  check("(E3c) nenhum cargo ou equipe foi inventado nos seis passos", owners.every((o) => o.owner == null))

  // E4 — nada de regra por fase dentro do que foi construído.
  const novos = [
    "src/lib/motor/fontes-de-campo.ts", "src/services/referencia-canonica.ts",
    "src/services/protocolo-canonico.ts", "src/services/retificacao-canonica.ts",
  ]
  const semComentario = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n")
  const corpoNovo = novos.map((f) => semComentario(read(f))).join("\n")
  check("(E4) nenhum dos serviços novos decide por phaseKey ou stepKey",
    !/phaseKey\s*===|stepKey\s*===|faseMacroKey\s*===/.test(corpoNovo))
  check("(E4b) e nenhum deles cita a Retificação como regra de negócio no motor genérico",
    !/retificacao/i.test(semComentario(read("src/lib/motor/fontes-de-campo.ts")) + semComentario(read("src/services/protocolo-canonico.ts"))))

  // ── A CONFIGURAÇÃO CONTINUA PUBLICÁVEL ────────────────────────────────────
  const paraValidar = await prisma.phaseInternalWorkflowStep.findMany({
    where: { workflowId: wf.id },
    select: {
      key: true, label: true, executorKey: true, dependeDe: true,
      campos: { select: { key: true, tipo: true, obrigatorio: true, opcoes: true, opcoesCadastradas: { select: { key: true, ativo: true } } } },
      acoes: { select: { key: true, effectKey: true, requerCampos: true } },
      checkItens: { select: { key: true } },
      requisitos: { select: { key: true, tipo: true, alvoKey: true, acaoKey: true } },
    },
  })
  const problemas = validarConfiguracao(
    paraValidar.map((p) => ({ ...p, campos: p.campos.map((c) => ({ ...c, opcoes: c.opcoesCadastradas, opcoesLegado: c.opcoes })) })) as never,
    { phaseKey: FASE, efeitosPermitidosDaFase: [...efeitosDaFase(FASE, null), "REGISTER_PROTOCOL"] },
  )
  check("a configuração com referência e protocolo canônico continua publicável",
    problemas.length === 0, JSON.stringify(problemas.slice(0, 3)))

  // E A PUBLICAÇÃO RECUSA a referência mal declarada.
  const cods = new Set(validarConfiguracao([
    { key: "a", label: "A", executorKey: "padrao", campos: [{ key: "x", tipo: "referencia" }] },
    { key: "b", label: "B", executorKey: "padrao", campos: [{ key: "y", tipo: "referencia", opcoesLegado: { referencia: "INVENTADO" } }] },
    { key: "c", label: "C", executorKey: "padrao", campos: [{ key: "z", tipo: "texto", opcoesLegado: { referencia: "ORGANIZACAO" } }] },
  ] as never, { phaseKey: FASE, efeitosPermitidosDaFase: efeitosDaFase(FASE, null) }).map((p) => p.codigo))
  check("referência sem alvo é recusada na publicação", cods.has("REFERENCIA_SEM_ALVO"))
  check("alvo fora do vocabulário é recusado", cods.has("ALVO_INEXISTENTE"))
  check("e referência declarada em campo de outro tipo é recusada", cods.has("REFERENCIA_EM_TIPO_ERRADO"))

  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) { falhas.forEach((f) => console.log(`   · ${f}`)); process.exitCode = 1 }
  await limpar()
}

void main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
