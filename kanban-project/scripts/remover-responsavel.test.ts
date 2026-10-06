// scripts/remover-responsavel.test.ts
// ============================================================================
// "REMOVER RESPONSÁVEL" (L4, 06/10/2026) — a tarefa volta à fila de distribuição; SÓ pelo botão (nunca por "— selecione —"):
//   · confirmação explícita com a LISTA ("Remover Daniela Brait de 2 tarefas: …?") — 428 sem nada gravado, depois `confirmado` + assinatura;
//   · fica "sem responsável" e o responsável do PASSO ATIVO é limpo; a carga da pessoa cai;
//   · tarefa já iniciada pede confirmação EXTRA e o andamento é preservado (status não muda);
//   · histórico "removeu o responsável (X → ninguém)" com origem manual e motivo opcional;
//   · avisa quem perdeu a tarefa, nunca o autor.
// Caso real (produção): Certidão de nascimento e Certidão de casamento · Rodolfo Fogli · Fogli (Genealogia, com Daniela Brait).
//   node scripts/ci/gate-build.mjs --suite todas --so remover-responsavel
// ============================================================================
import { readFileSync } from "node:fs"
import { NextRequest } from "next/server"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarCenario } from "./_fixture-torre-gh"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { quadroDaEquipe } from "../lib/operacional/torre-equipe"
import { POST as postLote } from "../src/app/api/torre/tarefas/lote/route"
import { POST as postUma } from "../src/app/api/torre/tarefas/[tarefaId]/remover-responsavel/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(p, "utf8")
const MARCA = "REMRESP"
const EXEC = { "tarefas.iniciar_concluir": true, "tarefas.ver": true, "tarefas.editar": true }
const req = (url: string, token: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) })

async function main() {
  exigirBancoDeTeste("remover-responsavel.test.ts")
  const c = await montarCenario(MARCA)
  try {
    const mk = (nome: string, tipo: string, perms?: Record<string, boolean>) =>
      prisma.usuario.create({ data: { nome: `${MARCA} ${nome}`, email: `${MARCA.toLowerCase()}-${nome.toLowerCase().replace(/ /g, "")}@t.com`, senha: "x", tipo, ...(perms ? { permissoesCustom: perms } : {}) } })
    const admin = await mk("Marco", "admin")
    const dani = await mk("Daniela Brait", "assistente", EXEC)
    const tAdmin = await signAuthToken({ userId: admin.id, email: admin.email, tipo: admin.tipo, sessaoInicio: Date.now() })
    const lote = (b: unknown) => postLote(req("/api/torre/tarefas/lote", tAdmin, b))
    const uma = (id: number, b?: unknown) => postUma(req(`/api/torre/tarefas/${id}/remover-responsavel`, tAdmin, b), { params: Promise.resolve({ tarefaId: String(id) }) })

    // ── o caso real: nascimento e casamento do Rodolfo Fogli, na Genealogia, com a Daniela ───────────────────────────────
    const nasc = await c.novaObrigacao({ responsavelId: dani.id })
    const casa = await c.novaObrigacao({ responsavelId: dani.id })
    await prisma.arvore.updateMany({ where: { processos: { some: { id: { in: [nasc.processoId, casa.processoId] } } } }, data: { nome: "Fogli" } })
    await prisma.tarefa.update({ where: { id: nasc.tarefaId }, data: { titulo: "Certidão de nascimento - Inteiro Teor · Rodolfo Fogli" } })
    await prisma.tarefa.update({ where: { id: casa.tarefaId }, data: { titulo: "Certidão de casamento - Inteiro Teor · Rodolfo Fogli" } })
    await prisma.phaseWorkflowStepInstance.updateMany({ where: { id: { in: [nasc.stepInstanceId, casa.stepInstanceId] } }, data: { responsavelId: dani.id } })
    const ids = [nasc.tarefaId, casa.tarefaId]

    secao("CONFIRMAÇÃO — 1ª chamada devolve a lista e NÃO grava")
    const r428 = await lote({ acao: "REMOVER_RESPONSAVEL", tarefaIds: ids })
    const j428 = await r428.json()
    ok("428 com a prévia 'Remover Daniela Brait de 2 tarefas: …?' listando certidão · pessoa · família", r428.status === 428 && /Remover .*Daniela Brait de 2 tarefas/.test(j428.confirmacao?.pergunta ?? "") && /Certidão de nascimento.*Rodolfo Fogli · Fogli/.test(j428.confirmacao?.pergunta ?? "") && /Certidão de casamento.*Rodolfo Fogli · Fogli/.test(j428.confirmacao?.pergunta ?? ""), j428.confirmacao?.pergunta)
    ok("nada foi gravado (a Daniela continua com as duas)", (await prisma.tarefa.count({ where: { id: { in: ids }, responsavelId: dani.id } })) === 2)
    const semAss = await lote({ acao: "REMOVER_RESPONSAVEL", tarefaIds: ids, confirmado: true })
    ok("'confirmado' sem a assinatura da prévia não basta (volta a pedir)", semAss.status === 428 && (await prisma.tarefa.count({ where: { id: { in: ids }, responsavelId: dani.id } })) === 2)
    const assErrada = await lote({ acao: "REMOVER_RESPONSAVEL", tarefaIds: ids, confirmado: true, assinatura: "1:1" })
    ok("assinatura de outra prévia é recusada (409)", assErrada.status === 409)

    secao("EFEITO — fica sem responsável, passo limpo, histórico com origem, carga recalculada")
    const cargaAntes = (await quadroDaEquipe((await listarTarefasDaTorre()).linhas)).pessoas.find((p) => p.usuarioId === dani.id)?.ativas ?? 0
    const rOk = await lote({ acao: "REMOVER_RESPONSAVEL", tarefaIds: ids, confirmado: true, assinatura: j428.confirmacao.assinatura, motivo: "redistribuir na segunda" })
    const jOk = await rOk.json()
    ok("200 e as duas removidas", rOk.status === 200 && jOk.sucesso === 2, JSON.stringify(jOk).slice(0, 120))
    const ts = await prisma.tarefa.findMany({ where: { id: { in: ids } }, select: { responsavelId: true, dataAtribuicao: true, statusTarefa: true } })
    ok("as duas ficam SEM responsável (e sem data de atribuição); status preservado", ts.every((t) => t.responsavelId == null && t.dataAtribuicao == null && t.statusTarefa === "NAO_INICIADA"))
    const passos = await prisma.phaseWorkflowStepInstance.findMany({ where: { id: { in: [nasc.stepInstanceId, casa.stepInstanceId] } }, select: { responsavelId: true } })
    ok("o responsável do PASSO ATIVO ('executa …') também foi limpo", passos.every((p) => p.responsavelId == null))
    const linhas = (await listarTarefasDaTorre()).linhas
    ok("voltam para 'Sem responsável' na Torre (aguardando distribuição)", ids.every((id) => linhas.find((l) => l.taskId === id)?.responsavelId == null))
    const cargaDepois = (await quadroDaEquipe(linhas)).pessoas.find((p) => p.usuarioId === dani.id)?.ativas ?? 0
    ok("a carga da Daniela na Equipe foi recalculada (-2)", cargaAntes - cargaDepois === 2, `${cargaAntes} → ${cargaDepois}`)
    const logs = await prisma.logAuditoria.findMany({ where: { acao: "TAREFA_DEVOLVIDA_A_FILA", entidade: "Tarefa", entidadeId: { in: ids } } })
    ok("histórico: 'Responsável removido … (Daniela Brait → ninguém)' · Origem: manual · motivo opcional", logs.length === 2 && logs.every((l) => /Daniela Brait → ninguém/.test(l.descricao) && /Origem: manual/.test(l.descricao) && /redistribuir na segunda/.test(l.descricao) && (l.detalhes as { origem?: string })?.origem === "manual"), logs[0]?.descricao)
    const aviso = await prisma.notificacaoOperacional.findMany({ where: { destinatarioId: dani.id, tipo: "MUDOU_DE_MAO" as never }, select: { id: true } })
    ok("quem perdeu a tarefa é avisada (MUDOU_DE_MAO)", aviso.length >= 1)
    const avisoAutor = await prisma.notificacaoOperacional.count({ where: { destinatarioId: admin.id, tipo: "MUDOU_DE_MAO" as never } })
    ok("o AUTOR da ação nunca é avisado", avisoAutor === 0)
    const denovo = await lote({ acao: "REMOVER_RESPONSAVEL", tarefaIds: ids })
    ok("remover de quem já está sem responsável: 422 (nada a remover)", denovo.status === 422)

    secao("TAREFA JÁ INICIADA — confirmação extra, andamento preservado")
    const ini = await c.novaObrigacao({ responsavelId: dani.id })
    await prisma.tarefa.update({ where: { id: ini.tarefaId }, data: { statusTarefa: "EM_ANDAMENTO", dataInicio: new Date() } })
    await prisma.phaseWorkflowStepInstance.update({ where: { id: ini.stepInstanceId }, data: { status: "EM_ANDAMENTO", startedAt: new Date(), responsavelId: dani.id } })
    const p1 = await (await lote({ acao: "REMOVER_RESPONSAVEL", tarefaIds: [ini.tarefaId] })).json()
    ok("a prévia avisa que a tarefa já foi iniciada e exige a 2ª confirmação", p1.confirmacao?.exigeConfirmacaoDeAndamento === true && /iniciada/.test(p1.confirmacao?.alerta ?? ""))
    const semExtra = await lote({ acao: "REMOVER_RESPONSAVEL", tarefaIds: [ini.tarefaId], confirmado: true, assinatura: p1.confirmacao.assinatura })
    ok("confirmar SEM a confirmação extra → 428 e nada muda", semExtra.status === 428 && (await prisma.tarefa.findUniqueOrThrow({ where: { id: ini.tarefaId } })).responsavelId === dani.id)
    const comExtra = await lote({ acao: "REMOVER_RESPONSAVEL", tarefaIds: [ini.tarefaId], confirmado: true, assinatura: p1.confirmacao.assinatura, confirmarAndamento: true })
    const tI = await prisma.tarefa.findUniqueOrThrow({ where: { id: ini.tarefaId } })
    const sI = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: ini.stepInstanceId } })
    ok("com a confirmação extra: removida, e o ANDAMENTO é preservado (tarefa e passo continuam em andamento)", comExtra.status === 200 && tI.responsavelId == null && tI.statusTarefa === "EM_ANDAMENTO" && sI.status === "EM_ANDAMENTO" && sI.responsavelId == null)

    secao("UMA tarefa (gaveta da certidão) — mesma porta, mesma confirmação")
    const g = await c.novaObrigacao({ responsavelId: dani.id })
    const u428 = await uma(g.tarefaId)
    const ju = await u428.json()
    ok("sem confirmação: 428 com a prévia e nada gravado", u428.status === 428 && /Remover .*Daniela Brait de 1 tarefa/.test(ju.confirmacao?.pergunta ?? "") && (await prisma.tarefa.findUniqueOrThrow({ where: { id: g.tarefaId } })).responsavelId === dani.id)
    const uOk = await uma(g.tarefaId, { confirmado: true, assinatura: ju.confirmacao.assinatura })
    ok("com a assinatura: removida", uOk.status === 200 && (await prisma.tarefa.findUniqueOrThrow({ where: { id: g.tarefaId } })).responsavelId == null)

    secao("TELAS — só pelo botão; '— selecione —' nunca remove")
    const gav = ler("src/components/kanban/DocumentoOperationalDrawer.tsx")
    ok("gaveta da certidão: botão 'Remover responsável' ao lado de Delegar", /data-testid="remover-responsavel"/.test(gav) && /Remover responsável/.test(gav))
    ok("o menu Delegar não remove: '— selecione —' é opção desabilitada e o onChange ignora vazio", /<option value="" disabled[^>]*>— selecione —<\/option>/.test(gav) && /if \(e\.target\.value\) await delegarTarefa/.test(gav))
    const tt = ler("src/components/torre/TorreTarefas.tsx")
    ok("barra de lote da aba Tarefas: botão 'Remover responsável' com o modal de confirmação", /lote\("REMOVER_RESPONSAVEL"\)/.test(tt) && /useConfirmarAtribuicao\(\)/.test(tt) && /\{modalConfirmacao\}/.test(tt))
  } finally {
    await c.limpar()
    await prisma.notificacaoOperacional.deleteMany({ where: { destinatario: { nome: { startsWith: MARCA } } } }).catch(() => null)
    await prisma.logAuditoria.deleteMany({ where: { OR: [{ descricao: { contains: MARCA } }, { usuario: { nome: { startsWith: MARCA } } }] } }).catch(() => null)
    await prisma.usuario.deleteMany({ where: { nome: { startsWith: MARCA } } }).catch(() => null)
  }
  console.log(`\n${falhou === 0 ? "✅" : "❌"} REMOVER RESPONSÁVEL — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
