// scripts/cancelamento-operacao-documento.test.ts
// ============================================================================
// CANCELADA != CONCLUÍDA — achado real: documento 2131 ("Certidão de óbito",
// Lorenzo Giovanni Santin). `solicitar_certidao` já estava CONCLUIDO quando o
// operador cancelou a operação; os 4 passos restantes viraram CANCELADO.
// `passosOperacaoV2` (sem opções) filtra `status notIn INATIVOS` — CANCELADO
// está em INATIVOS —, então só sobrava o passo CONCLUIDO: `montarWorkflowV2`
// computava progress=100/status="concluido" para uma operação CANCELADA.
// Corrigido em `src/services/documento-operacao.ts` (10-11/09/2026).
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" \
//   npx tsx scripts/cancelamento-operacao-documento.test.ts
// ============================================================================
import { PrismaClient } from "@prisma/client"
import { montarWorkflowV2, controlarOperacaoV2 } from "../src/services/documento-operacao"
import { concluirPasso } from "../src/services/task-step-sync"
import { reconciliarFaseAtiva } from "../src/services/reconciliar-fase"
import { getPhaseOperationalStructure, getPhaseOperationalSummary } from "../src/lib/process-stage/estrutura-operacional"
import { garantirOferta } from "./_fixture-oferta"

const url = process.env.PRISMA_DATABASE_URL ?? ""
if (!/discovery_test/.test(url)) {
  console.error("\n❌ Este teste ESCREVE. Aponte PRISMA_DATABASE_URL para o banco de TESTE local.\n")
  process.exit(1)
}

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const prisma = new PrismaClient()

const FASE_DOC = "emissao_documental"
const PASSOS_DOC = [
  { key: "solicitar_certidao", label: "Solicitar certidão" },
  { key: "aguardar_retorno_do_cartorio", label: "Aguardar retorno do cartório" },
  { key: "receber_certidao", label: "Receber certidão" },
  { key: "conferir_certidao", label: "Conferir certidão" },
  { key: "validar_certidao", label: "Validar certidão" },
]

async function montarPalco() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Processo","Arvore","Pessoa","Uniao","Documento","NecessidadeDocumental","NecessidadeDocumentalEvento","PhaseWorkflowInstance","PhaseWorkflowStepInstance","PhaseInternalWorkflow","PhaseInternalWorkflowStep","WorkflowEvento","DomainOutbox","Tarefa","MacroWorkflow","FaseMacro","MatrizDocumental","TipoDocumentoCadastro","ItemCatalogo","LogAuditoria","DocumentoArquivo","DocumentoObservacao" RESTART IDENTITY CASCADE',
  )
  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })
  const oferta = await garantirOferta(prisma, { countryKey: "italia", countryLabel: "Itália", nationalityKey: "italiana", nationalityLabel: "Italiana", modalityKey: "administrativa", modalityLabel: "Administrativa" })
  const tipo = await prisma.tipoProcessoNacionalidade.upsert({
    where: { code: "ITA-ADM-CANC" }, update: {},
    create: { code: "ITA-ADM-CANC", name: "Nacionalidade Italiana", paisId: oferta.paisId, modalidadeId: oferta.modalidadeId, processFamily: "CIDADANIA", serviceNature: "PROCESSO" },
  })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, name: "macro cancelamento", versao: 1 } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: FASE_DOC, label: FASE_DOC, ordem: 0, versao: 1, required: true, conditional: false } })
  const wfDoc = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `all::${FASE_DOC}`, phaseKey: FASE_DOC, name: "WF doc", tipoProcessoId: null, versao: 1, execucao: "SEQUENCIAL", escopoExecucao: "DOCUMENTO", exigeDocumento: true, exigePessoa: true },
    select: { id: true },
  })
  await prisma.phaseInternalWorkflowStep.createMany({
    data: PASSOS_DOC.map((p, i) => ({ workflowId: wfDoc.id, key: p.key, label: p.label, ordem: i + 1, createsTask: true, required: true, owner: "equipe_documental", slaDays: 3, cardinalidade: "DOCUMENTO" })),
  })
  const arv = await prisma.arvore.create({ data: { nome: "árvore cancelamento" }, select: { id: true } })
  const usuario = await prisma.usuario.upsert({
    where: { email: "cancelamento@teste.local" }, update: {},
    create: { nome: "Operador Teste", email: "cancelamento@teste.local", senha: "x", tipo: "admin" }, select: { id: true },
  })
  const proc = await prisma.processo.create({
    data: { nome: "processo cancelamento", tipoProcessoMotorId: tipo.id, arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: FASE_DOC },
    select: { id: true },
  })
  const item = await prisma.itemCatalogo.create({ data: { code: "CANC_ITEM", name: "Certidão de Óbito", natureza: "DOCUMENTO" }, select: { id: true } })
  await prisma.tipoDocumentoCadastro.create({ data: { code: "CANC_TIPO", name: "Certidão de Óbito", nature: "certidao", itemCatalogoId: item.id } })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Pessoa", sobrenome: "Teste", linhaReta: true, requerente: "nao" }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({ data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: "CANC-nec" }, select: { id: true } })
  const doc = await prisma.documento.create({ data: { pessoaId: pes.id, descricao: "Certidão de Óbito teste", necessidadeId: nec.id }, select: { id: true } })
  // reconciliarFaseAtiva JÁ materializa os passos da fase (mesma rotina do
  // GET/drawer) — chamar iniciarOperacaoDocumentoV2 de novo bateria no guard
  // de idempotência dela ("Operação já existe").
  await reconciliarFaseAtiva(proc.id)

  const ctx = { usuarioId: usuario.id, permissoes: { "workflow.iniciarPasso": true, "tarefas.bloquear": true, "tarefas.excluir": true }, isAdmin: false }
  return { processoId: proc.id, usuarioId: usuario.id, documentoId: doc.id, necessidadeId: nec.id, ctx }
}

async function main() {
  console.log("CANCELAR OPERAÇÃO — CANCELADA != CONCLUÍDA\n")

  // ══════════════════════════════════════════════════════════════════════════
  secao("1) Cenário real: 1 etapa concluída, cancela no meio do roteiro (caso Santin/2131)")
  // ══════════════════════════════════════════════════════════════════════════
  const p1 = await montarPalco()
  // Conclui a 1ª etapa (solicitar_certidao) — igual ao caso real: o operador já
  // tinha solicitado a certidão quando decidiu cancelar.
  const passo1 = await prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { documentoId: p1.documentoId, stepKey: "solicitar_certidao" }, select: { id: true } })
  await concluirPasso(passo1.id, { origem: "USER", usuarioId: p1.usuarioId, correlationId: "cancel-test-1" })

  const antes = await montarWorkflowV2(p1.documentoId, p1.ctx)
  check("1a) antes de cancelar: status em_andamento", antes?.status === "em_andamento")

  const rc = await controlarOperacaoV2(p1.documentoId, "cancelar", "Documento incorreto", p1.ctx)
  check("1b) cancelar retorna ok", rc.ok === true)

  const depois = await montarWorkflowV2(p1.documentoId, p1.ctx)
  check("1c) status = 'cancelado', NUNCA 'concluido'", depois?.status === "cancelado", String(depois?.status))
  check("1d) progress NÃO é 100% (era o bug: só sobrava o passo já concluído)", (depois?.progress ?? 0) < 100, String(depois?.progress))
  check("1e) progress é a fração REAL concluída antes do cancelamento (não 0, não 100)", (depois?.progress ?? -1) > 0 && (depois?.progress ?? 101) < 100, String(depois?.progress))
  check("1f) cancelledAt preenchido", !!depois?.cancelledAt)
  check("1g) cancelReason preenchido com o motivo", (depois?.cancelReason ?? "").includes("Documento incorreto"))
  check("1h) todos os 5 passos aparecem (inclusive os cancelados) — a verdade do que aconteceu", depois?.steps.length === 5, String(depois?.steps.length))

  // ══════════════════════════════════════════════════════════════════════════
  secao("2) Documento NÃO fica 'pronto'; Tarefa NÃO fica concluída; fase macro não muda")
  // ══════════════════════════════════════════════════════════════════════════
  const docDepois = await prisma.documento.findUniqueOrThrow({ where: { id: p1.documentoId }, select: { status: true } })
  check("2a) Documento.status = CANCELADO", docDepois.status === "CANCELADO")
  const tarefa = await prisma.tarefa.findFirstOrThrow({ where: { documentoId: p1.documentoId }, select: { statusTarefa: true, concluida: true } })
  check("2b) Tarefa.statusTarefa = CANCELADA", tarefa.statusTarefa === "CANCELADA")
  check("2c) Tarefa.concluida = false (cancelar não é concluir)", tarefa.concluida === false)
  const procDepois = await prisma.processo.findUniqueOrThrow({ where: { id: p1.processoId }, select: { faseAtualKey: true } })
  check("2d) fase macro do processo não mudou sozinha", procDepois.faseAtualKey === FASE_DOC)
  const stepsCancelados = await prisma.phaseWorkflowStepInstance.findMany({ where: { documentoId: p1.documentoId, status: "CANCELADO" } })
  check("2e) os 4 passos restantes foram CANCELADO, nenhum marcado CONCLUIDO artificialmente", stepsCancelados.length === 4)

  // ══════════════════════════════════════════════════════════════════════════
  secao("3) IDEMPOTÊNCIA — cancelar de novo não produz novo efeito")
  // ══════════════════════════════════════════════════════════════════════════
  const docAntesSegundo = await prisma.documento.findUniqueOrThrow({ where: { id: p1.documentoId }, select: { ultimaMovimentacao: true, motivoBloqueio: true } })
  const logsAntes = await prisma.logAuditoria.count({ where: { acao: "TAREFA_CANCELADA" } })
  const rc2 = await controlarOperacaoV2(p1.documentoId, "cancelar", "Motivo diferente desta vez", p1.ctx)
  check("3a) segunda chamada continua ok=true (não quebra, não vira erro)", rc2.ok === true)
  const docDepoisSegundo = await prisma.documento.findUniqueOrThrow({ where: { id: p1.documentoId }, select: { ultimaMovimentacao: true, motivoBloqueio: true } })
  check("3b) ultimaMovimentacao NÃO mudou (sem motivo operacional novo)", docAntesSegundo.ultimaMovimentacao?.getTime() === docDepoisSegundo.ultimaMovimentacao?.getTime())
  check("3c) motivoBloqueio NÃO foi sobrescrito pelo 'motivo diferente' da 2ª chamada", docDepoisSegundo.motivoBloqueio === docAntesSegundo.motivoBloqueio)
  const logsDepois = await prisma.logAuditoria.count({ where: { acao: "TAREFA_CANCELADA" } })
  check("3d) exatamente UM evento TAREFA_CANCELADA (a 2ª chamada não duplicou)", logsDepois === logsAntes && logsDepois === 1, `${logsAntes} → ${logsDepois}`)
  const stepsAindaCancelados = await prisma.phaseWorkflowStepInstance.count({ where: { documentoId: p1.documentoId, status: "CANCELADO" } })
  check("3e) ainda exatamente 4 passos CANCELADO (não recriou nem duplicou)", stepsAindaCancelados === 4)

  // ══════════════════════════════════════════════════════════════════════════
  secao("4) FILAS E CONTADORES — Tarefa cancelada não aparece como aberta/executável/concluída")
  // ══════════════════════════════════════════════════════════════════════════
  const { indicadoresGerenciais } = await import("../lib/operacional/tarefa-projecoes")
  const tarefaRow = await prisma.tarefa.findFirstOrThrow({ where: { documentoId: p1.documentoId }, select: { id: true, responsavelId: true } })
  const ind = await indicadoresGerenciais({ responsavelId: tarefaRow.responsavelId ?? undefined }, new Date())
  check("4a) não entra em 'total' (Abertas)", ind.total === 0, String(ind.total))
  check("4b) não entra em 'executavelAgora'", ind.executavelAgora === 0, String(ind.executavelAgora))
  check("4c) não entra em 'concluidas' (cancelar != concluir)", ind.concluidas === 0, String(ind.concluidas))

  // ══════════════════════════════════════════════════════════════════════════
  secao("5) SEGUNDA PROJEÇÃO — Central Operacional (achado real 11/09/2026, mesmo caso Santin/2131)")
  // ══════════════════════════════════════════════════════════════════════════
  // PRECISA rodar ANTES do cenário-controle abaixo: `montarPalco()` faz TRUNCATE e
  // apagaria o processo/documento p1 que este bloco lê.
  // O Part 1 corrigiu `montarWorkflowV2` (o drawer do documento). O usuário reportou
  // com screenshot que a MESMA certidão cancelada continuava aparecendo como
  // "Concluída"/100%/"1/1" numa tela INDEPENDENTE: o card da pessoa na Central
  // Operacional (`getPhaseOperationalStructure`/`getPhaseOperationalSummary`,
  // `estrutura-operacional.ts` + `estrutura-operacional-core.ts`). Raiz dupla:
  // (a) a consulta que monta `alvo.passos` já excluía CANCELADO/SUPERSEDIDO, então
  // só sobrava o passo concluído (1/1 = 100%); (b) `tarefasVivasDasUnidades` só
  // devolve tarefas NÃO terminais — uma Tarefa CANCELADA nunca chegava a
  // `estadoNaFase` para o mapa `ESTADO_POR_STATUS_TAREFA` decidir. A fonte
  // autoritativa usada na correção é `Documento.status`, não a Tarefa.
  const { estrutura } = await getPhaseOperationalStructure({ processoId: p1.processoId, faseMacroKey: FASE_DOC })
  const todasPessoasEstrutura = [...estrutura.linhaPrincipal, ...estrutura.foraDaLinha, ...estrutura.pendenteClassificacao]
  const pessoaEstrutura = todasPessoasEstrutura.find((l) => l.documentos.some((d) => d.documentoId === p1.documentoId))!
  const alvoEstrutura = pessoaEstrutura.documentos.find((d) => d.documentoId === p1.documentoId)!
  check("5a) getPhaseOperationalStructure: alvo existe e é encontrado pelo documentoId", alvoEstrutura != null)

  const { indice } = await getPhaseOperationalSummary({ processoId: p1.processoId, faseMacroKey: FASE_DOC })
  const todasPessoas = [...indice.linhaPrincipal, ...indice.foraDaLinha, ...indice.pendenteClassificacao]
  const pessoa = todasPessoas.find((p) => p.documentos.some((d) => d.documentoId === p1.documentoId))!
  const linha = pessoa.documentos.find((d) => d.documentoId === p1.documentoId)!

  check("5b) statusFinal = CANCELADO, NUNCA PRONTO", linha.statusFinal === "CANCELADO", linha.statusFinal)
  check("5c) statusFinalLabel = 'Cancelado'", linha.statusFinalLabel === "Cancelado", linha.statusFinalLabel)
  check("5d) naFase.estado = CANCELADA, NUNCA CONCLUIDA", linha.naFase.estado === "CANCELADA", linha.naFase.estado)
  check("5e) naFase.estadoLabel = 'Cancelada', NUNCA 'Concluída'", linha.naFase.estadoLabel === "Cancelada", linha.naFase.estadoLabel)
  check("5f) progresso NÃO é 1/1 · 100% — é a fração REAL (1 de 5 · 31%, mesmo peso do Part 1)",
    linha.naFase.progresso.total === 5 && linha.naFase.progresso.concluidos === 1 && linha.naFase.progresso.pct === 31,
    JSON.stringify(linha.naFase.progresso))
  check("5g) documento continua VISÍVEL na lista (não desaparece)", linha != null)

  check("5h) resumo do índice: 'cancelados' soma 1, e documentos = prontos+pendentes+divergentes+cancelados (fecha)",
    indice.resumo.cancelados === 1 &&
    indice.resumo.documentos === indice.resumo.prontos + indice.resumo.pendentes + indice.resumo.divergentes + indice.resumo.cancelados,
    JSON.stringify(indice.resumo))
  check("5i) totais da pessoa também fecham (mesma régua)",
    pessoa.totais.cancelados === 1 &&
    pessoa.totais.documentos === pessoa.totais.prontos + pessoa.totais.pendentes + pessoa.totais.divergentes + pessoa.totais.cancelados,
    JSON.stringify(pessoa.totais))
  check("5j) o cancelado NÃO conta em 'prontos'", pessoa.totais.prontos === 0, String(pessoa.totais.prontos))

  // Re-lê do zero: a projeção não é cache — cada leitura recalcula do banco.
  const { indice: indice2 } = await getPhaseOperationalSummary({ processoId: p1.processoId, faseMacroKey: FASE_DOC })
  const linha2 = [...indice2.linhaPrincipal, ...indice2.foraDaLinha, ...indice2.pendenteClassificacao]
    .flatMap((p) => p.documentos).find((d) => d.documentoId === p1.documentoId)!
  check("5k) segunda leitura é idêntica (determinístico, não é acaso de cache)",
    linha2.statusFinal === "CANCELADO" && linha2.naFase.estado === "CANCELADA")

  // ══════════════════════════════════════════════════════════════════════════
  secao("6) Cenário controle: cancelar SEM nenhuma etapa concluída antes (roteiro inteiro cancelado)")
  // ══════════════════════════════════════════════════════════════════════════
  const p2 = await montarPalco()
  const rc3 = await controlarOperacaoV2(p2.documentoId, "cancelar", "Nunca chegou a avançar", p2.ctx)
  check("6a) cancela ok mesmo sem nenhum passo concluído", rc3.ok === true)
  const depois2 = await montarWorkflowV2(p2.documentoId, p2.ctx)
  check("6b) status = cancelado", depois2?.status === "cancelado")
  check("6c) progress = 0 (nada foi concluído antes)", depois2?.progress === 0, String(depois2?.progress))
  check("6d) NUNCA 'concluido' mesmo com progress 0", depois2?.status !== "concluido")
  // LIMITAÇÃO CONHECIDA, PRÉ-EXISTENTE, FORA DO ESCOPO DESTA CORREÇÃO: quando TODOS
  // os passos do alvo são cancelados (nenhum jamais chegou a ser concluído),
  // `getPhaseOperationalStructure` cai no early-return "fase sem instância
  // materializada" (`instancias.length === 0`, ANTES de `alvos` existir) — o
  // documento nem chega a aparecer na Central Operacional. Isso já acontecia antes
  // desta correção (é o MESMO comportamento para qualquer fase sem instância ativa)
  // e é diferente do bug relatado (que tinha 1 passo concluído sobrevivendo ao
  // filtro). Decidir se um cancelamento "do zero" deve gerar uma linha fantasma
  // 0%/Cancelada é decisão de produto, não bug — registrado aqui para não
  // desaparecer da memória do projeto.
  const { indice: indiceControle } = await getPhaseOperationalSummary({ processoId: p2.processoId, faseMacroKey: FASE_DOC })
  const linhaControle = [...indiceControle.linhaPrincipal, ...indiceControle.foraDaLinha, ...indiceControle.pendenteClassificacao]
    .flatMap((p) => p.documentos).find((d) => d.documentoId === p2.documentoId)
  check("6e) LIMITAÇÃO CONHECIDA (documentada, não corrigida agora): cancelamento sem NENHUM passo jamais concluído não gera linha na Central — early-return por falta de instância ativa",
    linhaControle === undefined)

  console.log(`\n${ok} passaram, ${falhas.length} falharam`)
  if (falhas.length) console.log("Falhas:", falhas.join(", "))
  await prisma.$disconnect()
  process.exit(falhas.length > 0 ? 1 : 0)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
