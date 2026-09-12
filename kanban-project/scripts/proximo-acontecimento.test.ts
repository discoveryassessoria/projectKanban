// scripts/proximo-acontecimento.test.ts
// ============================================================================
// PRÓXIMO ACONTECIMENTO ESPERADO — os 12 casos da Etapa 3.
// Rodar: npx tsx scripts/proximo-acontecimento.test.ts   (banco de TESTE p/ parte B)
//
// PARTE A (casos 1-8): puros, sem banco — chamam `computarProximoAcontecimento`
// direto, do mesmo jeito que `estadoTemporal`/`sla-core.ts` já são testados.
// PARTE B (casos 9-12): de ponta a ponta, com banco de teste real, usando as
// PORTAS CANÔNICAS (atribuirTarefa, aguardarTerceiro, concluirEtapa) — nunca
// escrita direta.
// ============================================================================
import { computarProximoAcontecimento, estadosTemporaisDasOperacoes, type EntradaOperacao } from "@/lib/operacional/proximo-acontecimento"
import { ANDAMENTO_VAZIO, type AndamentoEtapa } from "@/src/lib/process-stage/andamento-etapa"
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"
import { atribuirTarefa } from "@/lib/operacional/tarefa-comandos"
import { aguardarTerceiro, retomarDeEspera } from "@/lib/operacional/tarefa-ciclo"
import { concluirEtapa } from "@/lib/operacional/tarefa-etapa"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const AGORA = new Date("2026-09-20T12:00:00.000Z")
const dias = (n: number) => new Date(AGORA.getTime() + n * 86400000)
const andamento = (parcial: Partial<AndamentoEtapa>): AndamentoEtapa => ({ ...ANDAMENTO_VAZIO, ...parcial })

const base = (parcial: Partial<EntradaOperacao>): EntradaOperacao => ({
  tarefaId: 1,
  statusTarefa: "EM_ANDAMENTO",
  dataPrazo: null,
  dataConclusao: null,
  dataInicio: dias(-10),
  slaPausadoEm: null,
  slaPausaAcumuladaMin: 0,
  responsavelId: 42,
  createdAt: dias(-10),
  agora: AGORA,
  passo: null,
  solicitacao: null,
  ...parcial,
})

async function main() {
  secao("PARTE A — núcleo puro (sem banco)")

  secao("CASO 1 — Tarefa interna com SLA/prazo futuro → próxima ação correta")
  {
    const r = computarProximoAcontecimento(base({ dataPrazo: dias(5) }))
    ok("1) tipo=acao_interna", r.proximoAcontecimento.tipo === "acao_interna")
    ok("1) não em risco", !r.emRisco)
    ok("1) sem atraso interno", !r.atrasoInterno)
    ok("1) responsavelId propagado", r.proximoAcontecimento.responsavelId === 42)
  }

  secao("CASO 2 — Tarefa interna vencida → atraso interno")
  {
    const r = computarProximoAcontecimento(base({ dataPrazo: dias(-3) }))
    ok("2) atrasoInterno=true", r.atrasoInterno === true)
    ok("2) tipo continua acao_interna (a fonte não muda)", r.proximoAcontecimento.tipo === "acao_interna")
    ok("2) atraso simples NÃO é, sozinho, EM_RISCO", !r.emRisco)
  }

  secao("CASO 3 — AGUARDANDO_TERCEIRO com previsão futura + acompanhamento futuro → aguardando, sem atraso interno")
  {
    const r = computarProximoAcontecimento(base({
      statusTarefa: "AGUARDANDO_TERCEIRO",
      dataPrazo: dias(-10), // venceria se fosse tarefa normal
      passo: { prazo: null, startedAt: dias(-10), andamento: andamento({ previsaoRetorno: iso(dias(10)), proximoAcompanhamento: iso(dias(5)), destinatario: "Cartório X" }), ultimoContatoResultado: null },
    }))
    ok("3) sem atraso interno mesmo com dataPrazo vencido", r.atrasoInterno === false)
    ok("3) sem atraso de terceiro (previsão no futuro)", r.atrasoTerceiro === false)
    ok("3) aguardandoTerceiro=true", r.proximoAcontecimento.aguardandoTerceiro === true)
    ok("3) escolhe o acompanhamento (mais próximo: 5d < 10d)", r.proximoAcontecimento.tipo === "aguardando_terceiro_acompanhamento")
    ok("3) não em risco", !r.emRisco)
  }

  secao("CASO 4 — Terceiro atrasado, mas acompanhamento feito corretamente → atraso do terceiro, NÃO da Daniela")
  {
    const r = computarProximoAcontecimento(base({
      statusTarefa: "AGUARDANDO_TERCEIRO",
      passo: { prazo: null, startedAt: dias(-20), andamento: andamento({ previsaoRetorno: iso(dias(-5)), proximoAcompanhamento: iso(dias(2)), destinatario: "Cartório Y" }), ultimoContatoResultado: null },
    }))
    ok("4) atrasoTerceiro=true", r.atrasoTerceiro === true)
    ok("4) atrasoInterno=false (nunca vira atraso da Daniela)", r.atrasoInterno === false)
    ok("4) próximo acontecimento é o acompanhamento futuro, não a previsão vencida", r.proximoAcontecimento.tipo === "aguardando_terceiro_acompanhamento")
    // `proximoAcompanhamento` é uma data (YYYY-MM-DD), reconstruída à meia-noite
    // UTC pelo núcleo — comparar contra o MESMO arredondamento, não contra o
    // instante exato de `dias(2)` (que carrega a hora de `AGORA`).
    ok("4) data do próximo acontecimento é a do acompanhamento (+2d)", r.proximoAcontecimento.data === iso2(dias(2)))
  }

  secao("CASO 5 — Próximo acompanhamento vencido → ação necessária/acompanhamento atrasado")
  {
    const r = computarProximoAcontecimento(base({
      statusTarefa: "AGUARDANDO_TERCEIRO",
      passo: { prazo: null, startedAt: dias(-20), andamento: andamento({ proximoAcompanhamento: iso(dias(-2)), destinatario: "Consulado Z" }), ultimoContatoResultado: null },
    }))
    ok("5) acompanhamentoVencido=true", r.acompanhamentoVencido === true)
    ok("5) motivo de risco registrado", r.motivosRisco.includes("ACOMPANHAMENTO_VENCIDO"))
    ok("5) EM_RISCO", r.emRisco === true)
  }

  secao("CASO 6 — Retorno recebido antes do acompanhamento → ação interna necessária imediatamente")
  {
    const r = computarProximoAcontecimento(base({
      statusTarefa: "AGUARDANDO_TERCEIRO",
      passo: {
        prazo: null, startedAt: dias(-20),
        andamento: andamento({ proximoAcompanhamento: iso(dias(10)) }), // acompanhamento ainda distante
        ultimoContatoResultado: "RETORNO_RECEBIDO", // mas o retorno já chegou
      },
    }))
    ok("6) tipo=retorno_recebido (não espera o acompanhamento agendado)", r.proximoAcontecimento.tipo === "retorno_recebido")
    ok("6) EM_RISCO (retorno sem ação interna correspondente ainda)", r.emRisco === true)
    ok("6) motivo específico registrado", r.motivosRisco.some((m) => m.startsWith("RETORNO_SEM_ACAO_INTERNA")))
  }

  secao("CASO 7 — dataPrazo=null mas com outro próximo acontecimento determinável → NÃO EM_RISCO")
  {
    const r = computarProximoAcontecimento(base({
      dataPrazo: null,
      passo: { prazo: null, startedAt: dias(-5), andamento: andamento({ proximoAcompanhamento: iso(dias(3)) }), ultimoContatoResultado: null },
    }))
    ok("7) tipo=acompanhamento (fonte alternativa usada)", r.proximoAcontecimento.tipo === "acompanhamento")
    ok("7) NÃO em risco", r.emRisco === false)
  }

  secao("CASO 8 — sem prazo, sem acompanhamento, sem previsão, sem evento → EM_RISCO")
  {
    const r = computarProximoAcontecimento(base({ dataPrazo: null }))
    ok("8) tipo=em_risco", r.proximoAcontecimento.tipo === "em_risco")
    ok("8) EM_RISCO", r.emRisco === true)
    ok("8) motivo correto", r.motivosRisco.includes("SEM_PROXIMO_ACONTECIMENTO_DETERMINAVEL"))
    ok("8) nenhuma data inventada", r.proximoAcontecimento.data === null)
  }

  secao("(extra) conflito real entre Tarefa.dataPrazo e PhaseWorkflowStepInstance.prazo → EM_RISCO, sem escolher uma")
  {
    const r = computarProximoAcontecimento(base({
      dataPrazo: dias(5),
      passo: { prazo: dias(15), startedAt: dias(-5), andamento: ANDAMENTO_VAZIO, ultimoContatoResultado: null },
    }))
    ok("(extra) as duas dimensões continuam expostas, nenhuma sobrescrita", r.prazoOperacao === dias(5).toISOString() && r.slaPassoAtual === dias(15).toISOString())
    ok("(extra) conflito registrado como risco", r.motivosRisco.some((m) => m.startsWith("CONFLITO_PRAZO_TAREFA_PASSO")))
    ok("(extra) EM_RISCO", r.emRisco === true)
  }

  secao("(extra) passo executável sem responsável → EM_RISCO")
  {
    const r = computarProximoAcontecimento(base({ dataPrazo: dias(5), responsavelId: null }))
    ok("(extra) motivo SEM_RESPONSAVEL registrado", r.motivosRisco.includes("SEM_RESPONSAVEL_PARA_PROXIMA_ACAO"))
    ok("(extra) EM_RISCO mesmo com prazo determinável", r.emRisco === true)
  }

  secao("(extra) tarefa encerrada nunca é EM_RISCO, mesmo sem nenhuma fonte")
  {
    const r = computarProximoAcontecimento(base({ statusTarefa: "CONCLUIDO_RECEBIDO", dataConclusao: dias(-1), dataPrazo: null, responsavelId: null }))
    ok("(extra) encerrada não é risco", r.emRisco === false)
    ok("(extra) tipo=encerrada", r.proximoAcontecimento.tipo === "encerrada")
  }

  secao("PARTE B — integração com banco de teste real (portas canônicas)")
  await exigirBancoDeTeste()
  await limparB()
  const p = await palcoB()

  secao("CASO 9 — Reatribuição não reinicia prazo/SLA")
  {
    const antes = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { dataPrazo: true, slaPausaAcumuladaMin: true } })
    const outraPessoa = await prisma.usuario.create({ data: { nome: "Juliana Teste", email: `juliana-${p.processoId}@procacont.test`, senha: "x", tipo: "assistente" }, select: { id: true } })
    const r = await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: outraPessoa.id, autorId: p.autorId })
    ok("9) transferência ok", r.ok === true)
    const depois = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { dataPrazo: true, slaPausaAcumuladaMin: true, responsavelId: true } })
    ok("9) dataPrazo preservado", depois.dataPrazo?.getTime() === antes.dataPrazo?.getTime())
    ok("9) slaPausaAcumuladaMin preservado", depois.slaPausaAcumuladaMin === antes.slaPausaAcumuladaMin)
    ok("9) responsável mudou de fato", depois.responsavelId === outraPessoa.id)
    // reatribuição durante AGUARDANDO_TERCEIRO não reinicia relógios
    const esp = await aguardarTerceiro({ tarefaId: p.tarefaId, autorId: p.autorId, motivo: "aguardando cartório (teste)" })
    ok("9) entrou em espera", esp.ok === true)
    const voltaPessoa = await prisma.usuario.findUniqueOrThrow({ where: { id: p.danielaId }, select: { id: true } })
    const antesEspera = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { dataPrazo: true, slaPausadoEm: true, statusTarefa: true } })
    const rTransfEspera = await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: voltaPessoa.id, autorId: p.autorId })
    ok("9) transferir DURANTE aguardando terceiro funciona", rTransfEspera.ok === true)
    const depoisEspera = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { dataPrazo: true, slaPausadoEm: true, statusTarefa: true } })
    ok("9) status de espera preservado pela reatribuição", depoisEspera.statusTarefa === antesEspera.statusTarefa)
    ok("9) slaPausadoEm preservado pela reatribuição", depoisEspera.slaPausadoEm?.getTime() === antesEspera.slaPausadoEm?.getTime())
    ok("9) dataPrazo preservado pela reatribuição", depoisEspera.dataPrazo?.getTime() === antesEspera.dataPrazo?.getTime())
    await retomarDeEspera({ tarefaId: p.tarefaId, autorId: p.autorId, motivo: "retorno (teste)" })
  }

  secao("CASO 10 — Avançar passo não apaga próximo acompanhamento do passo anterior")
  {
    const stepAntes = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.stepIds[0] }, select: { metadata: true } })
    const opAntes = (stepAntes.metadata as any)?.operacao ?? null
    ok("10) passo 1 tinha acompanhamento gravado antes de concluir", opAntes?.proximoAcompanhamento != null)
    const rConcl = await concluirEtapa({ tarefaId: p.tarefaId, autorId: p.autorId })
    ok("10) concluir o passo 1 funcionou", rConcl.ok === true)
    const stepDepois = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.stepIds[0] }, select: { metadata: true } })
    const opDepois = (stepDepois.metadata as any)?.operacao ?? null
    ok("10) metadata.operacao do passo concluído NÃO foi apagada", opDepois?.proximoAcompanhamento === opAntes?.proximoAcompanhamento)
  }

  secao("CASO 11 — Retry/reconciliação não duplica acompanhamento/prazo/histórico/evento")
  {
    const logsAntes = await prisma.logAuditoria.count({ where: { entidade: "Tarefa", entidadeId: p.tarefaId } })
    const rRetry = await concluirEtapa({ tarefaId: p.tarefaId, etapaId: p.stepIds[0], autorId: p.autorId })
    ok("11) retry da mesma conclusão responde ok", rRetry.ok === true)
    if (rRetry.ok) ok("11) retry reconhece idempotência", rRetry.jaEstavaConcluida === true)
    const logsDepois = await prisma.logAuditoria.count({ where: { entidade: "Tarefa", entidadeId: p.tarefaId } })
    ok("11) nenhum log novo no retry", logsDepois === logsAntes)
    const estados = await estadosTemporaisDasOperacoes(prisma, [p.tarefaId], AGORA)
    ok("11) leitura canônica não quebra após retry", estados.has(p.tarefaId))
  }

  secao("CASO 12 — Registro legado inconsistente fica EM_RISCO, sem dado inventado")
  {
    // Tarefa real, sem workflow, sem prazo, sem responsável — o pior caso plausível de dado legado.
    const legado = await prisma.tarefa.create({
      data: {
        titulo: "PROCACONT legado inconsistente", processoId: p.processoId,
        statusTarefa: "NAO_INICIADA", origem: "MANUAL",
        chaveIdempotencia: `PROCACONT-legado-${p.processoId}`,
      },
      select: { id: true },
    })
    const estados = await estadosTemporaisDasOperacoes(prisma, [legado.id], AGORA)
    const r = estados.get(legado.id)!
    ok("12) EM_RISCO, não inventa data", r.emRisco === true && r.proximoAcontecimento.data === null)
    ok("12) motivo correto (sem fonte, não sem responsável mascarando)", r.motivosRisco.includes("SEM_PROXIMO_ACONTECIMENTO_DETERMINAVEL"))
    await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: legado.id } })
    await prisma.tarefa.delete({ where: { id: legado.id } })
  }

  await limparB()
  console.log(`\n${"═".repeat(72)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhou > 0) { console.log("Falhas:", falhas.join(", ")); process.exit(1) }
  console.log("12 casos — próximo acontecimento esperado, determinístico ou EM_RISCO, nunca inventado.")
}

function iso(d: Date): string { return d.toISOString().slice(0, 10) }
/** O mesmo arredondamento que o núcleo faz ao reconstruir `previsaoEfetiva`/`proximoAcompanhamento` (YYYY-MM-DD → meia-noite UTC). */
function iso2(d: Date): string { return new Date(`${iso(d)}T00:00:00.000Z`).toISOString() }

// ── palco da parte B ─────────────────────────────────────────────────────────
const MARCA = "PROCACONT"
const PASSOS = ["preparar", "aguardar_retorno", "concluir"]

async function limparB() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  const ids = procs.map((p) => p.id)
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefaId: { in: ts.map((t) => t.id) } } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: ts.map((t) => t.id) } } })
  await prisma.solicitacaoDocumento.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@procacont.test" } } })
}

async function palcoB() {
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} unico` }, select: { id: true } })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "procacont_teste", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-i-${proc.id}` },
    select: { id: true },
  })
  const daniela = await prisma.usuario.create({ data: { nome: "Daniela Teste", email: `daniela-${proc.id}@procacont.test`, senha: "x", tipo: "assistente" }, select: { id: true } })
  const autor = await prisma.usuario.create({ data: { nome: "Gestor Teste", email: `gestor-${proc.id}@procacont.test`, senha: "x", tipo: "admin" }, select: { id: true } })

  const stepIds: number[] = []
  for (const [i, key] of PASSOS.entries()) {
    const s = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "procacont_teste", stepKey: `${key}_${proc.id}`,
        ordem: i + 1, tipo: "HUMANO", obrigatorio: true, status: i === 0 ? "DISPONIVEL" : "PENDENTE",
        necessidadeId: null, documentoId: null,
        dependeDeStepKeys: i > 0 ? [`${PASSOS[i - 1]}_${proc.id}`] : [],
        metadata: i === 0 ? { operacao: { proximoAcompanhamento: iso(dias(3)), destinatario: "Cartório Teste" } } : undefined,
        chaveIdempotencia: `${MARCA}-s-${proc.id}-${i}`,
      }, select: { id: true },
    })
    stepIds.push(s.id)
  }
  const g = await garantirTarefaDePasso({ stepInstanceId: stepIds[0] })
  if (!g.success) throw new Error(`palco B: materialização falhou — ${JSON.stringify(g)}`)
  await prisma.tarefa.update({ where: { id: g.tarefa.id }, data: { dataPrazo: dias(20) } })
  const atrib = await atribuirTarefa({ tarefaId: g.tarefa.id, responsavelId: daniela.id, autorId: autor.id })
  if (!atrib.ok) throw new Error(`palco B: atribuição falhou — ${JSON.stringify(atrib)}`)
  return { processoId: proc.id, instanciaId: inst.id, stepIds, tarefaId: g.tarefa.id, danielaId: daniela.id, autorId: autor.id }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
