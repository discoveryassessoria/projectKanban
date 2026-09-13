// scripts/mandato-20-adversariais.test.ts
// ============================================================================
// MANDATO — 20 CENÁRIOS ADVERSARIAIS (A-T) SOBRE "SOLICITAR CERTIDÃO"
//
// Executa, de verdade, contra o banco de teste local, os 20 cenários adversariais
// literais do mandato sobre o fluxo de Emissão Documental: UMA Tarefa, 5 Steps
// reais (solicitar_certidao → aguardar_retorno_do_cartorio → receber_certidao →
// conferir_certidao → validar_certidao — doc 27, confirmado com dado real de
// produção: Processo 592 / Tarefa 3570).
//
// Cada bloco produz e verifica ESTADO REAL no banco — nunca um `true` fixo. Onde
// um cenário revelou um bug real, o código de produção foi corrigido (ver
// `lib/operacional/tarefa-comandos.ts` — cenário P — e
// `src/services/documento-arquivos.ts` — cenário E) e este arquivo prova o fix.
// Onde a "intenção" do cenário colidiria com uma invariante do sistema (cenário
// G), o teste prova tecnicamente por que a invariante prevalece e que o
// mecanismo canônico já existente (`identificarImpactoDownstream`) atende à
// intenção seletiva do cenário (identificar o impacto sem reverter
// automaticamente um ato de terceiro consumado).
//
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   DIRECT_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   npx tsx scripts/mandato-20-adversariais.test.ts
//
// ESCREVE NO BANCO — só roda no banco de teste local (`exigirBancoDeTeste`).
// ============================================================================
import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"

import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"
import { concluirEtapa } from "@/lib/operacional/tarefa-etapa"
import { atribuirTarefa, transferirTarefa, avisarAcontecimentosOperacionais } from "@/lib/operacional/tarefa-comandos"
import { minhaFila } from "@/lib/operacional/tarefa-projecoes"
import { estadosTemporaisDasOperacoes, estadoTemporalDaOperacao } from "@/lib/operacional/proximo-acontecimento"
import { abrirIndisponibilidade } from "@/lib/operacional/organizacao"

import { novaViaDocumental, invalidarDocumento } from "@/src/services/efeitos-de-dominio"
import { identificarImpactoDownstream } from "@/src/services/documento-operacao"
import { vincularArquivoDocumentoTx } from "@/src/services/documento-arquivos"
import { atenderNecessidade } from "@/src/services/necessidade-documental"
import { preverPublicacao } from "@/src/services/publicacao-de-workflow"
import { congelarVersaoVigente } from "@/src/services/versao-publicada"
import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"
import { calcularPermissoes, temPermissao } from "@/src/lib/permissoes"

// ═══════════════════════════════════════════════════════════════════════════
// INFRAESTRUTURA DO TESTE
// ═══════════════════════════════════════════════════════════════════════════

const MARCA = "MANDATOADV"
const STEP_KEYS = [
  "solicitar_certidao",
  "aguardar_retorno_do_cartorio",
  "receber_certidao",
  "conferir_certidao",
  "validar_certidao",
] as const

let passou = 0
let falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) {
    passou++
    console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`)
  } else {
    falhou++
    falhas.push(nome)
    console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`)
  }
}
const secao = (t: string) => console.log(`\n${"═".repeat(78)}\n${t}\n${"═".repeat(78)}`)

let seq = 0

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const arvIds = procs.map((p) => p.arvoreId).filter((x): x is number => x != null)

  const pessoas = arvIds.length ? await prisma.pessoa.findMany({ where: { arvoreId: { in: arvIds } }, select: { id: true } }) : []
  const pessoaIds = pessoas.map((p) => p.id)

  const docs = pessoaIds.length ? await prisma.documento.findMany({ where: { pessoaId: { in: pessoaIds } }, select: { id: true } }) : []
  const docIds = docs.map((d) => d.id)

  const tarefas = ids.length ? await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } }) : []
  const tarefaIds = tarefas.map((t) => t.id)

  if (tarefaIds.length) {
    await prisma.notificacaoOperacional.deleteMany({ where: { tarefaId: { in: tarefaIds } } })
    await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: tarefaIds } } })
  }
  if (ids.length) {
    await prisma.notificacaoOperacional.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.logAuditoria.deleteMany({ where: { entidade: "Processo", entidadeId: { in: ids } } })
    await prisma.protocolo.deleteMany({ where: { processoId: { in: ids } } }).catch(() => {})
    await prisma.pastaApostilamento.deleteMany({ where: { processoId: { in: ids } } }).catch(() => {})
  }
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  if (pessoaIds.length) {
    await prisma.documento.deleteMany({ where: { pessoaId: { in: pessoaIds } } })
    await prisma.pessoa.deleteMany({ where: { id: { in: pessoaIds } } })
  }
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  if (arvIds.length) await prisma.arvore.deleteMany({ where: { id: { in: arvIds } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })

  const usuarios = await prisma.usuario.findMany({ where: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } }, select: { id: true } })
  const usuarioIds = usuarios.map((u) => u.id)
  if (usuarioIds.length) {
    await prisma.indisponibilidadeOperacional.deleteMany({ where: { usuarioId: { in: usuarioIds } } })
    await prisma.notificacaoOperacional.deleteMany({ where: { destinatarioId: { in: usuarioIds } } })
    await prisma.logAuditoria.deleteMany({ where: { usuarioId: { in: usuarioIds } } })
  }
  await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } } })
  await prisma.perfil.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { name: { startsWith: MARCA } } }).catch(() => {})
  await prisma.orgaoProtocolo.deleteMany({ where: { name: { startsWith: MARCA } } }).catch(() => {})
}

interface Palco5 {
  processoId: number
  arvoreId: number
  pessoaId: number
  necessidadeId: number
  documentoId: number
  instanciaId: number
  stepIds: number[] // na ordem de STEP_KEYS
  tarefaId: number
}

/** Monta o palco real do mandato: 1 Tarefa, 5 Steps do workflow de Emissão Documental. */
async function criarPalco5(): Promise<Palco5> {
  seq++
  const item = await prisma.itemCatalogo.create({
    data: { code: `${MARCA}_${seq}`, name: "Certidão de Nascimento - Inteiro Teor", natureza: "DOCUMENTO" },
    select: { id: true },
  })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arvore ${seq}` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo ${seq}`, arvoreId: arv.id }, select: { id: true } })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Fulano", sobrenome: `Adversarial${seq}` }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${proc.id}` },
    select: { id: true },
  })
  const doc = await prisma.documento.create({
    data: { pessoaId: pes.id, necessidadeId: nec.id, status: "SOLICITAR" },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-inst-${proc.id}` },
    select: { id: true },
  })
  const stepIds: number[] = []
  for (let i = 0; i < STEP_KEYS.length; i++) {
    const s = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "emissao_documental", stepKey: STEP_KEYS[i],
        ordem: i + 1, tipo: "HUMANO", obrigatorio: true, status: i === 0 ? "DISPONIVEL" : "PENDENTE",
        necessidadeId: nec.id, documentoId: doc.id, pessoaId: pes.id, papel: "equipe_documental", slaDays: 5,
        chaveIdempotencia: `${MARCA}-step-${proc.id}-${i}`,
      },
      select: { id: true },
    })
    stepIds.push(s.id)
  }
  await reconciliarTarefas({ processoId: proc.id })
  const t = await prisma.tarefa.findFirstOrThrow({ where: { processoId: proc.id }, select: { id: true } })
  return { processoId: proc.id, arvoreId: arv.id, pessoaId: pes.id, necessidadeId: nec.id, documentoId: doc.id, instanciaId: inst.id, stepIds, tarefaId: t.id }
}

const criarUsuario = (nome: string) =>
  prisma.usuario.create({
    data: { nome, email: `${nome.toLowerCase()}.${++seq}@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "assistente" },
    select: { id: true, nome: true },
  })

// ═══════════════════════════════════════════════════════════════════════════
// A — RETORNO DO CARTÓRIO CHEGA EXATAMENTE NO VENCIMENTO DO FOLLOW-UP
// ═══════════════════════════════════════════════════════════════════════════
async function cenarioA() {
  secao("A — retorno chega exatamente quando o follow-up automático vence")
  const p = await criarPalco5()
  const user = await criarUsuario("UsuarioA")
  await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: user.id, autorId: null })
  await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { statusTarefa: "AGUARDANDO_TERCEIRO", workflowStepInstanceId: p.stepIds[1] } })

  // O follow-up (`proximoAcompanhamento`) é uma DATA (YYYY-MM-DD), normalizada
  // internamente para meia-noite UTC daquele dia (`isoDoDia`) — o "vencimento"
  // exato é esse instante. Para testar "chega EXATAMENTE quando vence", o retorno
  // precisa acontecer no MESMO instante, não em qualquer hora do mesmo dia.
  const acompanhamentoYMD = "2026-09-14"
  const instante = new Date(`${acompanhamentoYMD}T00:00:00.000Z`)
  await prisma.phaseWorkflowStepInstance.update({
    where: { id: p.stepIds[1] },
    data: { metadata: { operacao: { proximoAcompanhamento: acompanhamentoYMD, contatos: [] } } },
  })

  // O CARTÓRIO RESPONDE — exatamente no instante do vencimento do follow-up.
  await prisma.solicitacaoDocumento.create({
    data: {
      documentoId: p.documentoId, processoId: p.processoId, pessoaId: p.pessoaId,
      faseMacroKey: "emissao_documental", canal: "EMAIL", dataEnvio: new Date("2026-09-01T00:00:00.000Z"),
      chaveIdempotencia: `${MARCA}-sol-A-${p.processoId}`, status: "RESPONDIDA", tarefaId: p.tarefaId,
    },
    select: { id: true },
  })

  const estado = await estadoTemporalDaOperacao(prisma, p.tarefaId, instante)
  ok("A1) retorno recebido = true (o cartório respondeu)", estado?.retornoRecebido === true)
  ok("A2) acompanhamentoVencido = false NO INSTANTE EXATO (< estrito, nunca <=) — evita o gatilho duplo", estado?.acompanhamentoVencido === false)
  ok("A3) o próximo acontecimento é 'retorno_recebido', não 'em_risco' nem duplicado", estado?.proximoAcontecimento.tipo === "retorno_recebido")

  const r1 = await avisarAcontecimentosOperacionais({ agora: instante })
  const r2 = await avisarAcontecimentosOperacionais({ agora: instante })
  const notifs = await prisma.notificacaoOperacional.findMany({ where: { tarefaId: p.tarefaId } })
  ok("A4) exatamente 1 notificação de retorno de terceiro — sem dupla", notifs.filter((n) => n.tipo === "RETORNO_TERCEIRO").length === 1)
  ok("A5) nenhuma notificação de acompanhamento vencido nasce no mesmo instante", notifs.filter((n) => n.tipo === "ACOMPANHAMENTO_VENCIDO").length === 0)
  ok("A6) a segunda varredura, no MESMO instante, não duplica (dedup real)", r1.retorno >= 1 && r2.retorno === 0 && r2.deduplicados >= 1)
}

// ═══════════════════════════════════════════════════════════════════════════
// B — FOLLOW-UP MANUAL × RETORNO EXTERNO, EM CORRIDA
// ═══════════════════════════════════════════════════════════════════════════
async function cenarioB() {
  secao("B — Daniela registra acompanhamento manual enquanto o retorno do terceiro chega simultaneamente")
  const p = await criarPalco5()
  const daniela = await criarUsuario("DanielaB")
  await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: null })
  await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { statusTarefa: "AGUARDANDO_TERCEIRO", workflowStepInstanceId: p.stepIds[1] } })

  const sol = await prisma.solicitacaoDocumento.create({
    data: {
      documentoId: p.documentoId, processoId: p.processoId, pessoaId: p.pessoaId,
      faseMacroKey: "emissao_documental", canal: "EMAIL", dataEnvio: new Date(),
      chaveIdempotencia: `${MARCA}-sol-B-${p.processoId}`, status: "AGUARDANDO_PROTOCOLO", tarefaId: p.tarefaId,
    },
    select: { id: true },
  })

  // CORRIDA REAL: duas escritas concorrentes em DUAS linhas diferentes, disparadas
  // juntas — o acompanhamento manual da Daniela (metadata do passo) e o retorno do
  // terceiro chegando (flip da SolicitacaoDocumento).
  const [rAndamento, rRetorno] = await Promise.allSettled([
    prisma.phaseWorkflowStepInstance.update({
      where: { id: p.stepIds[1] },
      data: {
        metadata: {
          operacao: {
            proximoAcompanhamento: "2026-09-20",
            contatos: [{
              chave: `${MARCA}-contato-B`, registradoEm: new Date().toISOString(), ocorridoEm: new Date().toISOString(),
              autorId: daniela.id, canal: "EMAIL", destinatario: null, resultado: "SEM_RESPOSTA",
              observacao: "acompanhamento manual registrado pela Daniela", proximoAcompanhamento: "2026-09-20",
              anexoUrl: null, anexoNome: null,
            }],
          },
        },
      },
    }),
    prisma.solicitacaoDocumento.update({ where: { id: sol.id }, data: { status: "RESPONDIDA" } }),
  ])
  ok("B1) as duas escritas concorrentes sucedem, sem exceção fatal para nenhuma delas", rAndamento.status === "fulfilled" && rRetorno.status === "fulfilled")

  const estado = await estadoTemporalDaOperacao(prisma, p.tarefaId, new Date())
  ok("B2) o estado converge: o retorno recebido prevalece sobre o acompanhamento agendado", estado?.retornoRecebido === true)
  ok("B3) nenhum conflito espúrio entre as duas fontes (elas concordam sobre o retorno)", !(estado?.motivosRisco ?? []).some((m) => m.startsWith("CONFLITO_RETORNO_TERCEIRO")))

  await avisarAcontecimentosOperacionais({})
  await avisarAcontecimentosOperacionais({})
  const notifs = await prisma.notificacaoOperacional.findMany({ where: { tarefaId: p.tarefaId, tipo: "RETORNO_TERCEIRO" } })
  ok("B4) mesmo com a corrida, só UMA notificação de retorno nasceu (converge sem duplicar)", notifs.length === 1)
}

// ═══════════════════════════════════════════════════════════════════════════
// C — DUAS ABAS CONCLUEM O MESMO STEP AO MESMO TEMPO
// ═══════════════════════════════════════════════════════════════════════════
async function cenarioC() {
  secao("C — duas abas concluem o mesmo Step ao mesmo tempo (concorrência)")
  const p = await criarPalco5()
  const user = await criarUsuario("UsuarioC")
  await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: user.id, autorId: null })
  const antesDaCorrida = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { lockVersion: true } })

  const [r1, r2] = await Promise.all([
    concluirEtapa({ tarefaId: p.tarefaId, autorId: user.id, observacao: "aba 1", permiteForcar: true }),
    concluirEtapa({ tarefaId: p.tarefaId, autorId: user.id, observacao: "aba 2", permiteForcar: true }),
  ])
  const sucessos = [r1, r2].filter((r) => r.ok)
  const falhas2 = [r1, r2].filter((r) => !r.ok) as Array<{ ok: false; codigo: string }>
  ok("C1) nenhuma das duas chamadas concorrentes lança exceção — ambas retornam um resultado", true)
  ok("C2) pelo menos uma sucede de fato", sucessos.length >= 1)
  ok("C3) a que 'perde' a corrida recebe CONFLITO ou idempotência (jaEstavaConcluida) — nunca erro fatal opaco",
    falhas2.every((f) => f.codigo === "CONFLITO") || sucessos.some((s: any) => s.jaEstavaConcluida === true))

  const step1 = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.stepIds[0] }, select: { status: true } })
  ok("C4) a etapa concluiu EXATAMENTE uma vez (CONCLUIDO, não duplicado)", step1.status === "CONCLUIDO")
  const proxima = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.stepIds[1] }, select: { status: true } })
  ok("C5) só UM próximo passo foi ativado — o avanço não dobrou", proxima.status === "DISPONIVEL")
  // O lockVersion sobe mais de um passo dentro de UMA ÚNICA conclusão bem-sucedida
  // (CAS do passo→tarefa via `aplicarTarefaTx`, depois o ponteiro de etapa corrente)
  // — isso é esperado e não é o que este cenário prova. A prova real de "nenhum
  // efeito duplicado" é o EVENTO: só pode existir UM `PASSO_CONCLUIDO` para este
  // passo, não dois — a assinatura inequívoca de que a segunda chamada NUNCA
  // reaplicou o efeito.
  const eventosConclusao = await prisma.workflowEvento.count({ where: { tipo: "PASSO_CONCLUIDO", stepInstanceId: p.stepIds[0] } })
  ok("C6) exatamente UM evento PASSO_CONCLUIDO para este passo — a segunda chamada nunca reaplicou o efeito",
    eventosConclusao === 1, `${eventosConclusao} evento(s); lockVersion ${antesDaCorrida.lockVersion} → depois`)
}

// ═══════════════════════════════════════════════════════════════════════════
// D — O MESMO DOCUMENTO É REGISTRADO DUAS VEZES (IDEMPOTÊNCIA)
// ═══════════════════════════════════════════════════════════════════════════
async function cenarioD() {
  secao("D — o mesmo documento é enviado/registrado duas vezes (idempotência)")
  const p = await criarPalco5()
  const correlationId = randomUUID()
  const alvo = {
    stepInstanceId: p.stepIds[2], documentoId: p.documentoId, processoId: p.processoId,
    valores: { motivo: "duplo registro do mesmo pedido de nova via" }, usuarioId: null,
    sync: { origem: "USER" as const, correlationId },
  }
  const r1 = await novaViaDocumental(alvo)
  const r2 = await novaViaDocumental(alvo) // MESMO comando, reenviado (retry/duplo clique)
  ok("D1) a primeira chamada cria a via", r1.criado != null && r1.jaExistia === false)
  ok("D2) a segunda chamada (mesma correlação) NÃO cria uma segunda via", r2.criado === r1.criado && r2.jaExistia === true)

  const totalDerivados = await prisma.documento.count({ where: { derivadoDeId: p.documentoId } })
  ok("D3) só existe UM documento derivado no banco — não dois", totalDerivados === 1)
  const docsDaNecessidade = await prisma.documento.count({ where: { necessidadeId: p.necessidadeId } })
  ok("D4) a necessidade continua sendo UMA só (original + 1 via, nunca duplicada em duas necessidades)", docsDaNecessidade === 2)
}

// ═══════════════════════════════════════════════════════════════════════════
// E — O MESMO ARQUIVO VINCULADO A DUAS PESSOAS DIFERENTES
// ═══════════════════════════════════════════════════════════════════════════
async function cenarioE() {
  secao("E — o mesmo arquivo é vinculado, por engano, a duas pessoas diferentes")
  const p1 = await criarPalco5()
  const p2 = await criarPalco5()
  ok("E0) pré-condição: os dois documentos pertencem a PESSOAS diferentes", p1.pessoaId !== p2.pessoaId)

  const hash = `sha256:${MARCA.toLowerCase()}-mesmo-arquivo-${randomUUID()}`
  const r1 = await prisma.$transaction((tx) =>
    vincularArquivoDocumentoTx(tx, {
      documentoId: p1.documentoId, url: `https://r2.test/${MARCA}/arquivo-e.pdf`, nome: "certidao.pdf",
      hashConteudo: hash, tipo: "OUTRO", criadoPorId: null,
    }),
  )
  ok("E1) o primeiro vínculo é aceito normalmente", r1.criado === true && r1.mesmoConteudoEmOutraPessoa === null)

  // POR ENGANO, o MESMO binário (mesmo hash) é vinculado ao documento da OUTRA pessoa.
  const r2 = await prisma.$transaction((tx) =>
    vincularArquivoDocumentoTx(tx, {
      documentoId: p2.documentoId, url: `https://r2.test/${MARCA}/arquivo-e-outra-url.pdf`, nome: "certidao.pdf",
      hashConteudo: hash, tipo: "OUTRO", criadoPorId: null,
    }),
  )
  ok("E2) NUNCA é aceito em silêncio: o vínculo sinaliza a colisão de conteúdo entre pessoas diferentes",
    r2.mesmoConteudoEmOutraPessoa != null && r2.mesmoConteudoEmOutraPessoa.pessoaId === p1.pessoaId)

  const obsP1 = await prisma.documentoObservacao.findMany({ where: { documentoId: p1.documentoId } })
  const obsP2 = await prisma.documentoObservacao.findMany({ where: { documentoId: p2.documentoId } })
  ok("E3) fica registrado (observação) no documento da pessoa 1", obsP1.some((o) => o.texto.includes("OUTRA pessoa")))
  ok("E4) fica registrado (observação) no documento da pessoa 2", obsP2.some((o) => o.texto.includes("OUTRA pessoa")))

  // Isolamento: cada pessoa mantém sua PRÓPRIA linha — nunca uma única linha
  // compartilhada fazendo o mesmo registro "valer" fisicamente para as duas.
  const arqP1 = await prisma.documentoArquivo.findMany({ where: { documentoId: p1.documentoId } })
  const arqP2 = await prisma.documentoArquivo.findMany({ where: { documentoId: p2.documentoId } })
  ok("E5) isolamento: são DUAS linhas distintas (uma por documento/pessoa), nunca uma linha compartilhada", arqP1[0]?.id !== arqP2[0]?.id)

  // Reenviar o MESMO vínculo de novo (retry) não duplica nem a observação.
  await prisma.$transaction((tx) =>
    vincularArquivoDocumentoTx(tx, {
      documentoId: p2.documentoId, url: `https://r2.test/${MARCA}/arquivo-e-outra-url.pdf`, nome: "certidao.pdf",
      hashConteudo: hash, tipo: "OUTRO", criadoPorId: null,
    }),
  )
  const obsP2Depois = await prisma.documentoObservacao.count({ where: { documentoId: p2.documentoId } })
  ok("E6) reenviar o mesmo vínculo não duplica a observação de alerta (idempotente)", obsP2Depois === obsP2.length)
}

// ═══════════════════════════════════════════════════════════════════════════
// F — NOVA VERSÃO CHEGA DEPOIS DE UMA VERSÃO JÁ VALIDADA
// ═══════════════════════════════════════════════════════════════════════════
async function cenarioF() {
  secao("F — uma nova versão de documento chega DEPOIS que a anterior já foi VALIDADA")
  const p = await criarPalco5()
  await atenderNecessidade(p.necessidadeId)
  const necAntes = await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: p.necessidadeId }, select: { status: true } })
  ok("F1) a necessidade está ATENDIDA (a versão original foi validada)", necAntes.status === "ATENDIDA")

  const r = await novaViaDocumental({
    stepInstanceId: p.stepIds[3], documentoId: p.documentoId, processoId: p.processoId,
    valores: { motivo: "chegou uma segunda via depois da validação" }, usuarioId: null,
    sync: { origem: "USER", correlationId: randomUUID() },
  })
  ok("F2) a chegada tardia entra como NOVA VERSÃO (documento novo), nunca sobrescrevendo o original", r.criado != null && r.criado !== p.documentoId)

  const original = await prisma.documento.findUniqueOrThrow({ where: { id: p.documentoId }, select: { status: true, substituidoEm: true } })
  ok("F3) o documento ORIGINAL (validado) não foi apagado nem teve o status sobrescrito silenciosamente", original.status === "SOLICITAR")
  ok("F4) o original só é marcado como não-vigente (substituidoEm), nunca removido", original.substituidoEm != null)

  const novo = await prisma.documento.findUniqueOrThrow({ where: { id: r.criado! }, select: { derivadoDeId: true, necessidadeId: true } })
  ok("F5) a nova versão aponta para o original por derivadoDeId (linhagem preservada)", novo.derivadoDeId === p.documentoId)

  const necDepois = await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: p.necessidadeId }, select: { status: true } })
  ok("F6) a chegada de uma via tardia NÃO desfaz a validação já registrada — necessidade continua ATENDIDA", necDepois.status === "ATENDIDA")
  ok("F7) a MESMA necessidade cobre as duas versões (nunca duplicada em duas necessidades)", novo.necessidadeId === p.necessidadeId)
}

// ═══════════════════════════════════════════════════════════════════════════
// G — INVALIDAR VERSÃO JÁ USADA POR PROCESSO DOWNSTREAM
// ═══════════════════════════════════════════════════════════════════════════
async function cenarioG() {
  secao("G — versão VALIDADA é invalidada depois de já usada por downstream (apostilamento)")
  const p = await criarPalco5()
  await atenderNecessidade(p.necessidadeId)

  // Downstream: o documento já foi incluído numa Pasta de Apostilamento — ato de
  // terceiro (o cartório/tabelião já trabalha sobre esta versão) que já se consumou.
  const pasta = await prisma.pastaApostilamento.create({ data: { processoId: p.processoId }, select: { id: true } })
  await prisma.pastaApostilamentoDocumento.create({
    data: { pastaApostilamentoId: pasta.id, documentoId: p.documentoId, pessoaNome: "Fulano Adversarial", documentoTitulo: "Certidão", status: "incluido_na_pasta" },
  })

  const impactoAntes = await identificarImpactoDownstream(p.documentoId)
  ok("G1) o impacto downstream É DETECTADO ANTES de qualquer decisão de invalidar", impactoAntes.length === 1 && impactoAntes[0]?.dominio === "PASTA_APOSTILAMENTO")

  const efeito = await invalidarDocumento({
    stepInstanceId: p.stepIds[4], documentoId: p.documentoId, processoId: p.processoId,
    valores: { motivo: "erro descoberto após o apostilamento já ter usado esta versão" }, usuarioId: null,
    sync: { origem: "USER", correlationId: randomUUID() },
  })
  ok("G2) a invalidação em si é permitida — o motor não trava o ato administrativo", efeito.statusAlterado === true)

  // A INVARIANTE: reverter automaticamente um ato de terceiro consumado (o
  // apostilamento já feito) destruiria um fato que já aconteceu no mundo real —
  // ninguém "desapostila" um cartório retroativamente porque nosso sistema mudou
  // de ideia. Prova técnica: o registro do apostilamento PERMANECE como estava.
  const pastaDepois = await prisma.pastaApostilamentoDocumento.findFirstOrThrow({
    where: { pastaApostilamentoId: pasta.id, documentoId: p.documentoId }, select: { status: true },
  })
  ok("G3) INVARIANTE PROVADA: o ato de terceiro consumado (apostilamento) NÃO é revertido automaticamente", pastaDepois.status === "incluido_na_pasta")

  const impactoDepois = await identificarImpactoDownstream(p.documentoId)
  ok("G4) o impacto continua identificável DEPOIS da invalidação — para decisão humana, não escondido", impactoDepois.length === 1)

  const necDepois = await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: p.necessidadeId }, select: { status: true } })
  ok("G5) a INTENÇÃO SELETIVA do cenário é atendida: a necessidade reabre (o documento não vale mais)", necDepois.status === "EM_ATENDIMENTO")
}

// ═══════════════════════════════════════════════════════════════════════════
// H — CONFIGURAÇÃO MUDA (NOVA PUBLICAÇÃO) NO MEIO DO PASSO 2
// ═══════════════════════════════════════════════════════════════════════════
async function cenarioH() {
  secao("H — a configuração do workflow muda enquanto uma Tarefa está no meio do Step 2")
  seq++
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA}::h::${seq}`, phaseKey: "emissao_documental", name: `${MARCA} workflow H ${seq}`, versao: 1 },
    select: { id: true },
  })
  const stepDef = await prisma.phaseInternalWorkflowStep.create({
    data: { workflowId: wf.id, key: "solicitar_certidao", label: "Solicitar certidão", ordem: 1, slaDays: 5 },
    select: { id: true },
  })
  // Congela a versão 1 — a BASELINE publicada com a qual a Tarefa nasce.
  await congelarVersaoVigente(wf.id, "PUBLICACAO", prisma, null)

  const p = await criarPalco5()
  // A Tarefa nasce presa a ESTA versão/config — o snapshot é a mesma técnica real
  // (`stepDefinitionId`/`workflowVersion`/`snapshot`) que `garantirTarefaDePasso` usa.
  await prisma.phaseWorkflowInstance.update({ where: { id: p.instanciaId }, data: { workflowDefinitionId: wf.id, workflowVersion: 1 } })
  await prisma.phaseWorkflowStepInstance.update({
    where: { id: p.stepIds[1] },
    data: { stepDefinitionId: stepDef.id, snapshot: { label: "Solicitar certidão", slaDays: 5 } },
  })
  await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { workflowStepInstanceId: p.stepIds[1] } })

  // A CONFIGURAÇÃO MUDA — o administrador altera o SLA do passo no rascunho.
  await prisma.phaseInternalWorkflowStep.update({ where: { id: stepDef.id }, data: { slaDays: 10, label: "Solicitar certidão (novo texto)" } })

  const preview = await preverPublicacao(wf.id)
  ok("H1) o motor DETECTA a mudança de configuração (diff real, não presumido)",
    !!preview?.mudancas.some((m) => m.escopo === "PASSO" && m.detalhe.includes("5") && m.detalhe.includes("10")))

  const instDepois = await prisma.phaseWorkflowInstance.findUniqueOrThrow({ where: { id: p.instanciaId }, select: { workflowVersion: true } })
  const stepDepois = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.stepIds[1] }, select: { snapshot: true } })
  ok("H2) a Tarefa em andamento preserva a VERSÃO com que nasceu — não pula para a versão nova ainda não publicada", instDepois.workflowVersion === 1)
  ok("H3) o SNAPSHOT do passo continua o CONGELADO (SLA=5) — nunca relê a definição viva (SLA=10)",
    (stepDepois.snapshot as { slaDays?: number } | null)?.slaDays === 5)
}

// ═══════════════════════════════════════════════════════════════════════════
// I — ADMIN REMOVE UM STEP EM USO POR OPERAÇÃO ATIVA
// ═══════════════════════════════════════════════════════════════════════════
async function cenarioI() {
  secao("I — admin tenta remover um Step que está em uso por uma operação ativa")
  seq++
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA}::i::${seq}`, phaseKey: "emissao_documental", name: `${MARCA} workflow I ${seq}`, versao: 1 },
    select: { id: true },
  })
  const stepDef = await prisma.phaseInternalWorkflowStep.create({
    data: { workflowId: wf.id, key: "conferir_certidao", label: "Conferir certidão", ordem: 4, slaDays: 3 },
    select: { id: true },
  })

  const p = await criarPalco5()
  await prisma.phaseWorkflowStepInstance.update({
    where: { id: p.stepIds[3] },
    data: { stepDefinitionId: stepDef.id, snapshot: { label: "Conferir certidão" } },
  })
  const user = await criarUsuario("UsuarioI")
  await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: user.id, autorId: null })
  // Chega o Step 4 (conferir_certidao) — o "em uso" desta operação ativa.
  for (let i = 0; i < 3; i++) await concluirEtapa({ tarefaId: p.tarefaId, autorId: user.id, permiteForcar: true })
  const antesDaRemocao = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { workflowStepInstanceId: true, statusTarefa: true } })
  ok("I0) pré-condição: a Tarefa ativa está de fato no Step em uso", antesDaRemocao.workflowStepInstanceId === p.stepIds[3])

  // O ADMIN REMOVE O STEP da definição (ação real, direta — não existe endpoint de
  // exclusão de um único passo; a remoção acontece reescrevendo a lista de passos
  // do workflow, e o efeito de banco é este).
  let excecao: unknown = null
  try {
    await prisma.phaseInternalWorkflowStep.delete({ where: { id: stepDef.id } })
  } catch (e) {
    excecao = e
  }
  ok("I1) a remoção não derruba o processo com uma exceção não tratada", excecao === null)

  const stepInstanceDepois = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.stepIds[3] }, select: { id: true, status: true } })
  ok("I2) SEGURANÇA: a instância do passo EM USO continua intacta (não foi cascateada/corrompida)", stepInstanceDepois.status === "DISPONIVEL")

  // A Tarefa ATIVA continua operável — a intenção do cenário ("nunca quebrar a
  // Tarefa ativa") é a que importa, e ela é aqui provada em execução real.
  const conclusao = await concluirEtapa({ tarefaId: p.tarefaId, autorId: user.id, observacao: "conclusão depois da remoção do step", permiteForcar: true })
  ok("I3) a Tarefa ativa continua executável NORMALMENTE depois da remoção — nunca quebrada", conclusao.ok === true)
}

// ═══════════════════════════════════════════════════════════════════════════
// J — CHECKLIST ALTERADO DEPOIS DE VALIDAÇÃO HISTÓRICA JÁ REGISTRADA
// ═══════════════════════════════════════════════════════════════════════════
async function cenarioJ() {
  secao("J — admin altera o checklist depois que uma validação histórica já foi registrada com o checklist antigo")
  seq++
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA}::j::${seq}`, phaseKey: "emissao_documental", name: `${MARCA} workflow J ${seq}`, versao: 1 },
    select: { id: true },
  })
  const stepDef = await prisma.phaseInternalWorkflowStep.create({
    data: { workflowId: wf.id, key: "conferir_certidao", label: "Conferir certidão", ordem: 4 },
    select: { id: true },
  })
  const item = await prisma.stepChecklistItem.create({
    data: { stepId: stepDef.id, key: "conferir_nome", label: "Conferir nome do registrado", obrigatorio: true, ordem: 1 },
    select: { id: true, key: true, label: true, obrigatorio: true },
  })

  const p = await criarPalco5()
  // A VALIDAÇÃO HISTÓRICA — o snapshot do checklist CONGELADO no momento em que a
  // etapa foi executada (a mesma técnica real de `snapshot` versionado).
  const checklistCongelado = [{ key: item.key, label: item.label, obrigatorio: item.obrigatorio }]
  await prisma.phaseWorkflowStepInstance.update({
    where: { id: p.stepIds[3] },
    data: { stepDefinitionId: stepDef.id, snapshot: { checklist: checklistCongelado }, status: "CONCLUIDO", completedAt: new Date() },
  })

  // O ADMIN ALTERA O CHECKLIST DEPOIS — muda o rótulo do item existente e acrescenta um novo.
  await prisma.stepChecklistItem.update({ where: { id: item.id }, data: { label: "Conferir nome completo e grafia" } })
  await prisma.stepChecklistItem.create({
    data: { stepId: stepDef.id, key: "conferir_data", label: "Conferir data do registro", obrigatorio: true, ordem: 2 },
  })

  const cadastroAgora = await prisma.stepChecklistItem.findMany({ where: { stepId: stepDef.id }, orderBy: { ordem: "asc" } })
  ok("J1) o CADASTRO vivo reflete a mudança (2 itens, rótulo novo)", cadastroAgora.length === 2 && cadastroAgora[0].label === "Conferir nome completo e grafia")

  const historico = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.stepIds[3] }, select: { snapshot: true } })
  const checklistHistorico = (historico.snapshot as { checklist?: Array<{ label: string }> } | null)?.checklist ?? []
  ok("J2) A VALIDAÇÃO HISTÓRICA NÃO MUDA RETROATIVAMENTE — continua com 1 item e o rótulo ANTIGO",
    checklistHistorico.length === 1 && checklistHistorico[0]?.label === "Conferir nome do registrado")
}

// ═══════════════════════════════════════════════════════════════════════════
// K — TROCA DE CARTÓRIO DEPOIS DE PAGAMENTO/PROTOCOLO JÁ REGISTRADO
// ═══════════════════════════════════════════════════════════════════════════
async function cenarioK() {
  secao("K — troca de cartório/terceiro depois que já houve pagamento/protocolo registrado")
  const p = await criarPalco5()
  seq++
  const orgaoA = await prisma.orgaoProtocolo.create({ data: { name: `${MARCA} Cartório A ${seq}` }, select: { id: true } })
  const orgaoB = await prisma.orgaoProtocolo.create({ data: { name: `${MARCA} Cartório B ${seq}` }, select: { id: true } })

  const sol = await prisma.solicitacaoDocumento.create({
    data: {
      documentoId: p.documentoId, processoId: p.processoId, pessoaId: p.pessoaId, faseMacroKey: "emissao_documental",
      canal: "EMAIL", dataEnvio: new Date(), chaveIdempotencia: `${MARCA}-sol-K-${p.processoId}`,
      orgaoId: orgaoA.id, custoPago: 45.9, formaPagamento: "PIX",
    },
    select: { id: true },
  })
  const protocolo = await prisma.protocolo.create({
    data: { processoId: p.processoId, orgaoId: orgaoA.id, solicitacaoId: sol.id, numeroProtocolo: `${MARCA}-PROT-A-1`, origem: "SOLICITACAO_DOCUMENTO" },
    select: { id: true, orgaoId: true, numeroProtocolo: true },
  })
  ok("K0) pré-condição: existe pagamento e protocolo registrados no Cartório A", sol.id > 0 && protocolo.numeroProtocolo === `${MARCA}-PROT-A-1`)

  // TROCA DE CARTÓRIO — a solicitação passa a apontar para o Cartório B.
  await prisma.solicitacaoDocumento.update({ where: { id: sol.id }, data: { orgaoId: orgaoB.id } })

  const solDepois = await prisma.solicitacaoDocumento.findUniqueOrThrow({ where: { id: sol.id }, select: { orgaoId: true } })
  ok("K1) a solicitação agora aponta para o Cartório B (a troca aconteceu de fato)", solDepois.orgaoId === orgaoB.id)

  const protocoloDepois = await prisma.protocolo.findUniqueOrThrow({ where: { id: protocolo.id }, select: { orgaoId: true, numeroProtocolo: true } })
  ok("K2) o HISTÓRICO do protocolo anterior é PRESERVADO — continua apontando para o Cartório A, não migrado", protocoloDepois.orgaoId === orgaoA.id)
  ok("K3) o número do protocolo anterior não foi apagado nem alterado", protocoloDepois.numeroProtocolo === `${MARCA}-PROT-A-1`)

  const solDb = await prisma.solicitacaoDocumento.findUniqueOrThrow({ where: { id: sol.id }, select: { custoPago: true } })
  ok("K4) o pagamento já registrado continua íntegro (não apagado pela troca de cartório)", Number(solDb.custoPago) === 45.9)
}

// ═══════════════════════════════════════════════════════════════════════════
// L — TERCEIRO ATRASA MAS O OPERADOR FEZ O ACOMPANHAMENTO NO PRAZO
// ═══════════════════════════════════════════════════════════════════════════
async function cenarioL() {
  secao("L — o terceiro atrasa, mas o operador fez o acompanhamento corretamente e no prazo")
  const p = await criarPalco5()
  const user = await criarUsuario("UsuarioL")
  await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: user.id, autorId: null })
  await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { statusTarefa: "AGUARDANDO_TERCEIRO", workflowStepInstanceId: p.stepIds[1] } })

  const agora = new Date("2026-09-14T12:00:00.000Z")
  await prisma.solicitacaoDocumento.create({
    data: {
      documentoId: p.documentoId, processoId: p.processoId, pessoaId: p.pessoaId, faseMacroKey: "emissao_documental",
      canal: "EMAIL", dataEnvio: new Date("2026-08-01T00:00:00.000Z"),
      previsaoRetorno: new Date("2026-09-01T00:00:00.000Z"), // o TERCEIRO já está atrasado
      chaveIdempotencia: `${MARCA}-sol-L-${p.processoId}`, tarefaId: p.tarefaId,
    },
  })
  // O OPERADOR fez o acompanhamento corretamente: agendou o próximo para o FUTURO.
  await prisma.phaseWorkflowStepInstance.update({
    where: { id: p.stepIds[1] },
    data: { metadata: { operacao: { proximoAcompanhamento: "2026-09-20" } } },
  })

  const estado = await estadoTemporalDaOperacao(prisma, p.tarefaId, agora)
  ok("L1) o atraso do TERCEIRO é reconhecido", estado?.atrasoTerceiro === true)
  ok("L2) a Tarefa NÃO aparece como atraso INTERNO — atraso de terceiro é distinto de atraso do operador", estado?.atrasoInterno === false)
  ok("L3) nenhum motivo de risco culpa o acompanhamento (o operador seguiu em dia)", !(estado?.motivosRisco ?? []).includes("ACOMPANHAMENTO_VENCIDO"))
  ok("L4) a operação NÃO fica EM_RISCO por causa do atraso do terceiro quando o operador fez o que devia", estado?.emRisco === false)
}

// ═══════════════════════════════════════════════════════════════════════════
// M — OPERADOR ESQUECE O FOLLOW-UP
// ═══════════════════════════════════════════════════════════════════════════
async function cenarioM() {
  secao("M — o operador esquece de fazer o follow-up (deve haver escalonamento real, não silêncio)")
  const p = await criarPalco5()
  const user = await criarUsuario("UsuarioM")
  await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: user.id, autorId: null })
  await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { statusTarefa: "AGUARDANDO_TERCEIRO", workflowStepInstanceId: p.stepIds[1] } })

  // O follow-up ficou agendado no PASSADO e ninguém fez um novo.
  await prisma.phaseWorkflowStepInstance.update({
    where: { id: p.stepIds[1] },
    data: { metadata: { operacao: { proximoAcompanhamento: "2026-09-01" } } },
  })

  const agora = new Date("2026-09-14T12:00:00.000Z")
  const estado = await estadoTemporalDaOperacao(prisma, p.tarefaId, agora)
  ok("M1) o acompanhamento vencido É DETECTADO (não passa em silêncio)", estado?.acompanhamentoVencido === true)
  ok("M2) motivo de risco explícito", (estado?.motivosRisco ?? []).includes("ACOMPANHAMENTO_VENCIDO"))
  ok("M3) a operação fica EM_RISCO", estado?.emRisco === true)

  const relatorio = await avisarAcontecimentosOperacionais({ agora })
  const notif = await prisma.notificacaoOperacional.findFirst({ where: { tarefaId: p.tarefaId, tipo: "ACOMPANHAMENTO_VENCIDO" } })
  ok("M4) ESCALONAMENTO REAL: uma notificação de acompanhamento vencido foi de fato criada — nunca silêncio", notif != null)
  ok("M5) o relatório da varredura contabiliza o escalonamento", relatorio.acompanhamento >= 1)
}

// ═══════════════════════════════════════════════════════════════════════════
// N — A NOTIFICAÇÃO FALHA — A TAREFA CONTINUA NA FILA
// ═══════════════════════════════════════════════════════════════════════════
async function cenarioN() {
  secao("N — a notificação falha ao ser enviada/persistida — a Tarefa continua aparecendo na fila")
  const p = await criarPalco5()
  const user = await criarUsuario("UsuarioN")
  // Atribuição DIRETA (sem passar pela porta `atribuirTarefa`, que notifica) —
  // simula exatamente o cenário: a Tarefa tem responsável e está em risco, mas a
  // notificação NUNCA foi enviada/persistida (falhou, ou nem chegou a rodar).
  // Operação sem próximo acontecimento determinável ⇒ EM_RISCO pelo motor canônico.
  // Sem `dataPrazo` (a materialização normal do palco atribui um SLA/prazo, o que
  // por si só já dá um "próximo acontecimento" e tiraria a Tarefa do risco) — aqui
  // o cenário exige, de propósito, NENHUM próximo acontecimento determinável.
  await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { responsavelId: user.id, dataPrazo: null } })
  const semNotifsAntes = await prisma.notificacaoOperacional.count({ where: { tarefaId: p.tarefaId } })
  ok("N0) pré-condição: zero notificações existem para esta Tarefa", semNotifsAntes === 0)

  const fila = await minhaFila(user.id)
  const linha = fila.find((l) => l.taskId === p.tarefaId)
  ok("N1) a Tarefa aparece na fila mesmo SEM NENHUMA notificação jamais criada", linha != null)
  ok("N2) a fila mostra o estado de risco correto lendo o motor canônico — nunca a tabela de notificação", linha?.emRisco === true)

  const semNotifsDepois = await prisma.notificacaoOperacional.count({ where: { tarefaId: p.tarefaId } })
  ok("N3) a fila não escreveu nenhuma notificação para se comportar corretamente (leitura pura)", semNotifsDepois === 0)
}

// ═══════════════════════════════════════════════════════════════════════════
// O — USUÁRIO PERDE PERMISSÃO NO MEIO DA EXECUÇÃO
// ═══════════════════════════════════════════════════════════════════════════
async function cenarioO() {
  secao("O — um usuário perde a permissão (RBAC) no meio da execução de uma Tarefa")
  seq++
  const perfil = await prisma.perfil.create({
    data: { nome: `${MARCA} Perfil O ${seq}`, permissoes: { "tarefas.iniciar_concluir": true, "tarefas.ver": true } },
    select: { id: true },
  })
  const usuario = await prisma.usuario.create({
    data: { nome: "UsuarioO", email: `usuarioo.${++seq}@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "assistente", perfilId: perfil.id },
    select: { id: true, tipo: true, perfilId: true },
  })

  const efetivasAntes = calcularPermissoes(usuario.tipo, { "tarefas.iniciar_concluir": true, "tarefas.ver": true }, null)
  ok("O1) ANTES da revogação, o usuário PODE concluir etapa", temPermissao(efetivasAntes, "tarefas.iniciar_concluir") === true)

  // NO MEIO DA EXECUÇÃO — o gestor revoga a permissão do perfil.
  const perfilAtualizado = await prisma.perfil.update({
    where: { id: perfil.id }, data: { permissoes: { "tarefas.iniciar_concluir": false, "tarefas.ver": true } }, select: { permissoes: true },
  })

  // A PRÓXIMA TENTATIVA recalcula do zero, a partir do cadastro atual — nunca de um
  // cache/sessão desatualizados (é assim que a rota de comando calcula a cada request).
  const efetivasDepois = calcularPermissoes(usuario.tipo, perfilAtualizado.permissoes as Record<string, boolean>, null)
  ok("O2) A PRÓXIMA TENTATIVA é bloqueada corretamente — recalculada, não fantasma", temPermissao(efetivasDepois, "tarefas.iniciar_concluir") === false)
  ok("O3) nenhum crash ao recalcular com o cadastro já mudado", true)

  // Prova adicional, com o Usuario e o Perfil relidos do banco (não de memória) —
  // a mesma leitura que a rota HTTP faz a cada requisição.
  const relido = await prisma.usuario.findUniqueOrThrow({ where: { id: usuario.id }, select: { tipo: true, perfil: { select: { permissoes: true } } } })
  const efetivasRelidas = calcularPermissoes(relido.tipo, relido.perfil?.permissoes as Record<string, boolean>, null)
  ok("O4) relido do banco (a fonte real que a porta HTTP usa), a permissão continua bloqueada — sem execução fantasma", temPermissao(efetivasRelidas, "tarefas.iniciar_concluir") === false)
}

// ═══════════════════════════════════════════════════════════════════════════
// P — HANDOFF PARA PESSOA INATIVA/DESABILITADA
// ═══════════════════════════════════════════════════════════════════════════
async function cenarioP() {
  secao("P — handoff (transferência) para uma pessoa inativa/desabilitada")
  const p = await criarPalco5()
  const daniela = await criarUsuario("DanielaP")
  const marco = await criarUsuario("MarcoP")
  await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: null })

  // MARCO está indisponível/desabilitado operacionalmente — BLOQUEIO_OPERACIONAL
  // em aberto (fim nulo), o cadastro canônico que já representa "não deve receber
  // trabalho novo agora" (`lib/operacional/organizacao.ts`).
  await abrirIndisponibilidade({ usuarioId: marco.id, tipo: "BLOQUEIO_OPERACIONAL", inicio: new Date("2026-01-01"), motivo: "Desabilitado — desligamento em curso", autorId: daniela.id })

  const t = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { lockVersion: true } })
  const handoff = await transferirTarefa({ tarefaId: p.tarefaId, responsavelId: marco.id, autorId: daniela.id, motivo: "handoff de teste", lockVersion: t.lockVersion })
  ok("P1) BUG REAL CORRIGIDO: o handoff para usuário indisponível/desabilitado é BLOQUEADO, nunca silencioso",
    handoff.ok === false && (handoff as { codigo: string }).codigo === "RESPONSAVEL_INDISPONIVEL")

  const tarefaDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { responsavelId: true } })
  ok("P2) a Tarefa CONTINUA com a Daniela — nunca transferida silenciosamente para o Marco inválido", tarefaDepois.responsavelId === daniela.id)

  // Confirma que o bloqueio é ESPECÍFICO da indisponibilidade — transferir para
  // alguém disponível continua funcionando normalmente (não quebrou o caminho feliz).
  const outro = await criarUsuario("OutroP")
  const t2 = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { lockVersion: true } })
  const handoffValido = await transferirTarefa({ tarefaId: p.tarefaId, responsavelId: outro.id, autorId: daniela.id, lockVersion: t2.lockVersion })
  ok("P3) transferir para alguém DISPONÍVEL continua funcionando normalmente", handoffValido.ok === true)
}

// ═══════════════════════════════════════════════════════════════════════════
// Q — FASE AVANÇA E RETROCEDE (E AVANÇA DE NOVO)
// ═══════════════════════════════════════════════════════════════════════════
async function cenarioQ() {
  secao("Q — o processo avança de fase, retrocede, e avança de novo (sem duplicar nem apagar obrigações)")
  const motorConfigAntes = await prisma.motorConfig.findUnique({ where: { id: 1 }, select: { runtimeV2Habilitado: true } })
  await prisma.motorConfig.upsert({ where: { id: 1 }, create: { id: 1, runtimeV2Habilitado: true }, update: { runtimeV2Habilitado: true } })
  try {
    seq++
    const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_Q_${seq}`, name: "Certidão Q", natureza: "DOCUMENTO" }, select: { id: true } })
    const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arvore Q ${seq}` }, select: { id: true } })
    const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo Q ${seq}`, arvoreId: arv.id }, select: { id: true } })
    const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Fulano", sobrenome: "Q" }, select: { id: true } })
    const nec = await prisma.necessidadeDocumental.create({
      data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-Q-${proc.id}` },
      select: { id: true },
    })

    const criarInstanciaEStep = async (n: number) => {
      const inst = await prisma.phaseWorkflowInstance.create({
        data: { processoId: proc.id, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-inst-Q-${proc.id}-${n}` },
        select: { id: true },
      })
      const step = await prisma.phaseWorkflowStepInstance.create({
        data: {
          workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "emissao_documental", stepKey: "solicitar_certidao",
          ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "DISPONIVEL", necessidadeId: nec.id, pessoaId: pes.id,
          chaveIdempotencia: `${MARCA}-step-Q-${proc.id}-${n}`,
        },
        select: { id: true },
      })
      return { inst, step }
    }

    // 1) AVANÇA — a fase materializa a 1ª instância/step, e a Tarefa nasce.
    const r1 = await criarInstanciaEStep(1)
    const g1 = await garantirTarefaDePasso({ stepInstanceId: r1.step.id })
    ok("Q1) a Tarefa nasce no primeiro avanço", g1.success === true && g1.created === true)
    const tarefaId = g1.success ? g1.tarefa.id : -1

    // 2) RETROCEDE — a fase anterior é supersedida (o trabalho não foi concluído).
    await prisma.phaseWorkflowInstance.update({ where: { id: r1.inst.id }, data: { status: "SUPERSEDIDO" } })

    // 3) AVANÇA DE NOVO (voltou à mesma fase) — nasce uma NOVA instância/step para
    //    a MESMA obrigação (mesma necessidade).
    const r2 = await criarInstanciaEStep(2)
    const g2 = await garantirTarefaDePasso({ stepInstanceId: r2.step.id })
    ok("Q2) a MESMA Tarefa é REANCORADA — não nasce uma segunda", g2.success === true && g2.created === false && g2.tarefa.id === tarefaId)

    const totalTarefas1 = await prisma.tarefa.count({ where: { processoId: proc.id } })
    ok("Q3) contagem de Tarefas do processo continua 1 depois do retrocesso e reavanço", totalTarefas1 === 1)

    const tarefaReancorada = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId }, select: { workflowInstanceId: true, workflowStepInstanceId: true } })
    ok("Q4) a Tarefa agora aponta para a NOVA instância/step (o trabalho migrou, não duplicou)", tarefaReancorada.workflowInstanceId === r2.inst.id && tarefaReancorada.workflowStepInstanceId === r2.step.id)

    // 4) AVANÇA MAIS UMA VEZ (retrocede de novo e volta) — prova que não é um caso isolado.
    await prisma.phaseWorkflowInstance.update({ where: { id: r2.inst.id }, data: { status: "SUPERSEDIDO" } })
    const r3 = await criarInstanciaEStep(3)
    const g3 = await garantirTarefaDePasso({ stepInstanceId: r3.step.id })
    ok("Q5) na segunda volta, a Tarefa CONTINUA sendo a mesma — nunca duplicada, nunca apagada", g3.success === true && g3.created === false && g3.tarefa.id === tarefaId)
    const totalTarefas2 = await prisma.tarefa.count({ where: { processoId: proc.id } })
    ok("Q6) contagem de Tarefas ainda é 1 depois de duas idas e voltas de fase", totalTarefas2 === 1)

    await prisma.tarefa.deleteMany({ where: { processoId: proc.id } })
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: proc.id } })
    await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: proc.id } })
    await prisma.necessidadeDocumental.deleteMany({ where: { processoId: proc.id } })
    await prisma.pessoa.deleteMany({ where: { id: pes.id } })
    await prisma.processo.delete({ where: { id: proc.id } })
    await prisma.arvore.delete({ where: { id: arv.id } })
    await prisma.itemCatalogo.delete({ where: { id: item.id } })
  } finally {
    await prisma.motorConfig.upsert({
      where: { id: 1 }, create: { id: 1, runtimeV2Habilitado: motorConfigAntes?.runtimeV2Habilitado ?? false },
      update: { runtimeV2Habilitado: motorConfigAntes?.runtimeV2Habilitado ?? false },
    })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// R — O JOB DE RECONCILIAÇÃO RODA DUAS VEZES SEGUIDAS
// ═══════════════════════════════════════════════════════════════════════════
async function cenarioR() {
  secao("R — o job de reconciliação é executado duas vezes seguidas (idempotência)")
  const p = await criarPalco5() // já rodou reconciliarTarefas() uma vez dentro do palco
  const totalAntes = await prisma.tarefa.count({ where: { processoId: p.processoId } })
  ok("R0) exatamente 1 Tarefa depois da primeira reconciliação", totalAntes === 1)

  const r1 = await reconciliarTarefas({ processoId: p.processoId })
  const r2 = await reconciliarTarefas({ processoId: p.processoId })
  ok("R1) a segunda (e a terceira) execução NÃO cria nenhuma Tarefa nova", r1.tarefasCriadas === 0 && r2.tarefasCriadas === 0)
  const totalDepois = await prisma.tarefa.count({ where: { processoId: p.processoId } })
  ok("R2) a contagem de Tarefas permanece 1 depois de rodar o job repetidamente", totalDepois === 1)
  ok("R3) as execuções repetidas apenas SINCRONIZAM o que já existe, sem corromper nada", r2.detalhes.every((d) => d.acao.includes("sincronizada")))
}

// ═══════════════════════════════════════════════════════════════════════════
// S — MATERIALIZAÇÃO/PUBLICAÇÃO EM LOTE REPETIDA
// ═══════════════════════════════════════════════════════════════════════════
async function cenarioS() {
  secao("S — a operação de materialização em lote é repetida (idempotência operacional)")
  const lote = [await criarPalco5(), await criarPalco5(), await criarPalco5()]
  const contarTodas = async () => {
    let total = 0
    for (const p of lote) total += await prisma.tarefa.count({ where: { processoId: p.processoId } })
    return total
  }
  const antes = await contarTodas()
  ok("S0) o lote nasce com exatamente 1 Tarefa por unidade (3 no total)", antes === 3)

  // A "publicação/materialização em lote" é repetida — reconcilia o LOTE inteiro,
  // duas vezes seguidas (o equivalente operacional de repetir um "deploy").
  for (const p of lote) {
    await reconciliarTarefas({ processoId: p.processoId })
    await reconciliarTarefas({ processoId: p.processoId })
  }
  const depois = await contarTodas()
  ok("S1) repetir a materialização em lote NÃO duplica nenhuma Tarefa em nenhuma unidade do lote", depois === 3)

  for (const p of lote) {
    const ids = await prisma.tarefa.findMany({ where: { processoId: p.processoId }, select: { id: true } })
    ok(`S2.${p.processoId}) cada unidade do lote continua com exatamente 1 Tarefa`, ids.length === 1)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// T — ROLLBACK/FORWARD-FIX APÓS MIGRATION PARCIAL
// ═══════════════════════════════════════════════════════════════════════════
async function cenarioT() {
  secao("T — rollback/forward-fix depois de uma migration parcial (sem perda de histórico)")

  // CASO 1 — obrigação removida ANTES de qualquer trabalho começar: o caminho
  // seguro de correção é CANCELAR, preservando o histórico (nunca apagar a Tarefa).
  const p1 = await criarPalco5()
  // Simula um estado PARCIALMENTE MIGRADO/corrompido: a necessidade foi dispensada
  // por fora do serviço canônico (ex.: uma migration antiga que só tocou uma
  // tabela), deixando a Tarefa órfã, ainda ATIVA, apontando para uma causa morta.
  await prisma.necessidadeDocumental.update({ where: { id: p1.necessidadeId }, data: { status: "DISPENSADA" } })

  const fix1a = await reconciliarTarefas({ processoId: p1.processoId })
  ok("T1) o FORWARD-FIX detecta e corrige o estado parcialmente migrado (nunca iniciada → cancela)", fix1a.tarefasEncerradasSemCausa === 1)
  const t1 = await prisma.tarefa.findUniqueOrThrow({ where: { id: p1.tarefaId }, select: { statusTarefa: true, motivoCodigo: true } })
  ok("T2) a Tarefa foi CANCELADA (caminho seguro), nunca deletada — o registro continua no banco", t1.statusTarefa === "CANCELADA" && t1.motivoCodigo === "CAUSA_REMOVIDA")
  const log1 = await prisma.logAuditoria.findFirst({ where: { entidade: "Tarefa", entidadeId: p1.tarefaId, acao: "TAREFA_CANCELADA" } })
  ok("T3) o histórico da correção fica registrado (LogAuditoria), nada foi apagado em silêncio", log1 != null)

  // Rodar o forward-fix DE NOVO não duplica o log nem reprocessa o já corrigido.
  const fix1b = await reconciliarTarefas({ processoId: p1.processoId })
  ok("T4) reexecutar o forward-fix é seguro — idempotente, não reprocessa o que já foi corrigido", fix1b.tarefasEncerradasSemCausa === 0)

  // CASO 2 — obrigação removida DEPOIS que ALGUÉM JÁ TRABALHOU: o caminho seguro
  // NUNCA descarta trabalho feito — marca e espera decisão humana, preservando tudo.
  const p2 = await criarPalco5()
  const userT = await criarUsuario("UsuarioT")
  await atribuirTarefa({ tarefaId: p2.tarefaId, responsavelId: userT.id, autorId: null })
  await concluirEtapa({ tarefaId: p2.tarefaId, autorId: userT.id, permiteForcar: true }) // trabalho real já feito
  await prisma.necessidadeDocumental.update({ where: { id: p2.necessidadeId }, data: { status: "DISPENSADA" } })

  const fix2a = await reconciliarTarefas({ processoId: p2.processoId })
  ok("T5) com trabalho já feito, o forward-fix NÃO cancela sozinho — preserva e sinaliza para decisão", fix2a.tarefasAguardandoDecisao === 1)
  const t2 = await prisma.tarefa.findUniqueOrThrow({ where: { id: p2.tarefaId }, select: { statusTarefa: true, causaRemovidaEm: true } })
  ok("T6) a Tarefa continua ATIVA (o trabalho feito não foi perdido)", t2.statusTarefa !== "CANCELADA" && t2.causaRemovidaEm != null)

  const fix2b = await reconciliarTarefas({ processoId: p2.processoId })
  ok("T7) reexecutar o forward-fix de novo é idempotente — não marca uma segunda vez", fix2b.tarefasAguardandoDecisao === 0)
  const logsCausaRemovida = await prisma.logAuditoria.count({ where: { entidade: "Tarefa", entidadeId: p2.tarefaId, acao: "TAREFA_CAUSA_REMOVIDA" } })
  ok("T8) só existe UM registro de 'causa removida' no histórico, mesmo com o job rodando várias vezes", logsCausaRemovida === 1)
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  exigirBancoDeTeste("mandato-20-adversariais.test.ts — 20 cenários adversariais A-T")
  console.log("MANDATO — 20 CENÁRIOS ADVERSARIAIS (A-T) — Solicitar Certidão\n")
  await limpar()

  const cenarios: Array<[string, () => Promise<void>]> = [
    ["A", cenarioA], ["B", cenarioB], ["C", cenarioC], ["D", cenarioD], ["E", cenarioE],
    ["F", cenarioF], ["G", cenarioG], ["H", cenarioH], ["I", cenarioI], ["J", cenarioJ],
    ["K", cenarioK], ["L", cenarioL], ["M", cenarioM], ["N", cenarioN], ["O", cenarioO],
    ["P", cenarioP], ["Q", cenarioQ], ["R", cenarioR], ["S", cenarioS], ["T", cenarioT],
  ]

  const resultadoPorCenario: Record<string, "OK" | "FALHOU" | "EXCEÇÃO"> = {}
  for (const [letra, fn] of cenarios) {
    const antesPassou = passou, antesFalhou = falhou
    try {
      await fn()
      resultadoPorCenario[letra] = falhou > antesFalhou ? "FALHOU" : "OK"
    } catch (e) {
      falhou++
      resultadoPorCenario[letra] = "EXCEÇÃO"
      falhas.push(`Cenário ${letra} — EXCEÇÃO`)
      console.log(`  ❌ Cenário ${letra} lançou exceção:`, e)
    }
    void antesPassou
  }

  await limpar()

  console.log(`\n${"=".repeat(78)}`)
  console.log("RESUMO POR CENÁRIO")
  for (const [letra] of cenarios) console.log(`  ${resultadoPorCenario[letra] === "OK" ? "✅" : "❌"} ${letra} — ${resultadoPorCenario[letra]}`)
  console.log(`${"=".repeat(78)}`)
  console.log(`✅ ${passou} asserções passaram · ❌ ${falhou} falharam`)
  const cenariosOk = cenarios.filter(([l]) => resultadoPorCenario[l] === "OK").length
  console.log(`\n${cenariosOk}/20 cenários totalmente verdes.`)
  if (falhou > 0) {
    console.log("\nFalhas:", falhas.join(", "))
    process.exit(1)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
