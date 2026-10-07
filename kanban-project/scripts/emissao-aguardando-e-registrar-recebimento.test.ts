// scripts/emissao-aguardando-e-registrar-recebimento.test.ts
// ============================================================================
// OPERAÇÃO (07/10/2026) — "Aguardando o cartório" e "Registrar recebimento".
//   npx tsx scripts/emissao-aguardando-e-registrar-recebimento.test.ts   (banco de teste)
//
// Caso real (certidão de casamento do Juan): o pedido foi enviado, o recebimento não foi registrado e a certidão sumia de Aguardando e
// aparecia em Feito como "Concluída". Causa: as subtarefas da Emissão tinham virado opcionais e o passo se fechava ao concluir a 1ª.
// PROVA, com a Emissão de verdade em 4 subtarefas (enviar → confirmar → receber → validar):
//   • concluir a 1ª subtarefa NÃO fecha o passo nem a tarefa (as subtarefas são obrigatórias);
//   • pedido enviado + recebimento não registrado = Aguardando, SEM responsável, com a subtarefa corrente em qualquer estado;
//   • a linha traz a data do pedido e o lembrete de cobrança (prazo do passo, só lembrete);
//   • registrar recebimento ANTES e DEPOIS do prazo, pedido antigo, sem anexo, sem protocolo, com data passada: conclui a 2 e a 3,
//     libera a 4 com quem registrou como responsável, tira de Aguardando, escreve a frase clara no histórico;
//   • só quem fez o pedido, o responsável e o administrador registram; futura/duplicada/antes do envio são recusadas;
//   • só entra em Feito com os 4 passos concluídos.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("emissao-aguardando-e-registrar-recebimento.test.ts")

import { readFileSync } from "node:fs"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { minhaFila, concluidasRecentesDoUsuario } from "../lib/operacional/tarefa-projecoes"
import { concluirSubtarefaCorrentePeloPasso } from "../src/services/subtarefas-da-etapa"
import { registrarRecebimentoDaCertidao } from "../src/services/registrar-recebimento"
import { detectarViolacoesDeIntegridade } from "../lib/saude/verificacoes/integridade-invariantes"
import { aguardandoOCartorio, podeRegistrarRecebimento, textoDoRecebimento, dataDeRecebimento, rotuloDeEstado } from "../lib/operacional/emissao-recebimento"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "EMIREC"
const dia = 86_400_000

async function main() {
  const c = await montarCenario(MARCA, {
    slaDays: 10, regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS",
    subs: [
      { key: "enviar_requerimento_cartorio", label: "Enviar requerimento ao cartório", ordem: 1, espera: false, dependeDe: [] },
      { key: "receber_confirmacao_pedido", label: "Receber confirmação do pedido", ordem: 2, espera: true, dependeDe: ["enviar_requerimento_cartorio"], exigeProtocolo: true },
      { key: "receber_certidao", label: "Receber certidão", ordem: 3, espera: true, dependeDe: ["receber_confirmacao_pedido"] },
      { key: "conferir_validar_certidao", label: "Conferir e validar certidão", ordem: 4, espera: false, dependeDe: ["receber_certidao"] },
    ],
  })
  try {
    const mk = (n: string, tipo = "assistente") => prisma.usuario.create({ data: { nome: `${MARCA} ${n}`, email: `${MARCA.toLowerCase()}-${n.toLowerCase()}@t.com`, senha: "x", tipo, permissoesCustom: { "tarefas.ver": true, "tarefas.iniciar_concluir": true } } })
    const daniela = await mk("Daniela"), outra = await mk("Outra"), marco = await mk("Marco", "admin")

    const statusDe = async (stepInstanceId: number) => Object.fromEntries((await prisma.subtaskExecution.findMany({ where: { stepInstanceId, supersededAt: null }, select: { subtaskKey: true, status: true } })).map((e) => [e.subtaskKey, e.status]))
    const linhaDaEquipe = async (tarefaId: number) => (await minhaFila(null, new Date())).find((l) => l.taskId === tarefaId)
    const enviarPedido = async (stepInstanceId: number, porId: number) => concluirSubtarefaCorrentePeloPasso({ stepInstanceId, executadoPorId: porId, payload: {}, resultado: "enviado", subtarefaKeyEsperada: "enviar_requerimento_cartorio" })

    secao("1) As subtarefas continuam obrigatórias: concluir a 1ª NÃO fecha o passo (o defeito do caso real)")
    const o1 = await c.novaObrigacao({ responsavelId: null })
    const r1 = await enviarPedido(o1.stepInstanceId, daniela.id)
    ok("concluir o «Enviar requerimento» não libera o passo para concluir", r1.aplicavel === true && r1.podeConcluirPasso === false, JSON.stringify((r1 as { faltando?: unknown }).faltando ?? null).slice(0, 120))
    const passo1 = await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: o1.stepInstanceId }, select: { status: true } })
    const tarefa1 = await prisma.tarefa.findUnique({ where: { id: o1.tarefaId }, select: { statusTarefa: true, responsavelId: true } })
    ok("passo e tarefa continuam abertos", passo1?.status !== "CONCLUIDO" && !["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI"].includes(tarefa1?.statusTarefa ?? ""), `${passo1?.status} / ${tarefa1?.statusTarefa}`)

    secao("2) AGUARDANDO: pedido enviado e recebimento não registrado — sem responsável, vencido ou não")
    ok("a tarefa está SEM responsável", tarefa1?.responsavelId == null)
    const l1 = await linhaDaEquipe(o1.tarefaId)
    ok("aparece em Aguardando", l1?.estadoOperacao === "AGUARDANDO", l1?.estadoOperacao)
    ok("a linha traz a data do pedido", l1?.pedidoEnviadoEm instanceof Date)
    const esperado = l1?.pedidoEnviadoEm ? new Date(l1.pedidoEnviadoEm.getTime() + 10 * dia) : null
    ok("e o lembrete de cobrança (pedido + 10 dias úteis do passo — só lembrete)", !!l1?.lembreteDeCobrancaEm && !!esperado && l1.lembreteDeCobrancaEm.getTime() >= esperado.getTime() - dia, String(l1?.lembreteDeCobrancaEm?.toISOString()))
    ok("quem fez o pedido fica na linha (para a tela saber quem pode registrar)", l1?.pedidoPorId === daniela.id)
    // Qualquer estado da subtarefa corrente: a regra é o FATO (pedido enviado, recebimento não registrado).
    for (const estado of ["DISPONIVEL", "EM_ANDAMENTO", "BLOQUEADO", "AGUARDANDO_EXTERNO"]) {
      await prisma.subtaskExecution.updateMany({ where: { stepInstanceId: o1.stepInstanceId, subtaskKey: "receber_confirmacao_pedido", supersededAt: null }, data: { status: estado as never } })
      const l = await linhaDaEquipe(o1.tarefaId)
      ok(`subtarefa 2 «${estado}» → continua em Aguardando`, l?.estadoOperacao === "AGUARDANDO")
    }
    await prisma.subtaskExecution.updateMany({ where: { stepInstanceId: o1.stepInstanceId, subtaskKey: "receber_confirmacao_pedido", supersededAt: null }, data: { status: "AGUARDANDO_EXTERNO" } })
    // Vencida há tempo: continua listada.
    await prisma.tarefa.update({ where: { id: o1.tarefaId }, data: { dataPrazo: new Date(Date.now() - 30 * dia) } })
    ok("vencida também aparece", (await linhaDaEquipe(o1.tarefaId))?.estadoOperacao === "AGUARDANDO")
    const fila = await minhaFila(null, new Date())
    const aguard = fila.filter((l) => l.estadoOperacao === "AGUARDANDO").length
    ok("o número de Aguardando (lista) = quantas linhas estão em AGUARDANDO", aguard === fila.filter((l) => aguardandoOCartorio(undefined) || l.estadoOperacao === "AGUARDANDO").length && aguard >= 1)

    // QUEM FEZ O PEDIDO vê a certidão em Aguardando mesmo que ela tenha mudado de dono ou esteja sem responsável — e só em Aguardando.
    const daDaniela = await minhaFila(daniela.id, new Date())
    ok("quem fez o pedido (sem responsável na tarefa) a vê em Aguardando", daDaniela.some((l) => l.taskId === o1.tarefaId && l.estadoOperacao === "AGUARDANDO"))
    await prisma.tarefa.update({ where: { id: o1.tarefaId }, data: { responsavelId: outra.id } })
    ok("transferida a outra pessoa: quem fez o pedido continua vendo; a outra também", (await minhaFila(daniela.id, new Date())).some((l) => l.taskId === o1.tarefaId) && (await minhaFila(outra.id, new Date())).some((l) => l.taskId === o1.tarefaId))
    ok("uma terceira pessoa NÃO vê a certidão", !(await minhaFila(marco.id, new Date())).some((l) => l.taskId === o1.tarefaId))
    await prisma.tarefa.update({ where: { id: o1.tarefaId }, data: { responsavelId: null } })

    secao("3) REGISTRAR RECEBIMENTO — permissão e recusas")
    const semPermissao = await registrarRecebimentoDaCertidao({ tarefaId: o1.tarefaId, usuario: { userId: outra.id, tipo: "assistente" } })
    ok("quem não fez o pedido (nem é o responsável nem admin) é recusado", !semPermissao.ok && semPermissao.codigo === "SEM_PERMISSAO")
    const futura = await registrarRecebimentoDaCertidao({ tarefaId: o1.tarefaId, usuario: { userId: daniela.id, tipo: "assistente" }, recebidaEm: new Date(Date.now() + 5 * dia).toISOString().slice(0, 10) })
    ok("data futura é recusada", !futura.ok && futura.codigo === "DATA_INVALIDA")
    ok("nada mudou nas recusas", (await statusDe(o1.stepInstanceId)).receber_certidao !== "CONCLUIDO")
    const antes = await c.novaObrigacao({ responsavelId: null })
    const semEnvio = await registrarRecebimentoDaCertidao({ tarefaId: antes.tarefaId, usuario: { userId: marco.id, tipo: "admin" } })
    ok("antes de o requerimento ser enviado: recusado, em português claro", !semEnvio.ok && semEnvio.codigo === "PEDIDO_NAO_ENVIADO" && /enviado/.test(semEnvio.mensagem))

    secao("4) REGISTRAR ANTES DO PRAZO — quem fez o pedido, sem anexo e sem protocolo")
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date())
    const reg = await registrarRecebimentoDaCertidao({ tarefaId: o1.tarefaId, usuario: { userId: daniela.id, tipo: "assistente", nome: `${MARCA} Daniela` }, recebidaEm: hoje })
    ok("registrou (a «Receber confirmação» exigia protocolo e foi dispensada: pedido antigo)", reg.ok === true, reg.ok ? reg.texto : reg.mensagem)
    const st = await statusDe(o1.stepInstanceId)
    ok("subtarefas 2 e 3 concluídas", st.receber_confirmacao_pedido === "CONCLUIDO" && st.receber_certidao === "CONCLUIDO", JSON.stringify(st))
    ok("a 4 «Conferir e validar» foi liberada (disponível), ainda não concluída", st.conferir_validar_certidao === "DISPONIVEL" || st.conferir_validar_certidao === "PENDENTE", st.conferir_validar_certidao)
    const t1d = await prisma.tarefa.findUnique({ where: { id: o1.tarefaId }, select: { statusTarefa: true, responsavelId: true } })
    ok("o responsável passa a ser quem registrou", t1d?.responsavelId === daniela.id)
    ok("a tarefa continua aberta (falta conferir e validar)", !["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI"].includes(t1d?.statusTarefa ?? ""), t1d?.statusTarefa)
    const ld = await linhaDaEquipe(o1.tarefaId)
    ok("saiu de Aguardando e foi para A fazer", ld?.estadoOperacao === "FILA", ld?.estadoOperacao)
    ok("o passo atual é «Conferir e validar certidão»", ld?.passoCorrente?.chave === "conferir_validar_certidao", ld?.passoCorrente?.label)
    const log = await prisma.logAuditoria.findFirst({ where: { acao: "CERTIDAO_RECEBIMENTO_REGISTRADO", entidadeId: o1.tarefaId } })
    ok("o histórico tem a frase clara «Recebida em dd/mm · registrado por <nome>»", !!log && /^Recebida em \d{2}\/\d{2}(\/\d{4})? · registrado por EMIREC Daniela$/.test(log.descricao), log?.descricao)
    ok("registrar de novo é recusado (já registrado)", (await registrarRecebimentoDaCertidao({ tarefaId: o1.tarefaId, usuario: { userId: daniela.id, tipo: "assistente" } })).ok === false)

    // Dentro da MESMA tarefa os passos não trocam o responsável: a 4 não tira a tarefa de quem a tem.
    ok("os passos da Emissão não mexem no responsável (dentro da mesma tarefa)", (await prisma.tarefa.findUnique({ where: { id: o1.tarefaId }, select: { responsavelId: true } }))?.responsavelId === daniela.id)

    secao("5) FEITO: só com os 4 passos concluídos")
    const feitoAntes = await concluidasRecentesDoUsuario(null)
    ok("com a 4 pendente a certidão NÃO está em Feito", !feitoAntes.some((l) => l.taskId === o1.tarefaId))
    const fim = await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: o1.stepInstanceId, executadoPorId: daniela.id, payload: {}, resultado: "validada", subtarefaKeyEsperada: "conferir_validar_certidao" })
    ok("concluir a 4 libera o passo (agora sim, as 4 feitas)", fim.aplicavel === true && fim.podeConcluirPasso === true)

    secao("6) REGISTRAR DEPOIS DO PRAZO — pedido de um ano atrás, data passada, sem anexo nem comprovante, pelo Marco")
    const o2 = await c.novaObrigacao({ responsavelId: daniela.id })
    await enviarPedido(o2.stepInstanceId, daniela.id)
    await prisma.subtaskExecution.updateMany({ where: { stepInstanceId: o2.stepInstanceId, subtaskKey: "enviar_requerimento_cartorio" }, data: { completedAt: new Date(Date.now() - 400 * dia) } })
    await prisma.tarefa.update({ where: { id: o2.tarefaId }, data: { dataPrazo: new Date(Date.now() - 380 * dia) } })
    ok("pedido antigo e vencido continua em Aguardando", (await linhaDaEquipe(o2.tarefaId))?.estadoOperacao === "AGUARDANDO")
    const antiga = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() - 380 * dia))
    const reg2 = await registrarRecebimentoDaCertidao({ tarefaId: o2.tarefaId, usuario: { userId: marco.id, tipo: "admin", nome: `${MARCA} Marco` }, recebidaEm: antiga })
    ok("o Marco registra o recebimento com data de meses atrás", reg2.ok === true, reg2.ok ? reg2.texto : reg2.mensagem)
    const st2 = await statusDe(o2.stepInstanceId)
    ok("subtarefas 2 e 3 concluídas; 4 liberada", st2.receber_confirmacao_pedido === "CONCLUIDO" && st2.receber_certidao === "CONCLUIDO" && st2.conferir_validar_certidao !== "CONCLUIDO")
    ok("a frase do histórico traz a data passada (com o ano) e quem registrou", /Recebida em \d{2}\/\d{2}\/\d{4} · registrado por EMIREC Marco/.test((await prisma.logAuditoria.findFirst({ where: { acao: "CERTIDAO_RECEBIMENTO_REGISTRADO", entidadeId: o2.tarefaId } }))?.descricao ?? ""))
    ok("não foi exigido anexo nem protocolo: nenhum arquivo foi criado", (await prisma.documentoArquivo.count({ where: { documento: { descricao: { startsWith: MARCA } } } })) === 0)

    secao("6b) O VIGIA pega o defeito: passo da Emissão concluído com subtarefa aberta")
    const o3 = await c.novaObrigacao({ responsavelId: daniela.id })
    await enviarPedido(o3.stepInstanceId, daniela.id)
    await prisma.phaseWorkflowStepInstance.update({ where: { id: o3.stepInstanceId }, data: { status: "CONCLUIDO", faseMacroKey: "emissao_documental" } })
    const viol = (await detectarViolacoesDeIntegridade()).violacoes.filter((v) => v.regra === "R8" && v.registroId === o3.stepInstanceId)
    ok("R8 acusa «passo concluído com subtarefa aberta»", viol.length === 1 && /subtarefa aberta/.test(viol[0].detalhe), viol[0]?.detalhe)
    ok("e não acusa o passo que está certo (todas as 4 feitas, ou aberto)", !(await detectarViolacoesDeIntegridade()).violacoes.some((v) => v.regra === "R8" && (v.registroId === o1.stepInstanceId || v.registroId === o2.stepInstanceId)))

    secao("7) As regras puras")
    ok("aguardandoOCartorio: pedido concluído + recebimento aberto", aguardandoOCartorio({ enviar_requerimento_cartorio: "CONCLUIDO", receber_certidao: "BLOQUEADO" }))
    ok("não é aguardando antes do envio", !aguardandoOCartorio({ enviar_requerimento_cartorio: "DISPONIVEL", receber_certidao: "BLOQUEADO" }))
    ok("não é aguardando depois do recebimento", !aguardandoOCartorio({ enviar_requerimento_cartorio: "CONCLUIDO", receber_certidao: "CONCLUIDO" }))
    ok("quem pode registrar: pedido, responsável e admin", podeRegistrarRecebimento({ tipo: "x", userId: 1, responsavelId: null, pedidoPorId: 1 }) && podeRegistrarRecebimento({ tipo: "x", userId: 1, responsavelId: 1, pedidoPorId: null }) && podeRegistrarRecebimento({ tipo: "admin", userId: 9, responsavelId: null, pedidoPorId: null }) && !podeRegistrarRecebimento({ tipo: "x", userId: 2, responsavelId: 1, pedidoPorId: 3 }))
    ok("texto: «Recebida em 07/10 · registrado por Daniela Brait»", textoDoRecebimento("2026-10-07T15:00:00Z", "Daniela Brait", new Date("2026-10-08T12:00:00Z")) === "Recebida em 07/10 · registrado por Daniela Brait")
    ok("data de recebimento: 31/02 é inválida; passada vale; futura não", dataDeRecebimento("2026-02-31") === null && dataDeRecebimento("2025-01-10") !== null && dataDeRecebimento("2999-01-01") === null)
    ok("os rótulos claros no lugar dos códigos", rotuloDeEstado("CONCLUIDO_RECEBIDO") === "Concluída" && rotuloDeEstado("AGUARDANDO_EXTERNO") === "Aguardando terceiros" && rotuloDeEstado("NAO_INICIADA") === "A iniciar")

    secao("8) A tela (estático)")
    const abas = readFileSync("src/components/operacao/operacao-v3-abas.tsx", "utf8")
    const modal = readFileSync("src/components/operacao/RegistrarRecebimentoModal.tsx", "utf8")
    const wf = readFileSync("src/components/kanban/workflow/WorkflowTab.tsx", "utf8")
    // FLUXO ÚNICO (07/10/2026): a linha do Aguardando só tem «Abrir»; o recebimento se registra no passo 2 da gaveta («Iniciar →» abre o modal).
    ok("a linha do Aguardando NÃO tem atalho de recebimento (só «Abrir»)", !/>\s*Registrar recebimento\s*</.test(abas) && !/podeRegistrar/.test(abas))
    ok("a gaveta abre o modal pelo «Iniciar →» do passo 2 (Receber confirmação do pedido)", /SUBTAREFA_CONFIRMACAO && !s\.concluida/.test(wf) && /iniciar-registrar-recebimento/.test(wf) && /<RegistrarRecebimentoModal/.test(wf))
    ok("só a gaveta usa o modal (nem a Operação nem a Torre o abrem por conta própria)", !/RegistrarRecebimentoModal/.test(readFileSync("src/components/operacao/operacao-v3.tsx", "utf8")))
    ok("o modal pede a data dd/mm/aaaa (sugere hoje), anexo OPCIONAL e confirmação antes de gravar", /CampoDataTexto/.test(modal) && /Anexar a certidão \(opcional\)/.test(modal) && /confirmado: true/.test(modal) && /Confirmar/.test(modal))
    ok("o anexo não é exigido: o botão Continuar só depende da data", /disabled=\{enviando \|\| !dia\}/.test(modal) && !/required/.test(modal))
  } finally {
    await prisma.documentoArquivo.deleteMany({ where: { documento: { descricao: { startsWith: MARCA } } } })
    await c.limpar()
    await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA.toLowerCase() } } })
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
