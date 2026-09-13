// scripts/verificador-integridade-emissao.test.ts
// ============================================================================
// VERIFICADOR DE INTEGRIDADE — "Solicitar Certidão" (Emissão Documental).
// Rodar: npm run test:verificador-emissao
//
// Exercita, de forma determinística e uma a uma, as 20 verificações
// EMI-001..EMI-020 (`lib/saude/verificacoes/emissao-documental.ts`) contra o
// banco de TESTE LOCAL. Para cada item:
//   1. monta um cenário "bom" (não deveria disparar a verificação);
//   2. roda o motor de Saúde do Sistema filtrado ao código — confirma ausência
//      do achado;
//   3. aplica a MENOR mutação que reproduz o problema descrito no mandato;
//   4. roda o motor de novo — confirma que o achado aparece, com a MESMA
//      chave estável que a verificação produziria em produção.
//
// Cada cenário usa seu PRÓPRIO processo/árvore/pessoa (prefixo de marca
// EMIINTEG) — nada é compartilhado entre eles, então a ordem de execução não
// importa e um cenário nunca contamina o outro.
//
// ESCREVE NO BANCO — só roda no banco de teste local (`exigirBancoDeTeste`).
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { executarDiagnostico } from "../lib/saude"
import "../lib/saude" // registra o catálogo (garante que EMI-001..020 existem)

const MARCA = "EMIINTEG"
const PHASE_KEY = "emissao_documental"
const STEP_KEYS = ["solicitar_certidao", "aguardar_retorno_do_cartorio", "receber_certidao", "conferir_certidao", "validar_certidao"]

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

/** Roda SÓ o código pedido e devolve a execução (achados + status). */
async function rodar(codigo: string) {
  const r = await executarDiagnostico({ modo: "PROFUNDO", somenteCodigos: [codigo] })
  const exec = r.execucoes.find((e) => e.codigo === codigo)
  if (!exec) throw new Error(`código ${codigo} não existe no catálogo`)
  if (exec.status === "FALHA_TECNICA" || exec.status === "TIMEOUT") {
    throw new Error(`${codigo} falhou tecnicamente: ${exec.erro}`)
  }
  return exec
}
const temAchado = (exec: Awaited<ReturnType<typeof rodar>>, chave: string) => exec.achados.some((a) => a.chave === chave)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const procIds = procs.map((p) => p.id)
  const arvIds = procs.map((p) => p.arvoreId).filter((x): x is number => x != null)

  await prisma.$executeRawUnsafe(`SET session_replication_role = replica`)
  try {
    if (procIds.length) {
      const tarefaIds = (await prisma.tarefa.findMany({ where: { processoId: { in: procIds } }, select: { id: true } })).map((t) => t.id)
      if (tarefaIds.length) {
        await prisma.workflowEvento.deleteMany({ where: { tarefaId: { in: tarefaIds } } })
        await prisma.solicitacaoDocumento.deleteMany({ where: { tarefaId: { in: tarefaIds } } })
        await prisma.tarefa.deleteMany({ where: { id: { in: tarefaIds } } })
      }
      await prisma.workflowEvento.deleteMany({ where: { processoId: { in: procIds } } })
      await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: procIds } } })
      await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: procIds } } })
      const docIds = (await prisma.documento.findMany({ where: { pessoa: { arvoreId: { in: arvIds.length ? arvIds : [-1] } } }, select: { id: true } })).map((d) => d.id)
      if (docIds.length) await prisma.documentoArquivo.deleteMany({ where: { documentoId: { in: docIds } } })
      await prisma.documento.deleteMany({ where: { pessoa: { arvoreId: { in: arvIds.length ? arvIds : [-1] } } } })
      await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: procIds } } })
      await prisma.processo.deleteMany({ where: { id: { in: procIds } } })
    }
    if (arvIds.length) {
      await prisma.pessoa.deleteMany({ where: { arvoreId: { in: arvIds } } })
      await prisma.arvore.deleteMany({ where: { id: { in: arvIds } } })
    }
    await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflow: { wfUid: { startsWith: MARCA } } } })
    await prisma.phaseInternalWorkflow.deleteMany({ where: { wfUid: { startsWith: MARCA } } })
    await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
    await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA.toLowerCase() } } })
  } finally {
    await prisma.$executeRawUnsafe(`SET session_replication_role = DEFAULT`)
  }
}

let seq = 0
async function usuario(sufixo: string) {
  seq++
  return prisma.usuario.create({
    data: { nome: `${MARCA} ${sufixo}`, email: `${MARCA.toLowerCase()}-${sufixo}-${seq}@teste.local`, senha: "x", tipo: "assistente" },
    select: { id: true },
  })
}

/**
 * Monta o cenário "bom" completo: workflow publicado com os 5 passos reais,
 * uma instância, os 5 PhaseWorkflowStepInstance (4 já concluídos, o 5º —
 * validar_certidao — DISPONIVEL), 1 Documento ligado a 1 Necessidade, e a
 * ÚNICA Tarefa canônica apontando para o passo 5. Nada aqui, por si só,
 * deveria disparar NENHUMA das 20 verificações.
 */
async function montarBase(sufixo: string) {
  seq++
  const tag = `${sufixo}-${seq}`
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}-${tag}`, name: `Certidão ${tag}`, natureza: "DOCUMENTO" }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} ${tag}` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} ${tag}`, arvoreId: arv.id }, select: { id: true } })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Pessoa", sobrenome: tag }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${tag}` },
    select: { id: true },
  })
  const doc = await prisma.documento.create({
    data: { pessoaId: pes.id, necessidadeId: nec.id, tipo: "CERTIDAO_NASCIMENTO", status: "PENDENTE" },
    select: { id: true },
  })
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA}-wfuid-${tag}`, phaseKey: PHASE_KEY, name: `${MARCA} Solicitar Certidão ${tag}`, active: true, arquivado: false, versao: 1 },
    select: { id: true },
  })
  const stepDefIds: number[] = []
  for (let i = 0; i < STEP_KEYS.length; i++) {
    const sd = await prisma.phaseInternalWorkflowStep.create({
      data: { workflowId: wf.id, key: STEP_KEYS[i], label: STEP_KEYS[i], ordem: i + 1 },
      select: { id: true },
    })
    stepDefIds.push(sd.id)
  }
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: PHASE_KEY, ciclo: 1, status: "ATIVO", workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: `${MARCA}-inst-${tag}` },
    select: { id: true },
  })
  const responsavel = await usuario(tag)
  const stepIds: number[] = []
  for (let i = 0; i < STEP_KEYS.length; i++) {
    const s = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: PHASE_KEY, stepKey: STEP_KEYS[i], ordem: i + 1,
        tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
        documentoId: doc.id, necessidadeId: nec.id, stepDefinitionId: stepDefIds[i], responsavelId: responsavel.id,
        status: i < 4 ? "CONCLUIDO" : "DISPONIVEL",
        chaveIdempotencia: `${MARCA}-step-${tag}-${STEP_KEYS[i]}`,
      },
      select: { id: true },
    })
    stepIds.push(s.id)
  }
  const tarefa = await prisma.tarefa.create({
    data: {
      titulo: `${MARCA} ${tag}`, processoId: proc.id, tipo: "NORMAL", faseMacroKey: PHASE_KEY,
      workflowInstanceId: inst.id, workflowStepInstanceId: stepIds[4], documentoId: doc.id, necessidadeId: nec.id,
      responsavelId: responsavel.id, statusTarefa: "EM_ANDAMENTO", concluida: false,
      chaveIdempotencia: `${MARCA}-tarefa-${tag}`,
    },
    select: { id: true },
  })
  return {
    processoId: proc.id, arvoreId: arv.id, pessoaId: pes.id, necessidadeId: nec.id, documentoId: doc.id,
    workflowId: wf.id, workflowInstanceId: inst.id, stepIds, stepDefIds, tarefaId: tarefa.id, responsavelId: responsavel.id,
    itemId: item.id,
  }
}

async function main() {
  exigirBancoDeTeste("verificador de integridade da Emissão Documental (EMI-001..020)")
  await limpar()

  console.log("VERIFICADOR DE INTEGRIDADE — SOLICITAR CERTIDÃO (EMI-001..EMI-020)\n")

  // ── EMI-001 — Tarefa aberta sem Step atual ────────────────────────────────
  secao("EMI-001 — Tarefa aberta sem Step atual")
  {
    const f = await montarBase("001")
    let exec = await rodar("EMI-001")
    ok("baseline limpo: Tarefa com Step atual não dispara achado", !temAchado(exec, `emi-tarefa-sem-step:${f.tarefaId}`))
    await prisma.tarefa.update({ where: { id: f.tarefaId }, data: { workflowStepInstanceId: null } })
    exec = await rodar("EMI-001")
    ok("detecta Tarefa não-terminal com workflowStepInstanceId nulo", temAchado(exec, `emi-tarefa-sem-step:${f.tarefaId}`))
  }

  // ── EMI-002 — Tarefa com múltiplos Steps atuais ───────────────────────────
  secao("EMI-002 — Tarefa com múltiplos Steps atuais")
  {
    const f = await montarBase("002")
    let exec = await rodar("EMI-002")
    ok("baseline limpo: só um Step ativo na cadeia", !temAchado(exec, `emi-steps-concorrentes:${f.tarefaId}`))
    await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: f.workflowInstanceId, processoId: f.processoId, faseMacroKey: PHASE_KEY,
        stepKey: "conferir_certidao_dup", ordem: 4, tipo: "HUMANO", obrigatorio: true,
        documentoId: f.documentoId, necessidadeId: f.necessidadeId, status: "EM_ANDAMENTO",
        chaveIdempotencia: `${MARCA}-step-dup-002`,
      },
    })
    exec = await rodar("EMI-002")
    ok("detecta dois Steps não-terminais na mesma cadeia da Tarefa", temAchado(exec, `emi-steps-concorrentes:${f.tarefaId}`))
  }

  // ── EMI-003 — Step atual de outra Tarefa/processo ─────────────────────────
  secao("EMI-003 — Step atual de outra Tarefa/processo")
  {
    const f = await montarBase("003a")
    const outro = await montarBase("003b")
    let exec = await rodar("EMI-003")
    ok("baseline limpo: Step atual pertence à própria cadeia", !temAchado(exec, `emi-step-atual-de-outra-tarefa:${f.tarefaId}`) && !temAchado(exec, `emi-step-de-outra-tarefa:${f.tarefaId}`))
    // `outro.stepIds[4]` já está reivindicado pela Tarefa não-terminal do
    // próprio `outro` (índice parcial `Tarefa_uma_viva_por_etapa`) — usamos um
    // Step já CONCLUIDO do outro processo, livre do índice, mas ainda assim
    // de OUTRO processo (o que EMI-003 verifica).
    await prisma.tarefa.update({ where: { id: f.tarefaId }, data: { workflowStepInstanceId: outro.stepIds[0] } })
    exec = await rodar("EMI-003")
    ok("detecta Step atual pertencente a outro processo", temAchado(exec, `emi-step-de-outra-tarefa:${f.tarefaId}`))
  }

  // ── EMI-004 — Espera obrigatória sem follow-up ────────────────────────────
  secao("EMI-004 — Espera obrigatória sem follow-up")
  {
    const f = await montarBase("004")
    await prisma.tarefa.update({ where: { id: f.tarefaId }, data: { statusTarefa: "AGUARDANDO_TERCEIRO" } })
    const futuro = new Date(Date.now() + 7 * 86400000)
    const sol = await prisma.solicitacaoDocumento.create({
      data: {
        documentoId: f.documentoId, processoId: f.processoId, pessoaId: f.pessoaId, faseMacroKey: PHASE_KEY,
        tarefaId: f.tarefaId, canal: "EMAIL", dataEnvio: new Date(), previsaoRetorno: futuro,
        status: "AGUARDANDO_PROTOCOLO", chaveIdempotencia: `${MARCA}-sol-004`,
      },
      select: { id: true },
    })
    let exec = await rodar("EMI-004")
    ok("baseline limpo: espera com previsão de retorno futura não dispara achado", !temAchado(exec, `emi-espera-sem-followup:${f.tarefaId}`))
    await prisma.solicitacaoDocumento.update({ where: { id: sol.id }, data: { previsaoRetorno: null } })
    exec = await rodar("EMI-004")
    ok("detecta espera obrigatória sem nenhum follow-up agendado", temAchado(exec, `emi-espera-sem-followup:${f.tarefaId}`))
  }

  // ── EMI-005 — Follow-up vencido ────────────────────────────────────────────
  secao("EMI-005 — Follow-up vencido")
  {
    const f = await montarBase("005")
    await prisma.tarefa.update({ where: { id: f.tarefaId }, data: { statusTarefa: "AGUARDANDO_TERCEIRO" } })
    const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    await prisma.phaseWorkflowStepInstance.update({
      where: { id: f.stepIds[4] }, data: { metadata: { operacao: { proximoAcompanhamento: amanha } } },
    })
    let exec = await rodar("EMI-005")
    ok("baseline limpo: acompanhamento futuro não dispara achado", !temAchado(exec, `emi-followup-vencido:${f.tarefaId}`))
    const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    await prisma.phaseWorkflowStepInstance.update({
      where: { id: f.stepIds[4] }, data: { metadata: { operacao: { proximoAcompanhamento: ontem } } },
    })
    exec = await rodar("EMI-005")
    ok("detecta follow-up (próximo acompanhamento) vencido", temAchado(exec, `emi-followup-vencido:${f.tarefaId}`))
  }

  // ── EMI-006 — Retorno recebido ainda classificado como espera ────────────
  secao("EMI-006 — Retorno recebido ainda classificado como espera")
  {
    const f = await montarBase("006")
    await prisma.tarefa.update({ where: { id: f.tarefaId }, data: { statusTarefa: "AGUARDANDO_TERCEIRO" } })
    const sol = await prisma.solicitacaoDocumento.create({
      data: {
        documentoId: f.documentoId, processoId: f.processoId, pessoaId: f.pessoaId, faseMacroKey: PHASE_KEY,
        tarefaId: f.tarefaId, canal: "EMAIL", dataEnvio: new Date(), status: "PROTOCOLADA",
        chaveIdempotencia: `${MARCA}-sol-006`,
      },
      select: { id: true },
    })
    let exec = await rodar("EMI-006")
    ok("baseline limpo: solicitação ainda PROTOCOLADA não dispara achado", !temAchado(exec, `emi-retorno-sem-acao:${f.tarefaId}`))
    await prisma.solicitacaoDocumento.update({ where: { id: sol.id }, data: { status: "RESPONDIDA" } })
    exec = await rodar("EMI-006")
    ok("detecta retorno RESPONDIDA com Tarefa ainda em espera", temAchado(exec, `emi-retorno-sem-acao:${f.tarefaId}`))
  }

  // ── EMI-007 — Tarefa duplicada para a mesma obrigação ─────────────────────
  secao("EMI-007 — Tarefa duplicada para a mesma obrigação")
  {
    const f = await montarBase("007")
    let exec = await rodar("EMI-007")
    ok("baseline limpo: uma única Tarefa ativa para a necessidade", !temAchado(exec, `emi-tarefa-duplicada-necessidade:${f.necessidadeId}`))
    await prisma.tarefa.create({
      data: {
        titulo: `${MARCA} 007-dup`, processoId: f.processoId, tipo: "NORMAL", faseMacroKey: PHASE_KEY,
        necessidadeId: f.necessidadeId, statusTarefa: "EM_ANDAMENTO", concluida: false,
        chaveIdempotencia: `${MARCA}-tarefa-007-dup`,
      },
    })
    exec = await rodar("EMI-007")
    ok("detecta duas Tarefas ativas para a mesma necessidade", temAchado(exec, `emi-tarefa-duplicada-necessidade:${f.necessidadeId}`))
  }

  // ── EMI-008 — Necessidade satisfeita sem documento válido ─────────────────
  secao("EMI-008 — Necessidade satisfeita sem documento válido")
  {
    const f = await montarBase("008")
    await prisma.documento.update({ where: { id: f.documentoId }, data: { status: "RECEBIDO" } })
    await prisma.necessidadeDocumental.update({ where: { id: f.necessidadeId }, data: { status: "ATENDIDA" } })
    let exec = await rodar("EMI-008")
    ok("baseline limpo: necessidade ATENDIDA com documento válido não dispara achado", !temAchado(exec, `emi-necessidade-sem-doc-valido:${f.necessidadeId}`))
    await prisma.documento.update({ where: { id: f.documentoId }, data: { status: "CANCELADO" } })
    exec = await rodar("EMI-008")
    ok("detecta necessidade ATENDIDA sem nenhum documento válido", temAchado(exec, `emi-necessidade-sem-doc-valido:${f.necessidadeId}`))
  }

  // ── EMI-009 — Documento sem necessidade quando exigida ────────────────────
  secao("EMI-009 — Documento sem necessidade quando exigida")
  {
    const f = await montarBase("009")
    let exec = await rodar("EMI-009")
    ok("baseline limpo: documento com necessidade vinculada não dispara achado", !temAchado(exec, `emi-documento-sem-necessidade:${f.documentoId}`))
    await prisma.documento.update({ where: { id: f.documentoId }, data: { necessidadeId: null } })
    exec = await rodar("EMI-009")
    ok("detecta documento da Emissão Documental sem necessidade vinculada", temAchado(exec, `emi-documento-sem-necessidade:${f.documentoId}`))
  }

  // ── EMI-010 — Documento validado sem arquivo/versão ───────────────────────
  secao("EMI-010 — Documento validado sem arquivo/versão")
  {
    const f = await montarBase("010")
    await prisma.documento.update({ where: { id: f.documentoId }, data: { status: "RECEBIDO" } })
    const arq = await prisma.documentoArquivo.create({
      data: { documentoId: f.documentoId, tipo: "DOCUMENTO_RECEBIDO", url: "https://exemplo.local/x.pdf", nome: "x.pdf" },
      select: { id: true },
    })
    let exec = await rodar("EMI-010")
    ok("baseline limpo: documento RECEBIDO com arquivo não dispara achado", !temAchado(exec, `emi-documento-sem-arquivo:${f.documentoId}`))
    await prisma.documentoArquivo.delete({ where: { id: arq.id } })
    exec = await rodar("EMI-010")
    ok("detecta documento em estágio avançado sem nenhum arquivo", temAchado(exec, `emi-documento-sem-arquivo:${f.documentoId}`))
  }

  // ── EMI-011 — Versão marcada atual e rejeitada simultaneamente ───────────
  secao("EMI-011 — Versão marcada atual e rejeitada simultaneamente")
  {
    const f = await montarBase("011")
    let exec = await rodar("EMI-011")
    ok("baseline limpo: documento pendente sem via derivada não dispara achado", !temAchado(exec, `emi-vigente-e-invalidado:${f.documentoId}`))
    await prisma.documento.update({ where: { id: f.documentoId }, data: { status: "INVALIDO" } })
    await prisma.documento.create({
      data: {
        pessoaId: f.pessoaId, necessidadeId: f.necessidadeId, derivadoDeId: f.documentoId, derivacaoTipo: "NOVA_VIA",
        tipo: "CERTIDAO_NASCIMENTO", status: "PENDENTE",
      },
    })
    exec = await rodar("EMI-011")
    ok("detecta documento INVALIDO ainda marcado como vigente com via já derivada", temAchado(exec, `emi-vigente-e-invalidado:${f.documentoId}`))
  }

  // ── EMI-012 — Ownership divergente (Tarefa × Step atual) ──────────────────
  secao("EMI-012 — Ownership divergente entre Tarefa e Step atual")
  {
    const f = await montarBase("012")
    let exec = await rodar("EMI-012")
    ok("baseline limpo: Tarefa e Step atual com o mesmo responsável não dispara achado", !temAchado(exec, `emi-ownership-divergente:${f.tarefaId}`))
    const outroUsuario = await usuario("012b")
    await prisma.phaseWorkflowStepInstance.update({ where: { id: f.stepIds[4] }, data: { responsavelId: outroUsuario.id } })
    exec = await rodar("EMI-012")
    ok("detecta responsável divergente entre Tarefa e Step atual", temAchado(exec, `emi-ownership-divergente:${f.tarefaId}`))
  }

  // ── EMI-013 — Tarefa concluída com Step final inválido ────────────────────
  secao("EMI-013 — Tarefa concluída com Step final inválido")
  {
    const f = await montarBase("013")
    await prisma.phaseWorkflowStepInstance.update({ where: { id: f.stepIds[4] }, data: { status: "CONCLUIDO" } })
    await prisma.tarefa.update({ where: { id: f.tarefaId }, data: { statusTarefa: "CONCLUIDO_RECEBIDO" } })
    let exec = await rodar("EMI-013")
    ok("baseline limpo: Tarefa concluída com o último passo (validar_certidao) CONCLUIDO não dispara achado", !temAchado(exec, `emi-concluida-sem-ultimo-passo:${f.tarefaId}`))
    await prisma.phaseWorkflowStepInstance.update({ where: { id: f.stepIds[4] }, data: { status: "DISPONIVEL" } })
    exec = await rodar("EMI-013")
    ok("detecta Tarefa concluída sem o último passo publicado ter sido CONCLUIDO", temAchado(exec, `emi-concluida-sem-ultimo-passo:${f.tarefaId}`))
  }

  // ── EMI-014 — CANCELADA contada como CONCLUÍDA ────────────────────────────
  secao("EMI-014 — CANCELADA contada como CONCLUÍDA")
  {
    const f = await montarBase("014")
    await prisma.tarefa.update({ where: { id: f.tarefaId }, data: { statusTarefa: "CANCELADA", concluida: false } })
    let exec = await rodar("EMI-014")
    ok("baseline limpo: CANCELADA com concluida=false não dispara achado", !temAchado(exec, `emi-cancelada-concluida:${f.tarefaId}`))
    await prisma.tarefa.update({ where: { id: f.tarefaId }, data: { concluida: true } })
    exec = await rodar("EMI-014")
    ok("detecta Tarefa CANCELADA marcada como concluída", temAchado(exec, `emi-cancelada-concluida:${f.tarefaId}`))
  }

  // ── EMI-015 — Configuração publicada inexistente ──────────────────────────
  secao("EMI-015 — Instância aponta para workflow publicado inexistente")
  {
    const f = await montarBase("015")
    let exec = await rodar("EMI-015")
    ok("baseline limpo: instância aponta para workflow existente", !temAchado(exec, `emi-instancia-sem-definicao:${f.workflowInstanceId}`))
    await prisma.phaseWorkflowInstance.update({ where: { id: f.workflowInstanceId }, data: { workflowDefinitionId: 999999999 } })
    exec = await rodar("EMI-015")
    ok("detecta instância apontando para workflow removido/inexistente", temAchado(exec, `emi-instancia-sem-definicao:${f.workflowInstanceId}`))
  }

  // ── EMI-016 — Operação apontando para configuração removida (Step) ───────
  secao("EMI-016 — Step em execução aponta para definição removida")
  {
    const f = await montarBase("016")
    let exec = await rodar("EMI-016")
    ok("baseline limpo: Step aponta para definição existente", !temAchado(exec, `emi-step-sem-definicao:${f.stepIds[4]}`))
    await prisma.phaseWorkflowStepInstance.update({ where: { id: f.stepIds[4] }, data: { stepDefinitionId: 999999999 } })
    exec = await rodar("EMI-016")
    ok("detecta Step apontando para definição de passo removida", temAchado(exec, `emi-step-sem-definicao:${f.stepIds[4]}`))
  }

  // ── EMI-017 — Handoff sem ator válido ─────────────────────────────────────
  secao("EMI-017 — Handoff sem ator válido")
  {
    const f = await montarBase("017")
    let exec = await rodar("EMI-017")
    ok("baseline limpo: responsável existe como usuário", !temAchado(exec, `emi-responsavel-inexistente:${f.tarefaId}`))
    // A FK Tarefa.responsavelId → Usuario(id) ON DELETE SET NULL torna este
    // estado estruturalmente IMPOSSÍVEL por INSERT/UPDATE normal — a prova de
    // detecção exige simular corrupção de dado (restauração/SQL direto) via
    // `session_replication_role`, só no banco de TESTE local.
    await prisma.$executeRawUnsafe(`SET session_replication_role = replica`)
    try {
      await prisma.$executeRawUnsafe(`UPDATE "Tarefa" SET "responsavelId" = 999999999 WHERE id = ${f.tarefaId}`)
    } finally {
      await prisma.$executeRawUnsafe(`SET session_replication_role = DEFAULT`)
    }
    exec = await rodar("EMI-017")
    ok("detecta responsavelId apontando para Usuario inexistente (estado corrompido)", temAchado(exec, `emi-responsavel-inexistente:${f.tarefaId}`))
  }

  // ── EMI-018 — Histórico inconsistente ─────────────────────────────────────
  secao("EMI-018 — Histórico de eventos inconsistente")
  {
    const f = await montarBase("018")
    // PASSO_INSTANCIADO é o predecessor exigido — não PASSO_INICIADO (o
    // primeiro passo de uma cadeia SEQUENCIAL pode concluir direto, sem
    // nunca passar por EM_ANDAMENTO; confirmado com dado real de produção).
    await prisma.workflowEvento.create({
      data: { tipo: "PASSO_INSTANCIADO", entityType: "step_instance", entityId: f.stepIds[4], processoId: f.processoId, stepInstanceId: f.stepIds[4], chaveIdempotencia: `${MARCA}-evt-018-instanciado` },
    })
    await prisma.workflowEvento.create({
      data: { tipo: "PASSO_CONCLUIDO", entityType: "step_instance", entityId: f.stepIds[4], processoId: f.processoId, stepInstanceId: f.stepIds[4], chaveIdempotencia: `${MARCA}-evt-018-fim` },
    })
    await prisma.workflowEvento.create({
      data: { tipo: "TAREFA_GERADA", entityType: "tarefa", entityId: f.tarefaId, processoId: f.processoId, tarefaId: f.tarefaId, chaveIdempotencia: `${MARCA}-evt-018-gerada1` },
    })
    let exec = await rodar("EMI-018")
    ok("baseline limpo: PASSO_INSTANCIADO antes de PASSO_CONCLUIDO, um só TAREFA_GERADA — sem achado", exec.achados.length === 0 || (!temAchado(exec, `emi-tarefa-gerada-duplicada:${f.tarefaId}`)))

    const evtOrfao = await prisma.workflowEvento.create({
      data: { tipo: "PASSO_CONCLUIDO", entityType: "step_instance", entityId: f.stepIds[3], processoId: f.processoId, stepInstanceId: f.stepIds[3], chaveIdempotencia: `${MARCA}-evt-018-orfao` },
      select: { id: true },
    })
    await prisma.workflowEvento.create({
      data: { tipo: "TAREFA_GERADA", entityType: "tarefa", entityId: f.tarefaId, processoId: f.processoId, tarefaId: f.tarefaId, chaveIdempotencia: `${MARCA}-evt-018-gerada2` },
    })
    exec = await rodar("EMI-018")
    ok("detecta PASSO_CONCLUIDO sem PASSO_INSTANCIADO anterior", temAchado(exec, `emi-passo-concluido-sem-inicio:${evtOrfao.id}`))
    ok("detecta mais de um TAREFA_GERADA para a mesma Tarefa", temAchado(exec, `emi-tarefa-gerada-duplicada:${f.tarefaId}`))
  }

  // ── EMI-019 — Documento invalidado ainda satisfazendo necessidade ────────
  secao("EMI-019 — Documento invalidado ainda satisfazendo necessidade (bug já corrigido em invalidarDocumento)")
  {
    const f = await montarBase("019")
    await prisma.documento.update({ where: { id: f.documentoId }, data: { status: "RECEBIDO" } })
    await prisma.necessidadeDocumental.update({ where: { id: f.necessidadeId }, data: { status: "ATENDIDA" } })
    let exec = await rodar("EMI-019")
    ok("baseline limpo: necessidade ATENDIDA com documento válido (não invalidado) não dispara achado", !temAchado(exec, `emi-doc-invalido-ainda-satisfaz:${f.documentoId}`))
    await prisma.documento.update({ where: { id: f.documentoId }, data: { status: "INVALIDO" } })
    exec = await rodar("EMI-019")
    ok("detecta documento INVALIDO cuja necessidade continua ATENDIDA (o bug corrigido em invalidarDocumento)", temAchado(exec, `emi-doc-invalido-ainda-satisfaz:${f.documentoId}`))
  }

  // ── EMI-020 — Projeção divergente (Tarefa × Documento legado) ─────────────
  secao("EMI-020 — Projeção divergente entre Tarefa e campo legado do Documento")
  {
    const f = await montarBase("020")
    await prisma.documento.update({ where: { id: f.documentoId }, data: { responsavelId: f.responsavelId } })
    let exec = await rodar("EMI-020")
    ok("baseline limpo: Tarefa e Documento (legado) com o mesmo responsável não dispara achado", !temAchado(exec, `emi-projecao-divergente:${f.tarefaId}`))
    const outroUsuario = await usuario("020b")
    await prisma.documento.update({ where: { id: f.documentoId }, data: { responsavelId: outroUsuario.id } })
    exec = await rodar("EMI-020")
    ok("detecta responsável divergente entre Tarefa (canônico) e Documento (campo legado)", temAchado(exec, `emi-projecao-divergente:${f.tarefaId}`))
  }

  // ── Catálogo: as 20 verificações existem, são únicas e cobrem os domínios certos ──
  secao("Catálogo")
  {
    const { catalogo } = await import("../lib/saude/catalogo")
    const codigos = Array.from({ length: 20 }, (_, i) => `EMI-${String(i + 1).padStart(3, "0")}`)
    const todas = catalogo()
    for (const c of codigos) {
      ok(`${c} está declarado no catálogo`, todas.some((v) => v.codigo === c))
    }
    ok("nenhum código EMI duplicado", new Set(todas.filter((v) => v.codigo.startsWith("EMI-")).map((v) => v.codigo)).size === 20)
  }

  await limpar()

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
  console.log("Verificador de integridade da Emissão Documental: validado ✅")
}

main().catch(async (e) => {
  console.error(e)
  try { await limpar() } catch { /* melhor esforço — não mascarar o erro original */ }
  process.exit(1)
})
