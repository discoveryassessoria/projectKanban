// scripts/central-certidao-cancelada-continua-na-lista.test.ts
// ============================================================================
// CANCELAR NUNCA ESCONDE, SÓ MARCA (Torre de Controle, seção 5 — 30/09/2026).
//
//   node scripts/ci/gate-build.mjs --so central-certidao-cancelada
//
// Uma certidão CANCELADA (decisão humana) ou NÃO EXIGIDA (a árvore deixou de exigir) CONTINUA na lista da pessoa — na
// Central Operacional do processo, na aba Documentos e no Foco da família —, esmaecida, no fim, dizendo quem, quando e por
// quê; NÃO conta em requeridas, pendentes nem prontas; o filtro "Cancelada" LISTA (antes ficava vazio: o roteiro inteiro
// cancelado fazia a certidão sumir da consulta); "Reabrir" só onde a porta permite; a aba Tarefas da Torre continua sem elas.
// Tudo contra as portas reais: PUT /api/pessoas (casado), "Cancelar operação", rotas /documentos e /reabrir-certidao.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("central-certidao-cancelada-continua-na-lista.test.ts")

import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { criarPalco } from "./_fixture-arvore-fonte"
import { getPhaseOperationalSummary } from "../src/lib/process-stage/estrutura-operacional"
import { controlarOperacaoV2 } from "../src/services/documento-operacao"
import { documentacaoRequeridaDoProcesso } from "../src/lib/process-stage/documentacao-requerida"
import { focoDaFamilia } from "../lib/operacional/torre-foco"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { prioridadeDoEventoDeVida } from '../src/lib/documentos/ordem-evento-vida'
import { passaNoRecorte, ordenarDocumentos, recorteDoKpi, estaEncerrada, RECORTE_VAZIO, type Recorte } from "../src/components/kanban/PainelDaFase"
import type { DocumentoDoIndice } from "../src/lib/process-stage/estrutura-operacional-core"
import { GET as getDocumentos } from "../src/app/api/processos/[processoId]/documentos/route"
import { POST as postReabrir } from "../src/app/api/processos/[processoId]/reabrir-certidao/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "CERTCANC"

async function main() {
  const P = criarPalco(MARCA)
  await P.montar()
  try {
    const c = await P.novoCenario("casal", { conjuge: true })
    const tarefaReq = (url: string, method: string, body?: unknown) => new NextRequest(`http://localhost${url}`, { method, headers: { Authorization: `Bearer ${P.token}`, "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    const ctxRota = { params: Promise.resolve({ processoId: String(c.processoId) }) }
    const indice = async () => (await getPhaseOperationalSummary({ processoId: c.processoId, faseMacroKey: "genealogia", workflowInstanceId: c.instanciaId })).indice
    const linhas = async (): Promise<DocumentoDoIndice[]> => { const i = await indice(); return [...i.linhaPrincipal, ...i.foraDaLinha, ...i.pendenteClassificacao].flatMap((p) => p.documentos).concat(i.semDono) }

    // ── um casal + a certidão de casamento (que a árvore exige); o titular tem nascimento e a certidão do requerente ──
    await P.putPessoa(c.titularId, { casado: true })
    await P.postUniao(c.titularId, c.conjugeId!)
    const f0 = await P.foto(c.processoId)
    const docs0 = await linhas()
    console.log("   linhas na Central:", docs0.map((d) => `${d.titulo}=${d.naFase.estado}`).join(" | "))
    ok("(pré) a árvore gerou as certidões e todas aparecem ATIVAS na Central", docs0.length >= 3 && docs0.every((d) => !estaEncerrada(d) && d.encerramento === null))
    const requeridasAntes = (await documentacaoRequeridaDoProcesso(c.processoId)).requeridos

    // ════════════ CANCELADA — sem nenhuma etapa concluída (o caso em que a certidão SUMIA) ════════════
    secao("Cancelada: decisão humana, pela porta 'Cancelar operação' — o roteiro INTEIRO cancelado")
    const nasc = f0.docs.find((d) => d.pessoaId === c.titularId && f0.necs.find((n) => n.id === d.necessidadeId)?.cod === "NAS")!
    const tarefaNasc = await prisma.tarefa.findFirstOrThrow({ where: { documentoId: nasc.id }, select: { id: true, statusTarefa: true } })
    const ctxOp = { usuarioId: P.adminId, permissoes: { "tarefas.excluir": true, "workflow.iniciarPasso": true, "tarefas.bloquear": true }, isAdmin: true } as never
    const r = await controlarOperacaoV2(nasc.id, "cancelar", "Motivo: Documento não necessário · Justificativa: Não trava o avanço do processo", ctxOp)
    ok("cancelar operação pela porta real", (r as { ok: boolean }).ok === true, JSON.stringify(r).slice(0, 140))
    const passosDoDoc = await prisma.phaseWorkflowStepInstance.findMany({ where: { documentoId: nasc.id }, select: { status: true } })
    ok("(o caso do bug) nenhum passo do documento sobreviveu ativo nem concluído: todos CANCELADO", passosDoDoc.length > 0 && passosDoDoc.every((p) => p.status === "CANCELADO"), passosDoDoc.map((p) => p.status).join(","))

    const depois = await linhas()
    const linha = depois.find((d) => d.documentoId === nasc.id)
    ok("a certidão CONTINUA na lista da pessoa (antes sumia da Central)", !!linha, depois.map((d) => d.titulo).join(" | "))
    ok("estado Cancelada — nunca Concluída —, statusFinal CANCELADO, rótulo 'Cancelada'", linha?.naFase.estado === "CANCELADA" && linha.statusFinal === "CANCELADO" && linha.naFase.estadoLabel === "Cancelada")
    ok("quem · quando · por quê (parseado do texto do modal): Marco · agora · Motivo + Justificativa", linha?.encerramento?.tipo === "CANCELADA" && linha.encerramento.porNome === `${MARCA} Marco Rovatti` && linha.encerramento.motivo === "Documento não necessário" && linha.encerramento.justificativa === "Não trava o avanço do processo" && !!linha.encerramento.quando && Math.abs(Date.now() - Date.parse(linha.encerramento.quando as string)) < 120_000, JSON.stringify(linha?.encerramento))
    ok("o 'quando' vem pronto do servidor, em São Paulo ('hoje HH:MM') — a tela não consulta relógio", /^hoje \d{2}:\d{2}$/.test(linha?.encerramento?.quandoRotulo ?? ""), linha?.encerramento?.quandoRotulo ?? "")
    ok("'Reabrir' disponível: aponta a tarefa cancelada por uma pessoa", linha?.encerramento?.tarefaReabrivelId === tarefaNasc.id)
    ok("sem progresso/etapa/responsável/prazo de trabalho (não é trabalho)", linha?.naFase.etapaAtual == null && linha?.naFase.prazo == null && linha?.naFase.responsavelId == null)

    const i1 = await indice()
    const pessoa = [...i1.linhaPrincipal, ...i1.foraDaLinha].find((p) => p.documentos.some((d) => d.documentoId === nasc.id))!
    ok("o cartão da pessoa conta 'N cancelada(s)' à parte", pessoa.totais.cancelados === 1 && pessoa.totais.naoExigidos === 0, JSON.stringify(pessoa.totais))
    ok("NÃO conta em prontas nem em pendentes; a soma fecha (documentos = prontos+pendentes+divergentes+cancelados+naoExigidos)",
      pessoa.totais.documentos === pessoa.totais.prontos + pessoa.totais.pendentes + pessoa.totais.divergentes + pessoa.totais.cancelados + pessoa.totais.naoExigidos
      && !depois.filter((d) => d.documentoId !== nasc.id).some((d) => d.statusFinal === "CANCELADO"))
    ok("requeridas (fonte única) caiu em 1: a cancelada não é mais exigida", (await documentacaoRequeridaDoProcesso(c.processoId)).requeridos === requeridasAntes - 1, `${requeridasAntes} → ${(await documentacaoRequeridaDoProcesso(c.processoId)).requeridos}`)

    secao("O filtro de status da Central: 'Todos (incl. canceladas)' · 'Só ativas' · 'Cancelada'")
    const passa = (rec: Partial<Recorte>, d: DocumentoDoIndice) => passaNoRecorte(d, { ...RECORTE_VAZIO, ...rec }, "")
    ok("'Todos os status (incl. canceladas)' (padrão) mostra a cancelada", passa({}, linha!))
    ok("'Cancelada' LISTA (era o filtro que ficava vazio)", depois.filter((d) => passa({ estado: "CANCELADA" }, d)).map((d) => d.documentoId).join() === String(nasc.id))
    ok("'Só ativas' esconde a cancelada e deixa o trabalho", !passa({ estado: "ATIVAS" }, linha!) && depois.filter((d) => d.documentoId !== nasc.id).every((d) => passa({ estado: "ATIVAS" }, d)))
    ok("o cartão 'Cancelados' do topo é o MESMO recorte (lista = contador)", recorteDoKpi("Cancelados") === "cancelados" && depois.filter((d) => passa({ rapido: "cancelados" }, d)).length === i1.resumo.cancelados)
    ok("'Sem responsável' não conta a cancelada", !passa({ rapido: "sem_responsavel" }, linha!))
    const ordem = ordenarDocumentos(depois)
    const prio = (d: { titulo: string }) => prioridadeDoEventoDeVida(d.titulo)
    ok("na lista a cancelada fica NO LUGAR que a regra fixa manda (Nascimento, Casamento, Óbito, outros) — o status não a leva para o fim", ordem.some((d) => d.documentoId === nasc.id) && ordem.every((d, i) => i === 0 || prio(d) >= prio(ordem[i - 1])) && ordem.length === depois.length && ordenarDocumentos([...depois].reverse()).map((d) => d.chave).join() === ordem.map((d) => d.chave).join())

    // ════════════ NÃO EXIGIDA — a árvore deixou de exigir ════════════
    secao("Não exigida: a árvore mudou (desmarcar 'casado') — o documento fica, não conta, e diz por quê")
    await P.putPessoa(c.titularId, { casado: false })
    const fN = await P.foto(c.processoId)
    const docCas = fN.docs.find((d) => d.status === "NAO_EXIGIDO")!
    ok("(pré) o motor da árvore deixou o documento NAO_EXIGIDO (não apagado)", !!docCas)
    const lN = (await linhas()).find((d) => d.documentoId === docCas.id)
    ok("a certidão NÃO EXIGIDA continua na lista", !!lN)
    ok("estado 'Não exigida' (não 'Cancelada'), statusFinal NAO_EXIGIDO", lN?.naFase.estado === "NAO_EXIGIDA" && lN.statusFinal === "NAO_EXIGIDO" && lN.naFase.estadoLabel === "Não exigida")
    ok("o motivo vem da árvore, sem o prefixo técnico: 'pessoa deixou de ser casada'", lN?.encerramento?.tipo === "NAO_EXIGIDA" && /deixou de ser casada/.test(lN.encerramento.motivo ?? "") && !/necessidade removida pela árvore/i.test(lN.encerramento.motivo ?? ""), lN?.encerramento?.motivo ?? "")
    ok("quem mudou a árvore (Marco) e quando", lN?.encerramento?.porNome === `${MARCA} Marco Rovatti` && !!lN.encerramento.quando)
    ok("NÃO há 'Reabrir' (tarefaReabrivelId nulo) e a linha diz por quê: quem decide é a árvore", lN?.encerramento?.tarefaReabrivelId === null && /árvore/i.test(lN.encerramento.observacao ?? ""))
    const i2 = await indice()
    ok("resumo: 1 cancelada + 1 não exigida, cada uma no seu balde; nenhuma em prontos/pendentes", i2.resumo.cancelados === 1 && i2.resumo.naoExigidos === 1 && i2.resumo.documentos === i2.resumo.prontos + i2.resumo.pendentes + i2.resumo.divergentes + i2.resumo.cancelados + i2.resumo.naoExigidos, JSON.stringify(i2.resumo))
    ok("filtro 'Não exigida' lista só ela · 'Só ativas' tira as duas · o cartão 'Não exigidos' é o mesmo recorte",
      (await linhas()).filter((d) => passa({ estado: "NAO_EXIGIDA" }, d)).map((d) => d.documentoId).join() === String(docCas.id)
      && (await linhas()).filter((d) => passa({ estado: "ATIVAS" }, d)).every((d) => !estaEncerrada(d)) && recorteDoKpi("Não exigidos") === "nao_exigidos")

    // ════════════ ABA DOCUMENTOS ════════════
    secao("Aba Documentos: a rota devolve as duas na lista da pessoa, com quem/quando/por quê")
    const rDocs = await getDocumentos(tarefaReq(`/api/processos/${c.processoId}/documentos`, "GET"), ctxRota)
    const corpo = await rDocs.json()
    const todos = [...corpo.linhaPrincipal, ...corpo.conjuges, ...corpo.outros].flatMap((p: { docs: Array<{ id: number; status: string; encerramento: { tipo: string; porNome: string | null; motivo: string | null; tarefaReabrivelId: number | null } | null }> }) => p.docs) as Array<{ id: number; status: string; encerramento: { tipo: string; porNome: string | null; motivo: string | null; tarefaReabrivelId: number | null } | null }>
    type DocRota = { id: number; status: string; encerramento: { tipo: string; porNome: string | null; motivo: string | null; tarefaReabrivelId: number | null } | null }
    const dCanc = todos.find((d: DocRota) => d.id === nasc.id) as DocRota
    const dNE = todos.find((d: DocRota) => d.id === docCas.id) as DocRota
    ok("GET /documentos: 200 e os dois documentos vêm na lista (nada some)", rDocs.status === 200 && !!dCanc && !!dNE)
    ok("cancelada: encerramento CANCELADA com Marco, motivo e a tarefa reabrível", dCanc.encerramento?.tipo === "CANCELADA" && dCanc.encerramento.porNome === `${MARCA} Marco Rovatti` && dCanc.encerramento.motivo === "Documento não necessário" && dCanc.encerramento.tarefaReabrivelId === tarefaNasc.id)
    ok("não exigida: encerramento NAO_EXIGIDA, sem tarefa reabrível", dNE.encerramento?.tipo === "NAO_EXIGIDA" && dNE.encerramento.tarefaReabrivelId === null)
    ok("documento ATIVO não carrega encerramento", todos.filter((d: { id: number }) => d.id !== nasc.id && d.id !== docCas.id).every((d: { encerramento: unknown }) => d.encerramento === null))
    ok("a contagem de 'requeridos' da rota é a FONTE ÚNICA (não conta as duas)", corpo.documentacao.requeridos === (await documentacaoRequeridaDoProcesso(c.processoId)).requeridos)

    // ════════════ TORRE: aba Tarefas e Foco ════════════
    secao("Torre: a aba Tarefas não lista canceladas; o Foco da família as mostra, marcadas")
    const tarefasTorre = (await listarTarefasDaTorre({ processoId: c.processoId })).linhas
    ok("aba Tarefas: a tarefa da cancelada NÃO aparece (cancelada não é trabalho)", !tarefasTorre.some((l) => l.taskId === tarefaNasc.id))
    const foco = (await focoDaFamilia(c.processoId))!
    ok("Foco: os 4 números não contam as encerradas", foco.numeros.abertas === tarefasTorre.length && !foco.tarefas.some((l) => l.taskId === tarefaNasc.id))
    ok("Foco: mostra a cancelada E a não exigida, marcadas, com quem/quando/por quê", foco.encerradas.length === 2 && foco.encerradas.some((e) => e.documentoId === nasc.id && e.tipo === "CANCELADA" && e.encerramento?.porNome === `${MARCA} Marco Rovatti`) && foco.encerradas.some((e) => e.documentoId === docCas.id && e.tipo === "NAO_EXIGIDA"), JSON.stringify(foco.encerradas.map((e) => [e.titulo, e.tipo])))

    // ════════════ REABRIR ════════════
    secao("Reabrir: só onde a porta permite")
    const reabrir = (tarefaId: number, motivo: string) => postReabrir(tarefaReq(`/api/processos/${c.processoId}/reabrir-certidao`, "POST", { tarefaId, motivo }), ctxRota)
    const tarefaCas = await prisma.tarefa.findFirstOrThrow({ where: { documentoId: docCas.id }, select: { id: true } })
    const rNE = await reabrir(tarefaCas.id, "a árvore errou, reabrir")
    ok("NÃO EXIGIDA: a porta recusa (409, NAO_EXIGIDA_PELA_ARVORE) — quem decide é a árvore", rNE.status === 409 && (await rNE.json()).codigo === "NAO_EXIGIDA_PELA_ARVORE")
    const requeridasAntesDeReabrir = (await documentacaoRequeridaDoProcesso(c.processoId)).requeridos
    const rOk = await reabrir(tarefaNasc.id, "cancelamento indevido — a certidão é necessária")
    ok("CANCELADA: reabre (200), a MESMA tarefa", rOk.status === 200 && (await rOk.json()).tarefaId === tarefaNasc.id)
    const linhaV = (await linhas()).find((d) => d.documentoId === nasc.id)
    ok("a certidão voltou a ser TRABALHO na lista (não mais Cancelada), documento PENDENTE, requeridas de volta", !!linhaV && !estaEncerrada(linhaV) && linhaV.encerramento === null
      && (await prisma.documento.findUniqueOrThrow({ where: { id: nasc.id }, select: { status: true } })).status === "PENDENTE"
      && (await documentacaoRequeridaDoProcesso(c.processoId)).requeridos === requeridasAntesDeReabrir + 1, `${linhaV?.naFase.estado} · requeridas ${requeridasAntesDeReabrir} → ${(await documentacaoRequeridaDoProcesso(c.processoId)).requeridos}`)
    const i3 = await indice()
    ok("e a não exigida segue fora (1 não exigida; nenhuma cancelada)", i3.resumo.cancelados === 0 && i3.resumo.naoExigidos === 1)
  } finally {
    await P.limpar()
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
