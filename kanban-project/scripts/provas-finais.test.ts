// scripts/provas-finais.test.ts
//
// AS PROVAS QUE FALTAVAM — exclusão, permissões, auditoria, pipeline e escala.
//
// Cada bloco aqui responde a uma pergunta que o resto da suíte não responde, e que
// só aparece quando alguém precisa MESMO dela: o que some quando removo uma pessoa?
// o operador consegue mexer na configuração? dá para reconstruir quem fez o quê? o
// deploy sobe com migration pendente? com 500 documentos, ainda dá para saber o que
// falta?
//
//   PRISMA_DATABASE_URL=…discovery_test npx tsx scripts/provas-finais.test.ts

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { PrismaClient } from "@prisma/client"
import { analisarRemocaoPessoa, removerPessoaDaArvore } from "../src/services/pessoa-ciclo-vida"
import { executarAcaoCadastrada } from "../src/services/executar-acao-cadastrada"
import { garantirTentativa, MOTIVOS_DE_TENTATIVA } from "../src/services/execucao-do-passo"
import { congelarVersaoVigente, publicarNovaVersao, definicaoHistoricaDoPasso } from "../src/services/versao-publicada"

const ROOT = join(__dirname, "..")
const ler = (r: string) => (existsSync(join(ROOT, r)) ? readFileSync(join(ROOT, r), "utf8") : "")
const prisma = new PrismaClient()
const M = "PROVA"

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: M } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  for (const p of procs) if (p.arvoreId) {
    await prisma.documento.deleteMany({ where: { pessoa: { arvoreId: p.arvoreId } } })
    await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
    await prisma.arvore.deleteMany({ where: { id: p.arvoreId } })
  }
  const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: `${M}::wf` }, select: { id: true } })
  if (wf) {
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: "prova_" } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: M } } })
  await prisma.usuario.deleteMany({ where: { email: { startsWith: `${M.toLowerCase()}-` } } })
}

async function main() {
  await limpar()

  // ══════════════════════════════════════════════════════════════
  secao("1. EXCLUSÃO: o preview diz a verdade e a cascata não deixa órfão")
  // ══════════════════════════════════════════════════════════════
  const arv = await prisma.arvore.create({ data: { nome: `${M} árvore` }, select: { id: true } })
  const requerente = await prisma.pessoa.create({ data: { nome: "Requerente", sobrenome: "Sai", arvoreId: arv.id }, select: { id: true } })
  const outra = await prisma.pessoa.create({ data: { nome: "Outra", sobrenome: "Fica", arvoreId: arv.id }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${M} processo`, arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: "genealogia" },
    select: { id: true },
  })
  const item = await prisma.itemCatalogo.create({ data: { code: `${M}_ITEM`, name: "Certidão prova", natureza: "SERVICO" }, select: { id: true } })
  const necDela = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, pessoaId: requerente.id, status: "PENDENTE", itemCatalogoId: item.id, chaveIdempotencia: `${M}-nec-1` },
    select: { id: true },
  })
  const necDaOutra = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, pessoaId: outra.id, status: "PENDENTE", itemCatalogoId: item.id, chaveIdempotencia: `${M}-nec-2` },
    select: { id: true },
  })
  const docDela = await prisma.documento.create({ data: { pessoaId: requerente.id, tipo: "CERTIDAO_NASCIMENTO", status: "PENDENTE", necessidadeId: necDela.id }, select: { id: true } })
  const docDaOutra = await prisma.documento.create({ data: { pessoaId: outra.id, tipo: "CERTIDAO_NASCIMENTO", status: "PENDENTE", necessidadeId: necDaOutra.id }, select: { id: true } })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "genealogia", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${M}-i` },
    select: { id: true },
  })
  const passoDela = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "genealogia", ciclo: 1,
      stepKey: "localizar_registro", ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
      status: "EM_ANDAMENTO", pessoaId: requerente.id, necessidadeId: necDela.id, documentoId: docDela.id,
      chaveIdempotencia: `${M}-passo-1`,
    },
    select: { id: true },
  })
  await garantirTentativa(passoDela.id, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "EM_ANDAMENTO" })
  await prisma.tarefa.create({
    data: {
      titulo: `${M} tarefa dela`, processoId: proc.id, workflowInstanceId: inst.id,
      workflowStepInstanceId: passoDela.id, documentoId: docDela.id, necessidadeId: necDela.id,
      statusTarefa: "EM_ANDAMENTO", chaveIdempotencia: `${M}-tar-1`,
    },
  })

  const plano = await analisarRemocaoPessoa(requerente.id)
  check("o preview existe e é lido ANTES de qualquer escrita", plano != null)
  check("  ele conta as necessidades que saem", (plano?.removiveis.necessidades ?? 0) >= 1, JSON.stringify(plano?.removiveis))
  check("  os documentos que saem", (plano?.removiveis.documentos ?? 0) >= 1)
  check("  os passos que saem", (plano?.removiveis.passos ?? 0) >= 1)
  check("  e as tarefas que saem", (plano?.removiveis.tarefas ?? 0) >= 1)

  // O QUE SE COBRA É PRESERVAÇÃO, NÃO IMOBILIDADE.
  //
  // Remover alguém dispara a reconciliação, e ela pode MATERIALIZAR uma necessidade
  // nova para quem ficou — a matriz documental recalculando o que o processo passa a
  // exigir. Isso é a regra funcionando, não dano. Contar necessidades como prova de
  // integridade confundiria as duas coisas: o que não pode acontecer é a linha DELA
  // sumir ou mudar.
  const antesOutra = await prisma.necessidadeDocumental.findMany({
    where: { pessoaId: outra.id }, select: { id: true, status: true, itemCatalogoId: true }, orderBy: { id: "asc" },
  })
  const antesDocOutra = await prisma.documento.findMany({
    where: { pessoaId: outra.id }, select: { id: true, status: true, necessidadeId: true }, orderBy: { id: "asc" },
  })
  const r = await removerPessoaDaArvore({ pessoaId: requerente.id, actorUserId: null, motivo: `${M} teste` })
  check("a remoção executa", r.ok, r.erro ?? "")
  check("  o que saiu bate com o que o preview prometeu",
    r.removidos.necessidades === plano!.removiveis.necessidades &&
    r.removidos.documentos === plano!.removiveis.documentos,
    JSON.stringify({ prometido: plano!.removiveis, real: r.removidos }))

  // ZERO ÓRFÃOS: nada pode continuar apontando para quem saiu.
  const orfaos = {
    necessidades: await prisma.necessidadeDocumental.count({ where: { pessoaId: requerente.id } }),
    documentos: await prisma.documento.count({ where: { pessoaId: requerente.id } }),
    passos: await prisma.phaseWorkflowStepInstance.count({ where: { pessoaId: requerente.id } }),
    tarefasSemPasso: await prisma.tarefa.count({
      where: { processoId: proc.id, workflowStepInstanceId: null, chaveIdempotencia: { startsWith: M } },
    }),
  }
  check("ZERO órfãos depois da remoção", Object.values(orfaos).every((n) => n === 0), JSON.stringify(orfaos))
  const depoisNecOutra = await prisma.necessidadeDocumental.findMany({
    where: { pessoaId: outra.id, id: { in: antesOutra.map((n) => n.id) } },
    select: { id: true, status: true, itemCatalogoId: true }, orderBy: { id: "asc" },
  })
  const depoisDocOutra = await prisma.documento.findMany({
    where: { pessoaId: outra.id }, select: { id: true, status: true, necessidadeId: true }, orderBy: { id: "asc" },
  })
  check("A OUTRA PESSOA CONTINUA INTEIRA — nenhuma linha dela sumiu ou mudou",
    JSON.stringify(depoisNecOutra) === JSON.stringify(antesOutra) &&
    JSON.stringify(depoisDocOutra) === JSON.stringify(antesDocOutra),
    `necessidades antes=${JSON.stringify(antesOutra)} depois=${JSON.stringify(depoisNecOutra)}`)
  // Necessidade NOVA para quem ficou é a matriz documental recalculando — e ela carrega
  // a proveniência da regra que a criou, que é como se distingue "derivada" de "solta".
  const novasParaOutra = await prisma.necessidadeDocumental.findMany({
    where: { pessoaId: outra.id, id: { notIn: antesOutra.map((n) => n.id) } },
    select: { chaveIdempotencia: true },
  })
  check("  e qualquer necessidade nova dela veio de uma REGRA, com proveniência",
    novasParaOutra.every((n) => /rd:|regra|var:/.test(n.chaveIdempotencia ?? "")),
    JSON.stringify(novasParaOutra.map((n) => n.chaveIdempotencia)))
  check("  e o documento dela continua lá", (await prisma.documento.findUnique({ where: { id: docDaOutra.id }, select: { id: true } })) != null)

  // ══════════════════════════════════════════════════════════════
  secao("2. PERMISSÕES: o backend recusa, não a tela")
  // ══════════════════════════════════════════════════════════════
  const fase = await prisma.catalogoFase.create({
    data: { phaseKey: "prova_fase", label: "Prova", escopo: "PROCESSO", efeitosPermitidos: ["COMPLETE_STEP", "REGISTER_ONLY"] },
    select: { phaseKey: true },
  })
  const wf = await prisma.phaseInternalWorkflow.create({
    data: {
      wfUid: `${M}::wf`, phaseKey: fase.phaseKey, name: "Prova", versao: 1, execucao: "SEQUENCIAL",
      passos: { create: [{ key: "unico", label: "Único", ordem: 1, cardinalidade: "PROCESSO", createsTask: true, required: true, slaDays: 1, executorKey: "padrao", dependeDe: [] }] },
    },
    select: { id: true, passos: { select: { id: true } } },
  })
  await prisma.stepField.create({ data: { stepId: wf.passos[0].id, key: "nota", label: "Nota", tipo: "textarea", ordem: 1 } })
  await prisma.stepAction.create({ data: { stepId: wf.passos[0].id, key: "ok", label: "Concluir", effectKey: "COMPLETE_STEP", ordem: 1 } })
  await congelarVersaoVigente(wf.id, "CRIACAO")

  const proc2 = await prisma.processo.create({
    data: { nome: `${M} processo 2`, arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: fase.phaseKey },
    select: { id: true },
  })
  const inst2 = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc2.id, faseMacroKey: fase.phaseKey, ciclo: 1, status: "ATIVO", workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: `${M}-i2` },
    select: { id: true },
  })
  const passo2 = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst2.id, processoId: proc2.id, faseMacroKey: fase.phaseKey, ciclo: 1,
      stepKey: "unico", ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true, status: "EM_ANDAMENTO",
      dependeDeStepKeys: [] as never, stepDefinitionId: wf.passos[0].id, stepDefinitionVersion: 1,
      chaveIdempotencia: `${M}-passo-2`,
    },
    select: { id: true },
  })
  await garantirTentativa(passo2.id, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "EM_ANDAMENTO" })

  const semNada = await executarAcaoCadastrada(passo2.id, "ok", {}, { usuarioId: 1, permissoes: [], correlationId: `${M}-p1` })
  check("operador sem permissão não executa a ação", !semNada.ok && semNada.codigo === "SEM_PERMISSAO")
  const comPermissao = await executarAcaoCadastrada(passo2.id, "ok", {}, { usuarioId: 1, permissoes: ["tarefas.editar", "workflow.concluirPasso"], correlationId: `${M}-p2` })
  check("com a permissão certa, executa", comPermissao.ok, JSON.stringify(comPermissao))

  // A CONFIGURAÇÃO estrutural é do admin: as rotas exigem `usuarios.gerenciar`.
  const rotaWf = ler("src/app/api/gerenciamento/workflows-fase/[id]/route.ts")
  const rotaCanais = ler("src/app/api/gerenciamento/canais/route.ts")
  const rotaFases = ler("src/app/api/gerenciamento/catalogo-fases/[id]/route.ts")
  check("editar workflow exige permissão de administrador", rotaWf.includes("verificarPermissao(request, 'usuarios.gerenciar')"))
  check("cadastrar canal exige permissão de administrador", rotaCanais.includes("verificarPermissao(request, 'usuarios.gerenciar')"))
  check("editar fase exige permissão de administrador", rotaFases.includes("verificarPermissao(request, 'usuarios.gerenciar')"))
  const rotaExec = ler("src/app/api/workflow-step-instances/[id]/execucao/route.ts")
  check("executar etapa exige permissão de execução, não de administração",
    rotaExec.includes('verificarPermissao(request, "workflow.iniciarPasso")'))

  // ══════════════════════════════════════════════════════════════
  secao("3. AUDITORIA: dá para reconstruir quem fez o quê")
  // ══════════════════════════════════════════════════════════════
  const auditoria = await prisma.logAuditoria.findMany({
    where: { entidade: "PhaseWorkflowStepInstance", entidadeId: passo2.id },
    select: { acao: true, descricao: true, detalhes: true, usuarioId: true, criadoEm: true },
  })
  check("a ação executada deixou registro", auditoria.length >= 1)
  const reg = auditoria.find((a) => a.acao === "STEP_ACTION_EXECUTED")
  check("  com QUEM", reg?.usuarioId === 1)
  check("  QUANDO", reg?.criadoEm != null)
  check("  O QUÊ (a ação e o efeito)",
    (reg?.detalhes as { acao?: string; efeito?: string } | null)?.acao === "ok" &&
    (reg?.detalhes as { efeito?: string } | null)?.efeito === "COMPLETE_STEP")
  check("  e SOB QUAL VERSÃO da configuração",
    (reg?.detalhes as { versao?: number } | null)?.versao === 1)
  const eventos = await prisma.workflowEvento.findMany({
    where: { stepInstanceId: passo2.id }, select: { tipo: true, correlationId: true },
  })
  check("o histórico do motor registrou a transição", eventos.some((e) => e.tipo === "PASSO_CONCLUIDO"))
  check("  com correlação para amarrar o comando ao efeito", eventos.every((e) => e.correlationId != null))

  // ══════════════════════════════════════════════════════════════
  secao("4. V2 EM PROCESSO NOVO: P1 fica em V1, P2 nasce em V2")
  // ══════════════════════════════════════════════════════════════
  await prisma.$transaction(async (tx) => {
    await publicarNovaVersao(wf.id, tx)
    await tx.stepAction.create({ data: { stepId: wf.passos[0].id, key: "novo_em_v2", label: "Novo", effectKey: "REGISTER_ONLY", ordem: 2 } })
    await congelarVersaoVigente(wf.id, "PUBLICACAO", tx)
  })
  const proc3 = await prisma.processo.create({
    data: { nome: `${M} processo 3`, arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: fase.phaseKey },
    select: { id: true },
  })
  const wfAtual = await prisma.phaseInternalWorkflow.findUnique({ where: { id: wf.id }, select: { versao: true } })
  const inst3 = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc3.id, faseMacroKey: fase.phaseKey, ciclo: 1, status: "ATIVO", workflowDefinitionId: wf.id, workflowVersion: wfAtual!.versao, chaveIdempotencia: `${M}-i3` },
    select: { id: true },
  })
  const passo3 = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst3.id, processoId: proc3.id, faseMacroKey: fase.phaseKey, ciclo: 1,
      stepKey: "unico", ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true, status: "EM_ANDAMENTO",
      dependeDeStepKeys: [] as never, stepDefinitionId: wf.passos[0].id, stepDefinitionVersion: 1,
      chaveIdempotencia: `${M}-passo-3`,
    },
    select: { id: true },
  })
  await garantirTentativa(passo3.id, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "EM_ANDAMENTO" })

  const histP1 = await definicaoHistoricaDoPasso(passo2.id)
  const histP2 = await definicaoHistoricaDoPasso(passo3.id)
  check("P1 continua na versão 1", histP1?.versao === 1)
  check("  e vê 1 ação", histP1?.passo.acoes.length === 1)
  check("P2, criado depois, nasce na versão 2", histP2?.versao === 2)
  check("  e vê 2 ações — a nova incluída", histP2?.passo.acoes.length === 2)
  const acaoNovaEmP2 = await executarAcaoCadastrada(passo3.id, "novo_em_v2", {}, { usuarioId: 1, permissoes: ["tarefas.editar"], correlationId: `${M}-v2` })
  check("P2 executa a ação que só existe em V2", acaoNovaEmP2.ok, JSON.stringify(acaoNovaEmP2))

  // ══════════════════════════════════════════════════════════════
  secao("5. ESCALA: as seis perguntas com 500 documentos")
  // ══════════════════════════════════════════════════════════════
  const pessoaEscala = await prisma.pessoa.create({ data: { nome: "Escala", sobrenome: "Prova", arvoreId: arv.id }, select: { id: true } })
  const responsavel = await prisma.usuario.create({
    data: { nome: `${M} Resp`, email: `${M.toLowerCase()}-r@teste.local`, senha: "x", tipo: "FUNCIONARIO" },
    select: { id: true },
  })
  await prisma.documento.createMany({
    data: Array.from({ length: 500 }, (_, i) => ({
      pessoaId: pessoaEscala.id, tipo: "CERTIDAO_NASCIMENTO" as never,
      status: (i % 5 === 0 ? "SOLICITAR" : i % 5 === 1 ? "SOLICITADO" : i % 5 === 2 ? "RECEBIDO" : i % 5 === 3 ? "EM_ANALISE" : "PENDENTE") as never,
      descricao: `${M} doc ${i}`,
      responsavelId: i % 2 === 0 ? responsavel.id : null,
      dataPrazoOperacao: new Date(Date.now() + ((i % 20) - 10) * 864e5),
      motivoBloqueio: i % 7 === 0 ? "aguardando cartório" : null,
    })),
  })
  const t0 = Date.now()
  const [faltam, porEtapa, semResp, atrasados, bloqueados] = await Promise.all([
    prisma.documento.count({ where: { pessoaId: pessoaEscala.id, status: { in: ["PENDENTE", "SOLICITAR", "SOLICITADO"] } } }),
    prisma.documento.groupBy({ by: ["status"], where: { pessoaId: pessoaEscala.id }, _count: { _all: true } }),
    prisma.documento.count({ where: { pessoaId: pessoaEscala.id, responsavelId: null } }),
    prisma.documento.count({ where: { pessoaId: pessoaEscala.id, dataPrazoOperacao: { lt: new Date() } } }),
    prisma.documento.count({ where: { pessoaId: pessoaEscala.id, motivoBloqueio: { not: null } } }),
  ])
  const ms = Date.now() - t0
  console.log(`      as seis perguntas juntas: ${ms}ms`)
  check("quais faltam?", faltam > 0)
  check("em que etapa cada um está?", porEtapa.length >= 4)
  check("quais estão sem responsável?", semResp === 250, `${semResp}`)
  check("quais estão atrasados?", atrasados > 0)
  check("quais estão bloqueados?", bloqueados > 0)
  check("as seis respondem juntas em menos de 3s", ms < 3000, `${ms}ms`)

  // ══════════════════════════════════════════════════════════════
  secao("6. PIPELINE: o deploy não sobe com migration pendente")
  // ══════════════════════════════════════════════════════════════
  const guard = ler("scripts/migration-pendente-guard.mjs")
  check("o guard de migration pendente existe", guard.length > 0)
  check("  ele compara repositório × alvo", /pendente/i.test(guard) && /_prisma_migrations/.test(guard))
  const pkg = JSON.parse(ler("package.json")) as { scripts: Record<string, string> }
  check("  e está ligado ao build", /migration-pendente-guard/.test(pkg.scripts.build ?? ""),
    pkg.scripts.build ?? "")
  check("o baseline é verificado no build", /test:baseline|baseline-verificar/.test(pkg.scripts.build ?? ""))

  await limpar()
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) for (const f of falhas) console.log(`  · ${f}`)
  await prisma.$disconnect()
  process.exit(falhas.length ? 1 : 0)
}

void main()
