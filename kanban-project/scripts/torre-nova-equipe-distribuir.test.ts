// scripts/torre-nova-equipe-distribuir.test.ts
// ============================================================================
// TORRE NOVA, FRENTE F (01/10/2026) — ABA EQUIPE: "Distribuir por aptidão e carga", "Redistribuir", sucessor por país e a
// SIMULAÇÃO com o texto do protótipo. Banco de teste.
//
//   npx tsx scripts/torre-nova-equipe-distribuir.test.ts   (banco de teste)
//
// PROVA (CHECKLIST-T T333/T337/T344–T351 + regras do briefing):
//   • a linha "Sem responsável" é a MESMA conta das abertas sem dono da Operação (KPI `ninguem`, aba Tarefas/Visão geral) e Ativas/
//     Atrasadas/Aguard. terceiros de toda a aba somam o que a Operação conta (mesma função `cargaPorPessoa`);
//   • "Distribuir" só atribui a quem tem aptidão COMPROVADA (país do processo): sem apto, a tarefa FICA sem dono (Precisa de você);
//   • considera a CARGA (menos ativas), a AUSÊNCIA (ausente → sucessor sugerido, que também é apto) e o LIMITE (no limite, segura);
//   • cada atribuição fica no histórico da tarefa, o lote deixa um resumo, e o DESFAZER devolve tudo;
//   • "Redistribuir": o excesso de quem passou do limite vai ao sucessor apto (até o limite dele) + as sem dono; a sugestão do rodapé
//     prevê exatamente o que a execução faz;
//   • o sucessor sugerido respeita a aptidão por PAÍS; a SIMULAÇÃO nunca grava e escreve "Vencem N prazos nesses D dias e M certidões
//     ficam sem toque. Sucessor sugerido: X (apto(a) em …; … fica com …). Depois da mudança, a fila do sucessor sobe …".
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-nova-equipe-distribuir.test.ts")

import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarCenario } from "./_fixture-torre-gh"
import { definirCapacidade, definirAptidoesPais, abrirIndisponibilidade } from "../lib/operacional/organizacao"
import { sugerirSucessor } from "../lib/operacional/elegibilidade"
import { quadroDaEquipe, simularSaida } from "../lib/operacional/torre-equipe"
import { distribuirSemResponsavel, executarRedistribuicao, sugestaoDeRedistribuicao } from "../lib/operacional/torre-equipe-distribuicao"
import { lerOrganizacao } from "../lib/operacional/organizacao"
import { numeroDoKpi } from "../lib/operacional/torre-kpis"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { desfazerLote } from "../src/services/torre-acoes-lote"
import { POST as postDistribuir } from "../src/app/api/torre/equipe/distribuir-sem-responsavel/route"
import { POST as postRedistribuir } from "../src/app/api/torre/equipe/redistribuir/route"
import { POST as postAplicar } from "../src/app/api/torre/equipe/aplicar-saida/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORRENEQ"
const DIA = 86_400_000
const EXEC = { "tarefas.iniciar_concluir": true, "tarefas.ver": true, "tarefas.editar": true }

const req = (url: string, token: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) })

async function main() {
  const c = await montarCenario(MARCA)
  const paisesCriados: number[] = []
  try {
    const mk = (nome: string, tipo: string, perms?: Record<string, boolean>) =>
      prisma.usuario.create({ data: { nome: `${MARCA} ${nome}`, email: `${MARCA.toLowerCase()}-${nome.toLowerCase()}@t.com`, senha: "x", tipo, ...(perms ? { permissoesCustom: perms } : {}) } })
    const admin = await mk("Admin", "admin")
    const ana = await mk("Ana", "assistente", EXEC)
    const beto = await mk("Beto", "assistente", EXEC)
    const cris = await mk("Cris", "assistente", EXEC)   // NÃO é apta na Itália
    const dora = await mk("Dora", "assistente", EXEC)
    const tAdmin = await signAuthToken({ userId: admin.id, email: admin.email, tipo: admin.tipo, sessaoInicio: Date.now() })

    const pIt = await prisma.catalogoPais.create({ data: { countryKey: "torrene_italia", countryLabel: `${MARCA} Itália`, nationalityKey: "torrene_it", nationalityLabel: "x" } })
    const pEs = await prisma.catalogoPais.create({ data: { countryKey: "torrene_espanha", countryLabel: `${MARCA} Espanha`, nationalityKey: "torrene_es", nationalityLabel: "x" } })
    paisesCriados.push(pIt.id, pEs.id)
    // Itália: Ana, Beto e Dora são aptos. Espanha: NINGUÉM foi declarado apto → sem aptidão comprovada (nunca atribui).
    await definirAptidoesPais(ana.id, [pIt.id], admin.id)
    await definirAptidoesPais(beto.id, [pIt.id], admin.id)
    await definirAptidoesPais(dora.id, [pIt.id], admin.id)
    await definirCapacidade({ usuarioId: ana.id, limiteExecutaveis: 50, autorId: admin.id })
    await definirCapacidade({ usuarioId: beto.id, limiteExecutaveis: 50, autorId: admin.id })
    await definirCapacidade({ usuarioId: dora.id, limiteExecutaveis: 2, autorId: admin.id })

    const hoje = Date.now()
    const nova = async (paisId: number, o: { responsavelId?: number | null; dataPrazo?: Date | null; aguardando?: boolean } = {}) => {
      const t = await c.novaObrigacao({ responsavelId: o.responsavelId ?? null, dataPrazo: o.dataPrazo === undefined ? new Date(hoje + 3 * DIA) : o.dataPrazo, aguardando: o.aguardando })
      await prisma.processo.update({ where: { id: t.processoId }, data: { paisId } })
      return t
    }

    // ─── CENÁRIO 1: sem dono em Itália (aptos) e na Espanha (sem apto comprovado) ─────────────────────
    secao("DISTRIBUIR — só atribui a quem tem aptidão comprovada; menor carga primeiro")
    // Ana tem 1 ativa, Beto tem 3: a regra balanceia pela carga (Ana recebe mais até igualar).
    await nova(pIt.id, { responsavelId: ana.id }); for (let i = 0; i < 3; i++) await nova(pIt.id, { responsavelId: beto.id })
    const itSem = []; for (let i = 0; i < 6; i++) itSem.push(await nova(pIt.id))
    const esSem = [await nova(pEs.id), await nova(pEs.id)]
    const idsIt = itSem.map((t) => t.tarefaId), idsEs = esSem.map((t) => t.tarefaId)

    const linhas0 = (await listarTarefasDaTorre()).linhas
    const quadro0 = await quadroDaEquipe(linhas0)
    ok("a linha 'Sem responsável' = as abertas sem dono da Operação (o KPI 'Sem responsável' da Visão geral/Tarefas)", quadro0.semResponsavel.ativas === numeroDoKpi("ninguem", linhas0) && quadro0.semResponsavel.ativas >= 8, `${quadro0.semResponsavel.ativas}`)
    ok("a previsão tem a MESMA linha 'Sem responsável' (total fecha com a tabela)", quadro0.previsao.linhas.find((l) => l.usuarioId === null)!.total === quadro0.semResponsavel.ativas)
    const somaAtivas = quadro0.pessoas.reduce((s, p) => s + p.ativas, 0) + quadro0.semResponsavel.ativas
    const abertas = numeroDoKpi("abertas", linhas0)
    const foraDaAba = linhas0.filter((l) => l.estadoOperacao !== "CONCLUIDA" && l.responsavelId != null && !quadro0.pessoas.some((p) => p.usuarioId === l.responsavelId)).length
    ok("Ativas de todas as pessoas + Sem responsável (+ quem não é da aba) = Tarefas abertas da Visão geral", somaAtivas + foraDaAba === abertas, `${somaAtivas} + ${foraDaAba} = ${abertas}`)
    const somaAguard = quadro0.pessoas.reduce((s, p) => s + p.aguardando, 0) + quadro0.semResponsavel.aguardando
    const aguardForaDaAba = linhas0.filter((l) => l.estadoOperacao === "AGUARDANDO" && l.responsavelId != null && !quadro0.pessoas.some((p) => p.usuarioId === l.responsavelId)).length
    ok("Aguard. terceiros da aba (+ fora da aba) = 'Aguardando terceiros' da Visão geral", somaAguard + aguardForaDaAba === numeroDoKpi("cartorio", linhas0), `${somaAguard} + ${aguardForaDaAba} = ${numeroDoKpi("cartorio", linhas0)}`)

    const sug0 = quadro0.sugestao
    ok("a sugestão do rodapé conta as sem dono e diz entre quem se distribuiriam (só aptos: Ana e Beto)", sug0.semResponsavel.total === quadro0.semResponsavel.ativas
      && sug0.semResponsavel.porPessoa.every((p) => [ana.id, beto.id, dora.id].includes(p.usuarioId)) && sug0.semResponsavel.porPessoa.some((p) => p.usuarioId === ana.id) && sug0.semResponsavel.semApto >= 2, JSON.stringify(sug0.semResponsavel))

    const antes = JSON.stringify((await prisma.tarefa.findMany({ orderBy: { id: "asc" }, select: { id: true, responsavelId: true, lockVersion: true } })))
    await sugestaoDeRedistribuicao(linhas0, await lerOrganizacao(), new Date())
    ok("calcular a SUGESTÃO não grava nada", antes === JSON.stringify((await prisma.tarefa.findMany({ orderBy: { id: "asc" }, select: { id: true, responsavelId: true, lockVersion: true } }))))

    // SUGESTÃO NUNCA ATRIBUI SOZINHA (06/10/2026): a 1ª chamada só devolve a prévia (428) e NÃO grava; a 2ª, com confirmação + assinatura, grava.
    const r428 = await postDistribuir(req("/api/torre/equipe/distribuir-sem-responsavel", tAdmin))
    const j428 = await r428.json()
    ok("sem confirmação: 428 com a prévia 'Atribuir … a …?' e NADA gravado", r428.status === 428 && /Atribuir/.test(j428.confirmacao?.pergunta ?? "") && (await prisma.tarefa.count({ where: { id: { in: [...idsIt, ...idsEs] }, responsavelId: { not: null } } })) === 0, `${r428.status}`)
    const rDist = await postDistribuir(req("/api/torre/equipe/distribuir-sem-responsavel", tAdmin, { confirmado: true, assinatura: j428.confirmacao?.assinatura }))
    const jDist = await rDist.json()
    const donos = new Map((await prisma.tarefa.findMany({ where: { id: { in: [...idsIt, ...idsEs] } }, select: { id: true, responsavelId: true } })).map((t) => [t.id, t.responsavelId]))
    ok("as 6 de Itália foram atribuídas — todas a quem é apto (Ana/Beto/Dora), NUNCA à Cris", rDist.status === 200 && idsIt.every((id) => [ana.id, beto.id, dora.id].includes(donos.get(id) as number)) && ![...donos.values()].includes(cris.id), JSON.stringify([...donos]))
    ok("as 2 da Espanha (ninguém apto comprovado) FICARAM sem dono — vão para o Precisa de você", idsEs.every((id) => donos.get(id) === null) && jDist.semApto >= 2)
    ok("o resultado traz quanto foi para cada pessoa e a soma bate com as atribuídas", jDist.atribuidas >= 6 && jDist.porPessoa.reduce((s: number, p: { quantidade: number }) => s + p.quantidade, 0) === jDist.atribuidas)
    const dAna = idsIt.filter((id) => donos.get(id) === ana.id).length, dBeto = idsIt.filter((id) => donos.get(id) === beto.id).length
    ok("a carga decide: Ana (1 ativa) recebe mais que Beto (3 ativas)", dAna > dBeto, `Ana ${dAna} · Beto ${dBeto}`)
    const hist = await prisma.logAuditoria.count({ where: { entidade: "Tarefa", entidadeId: { in: idsIt }, acao: { in: ["TAREFA_ATRIBUIDA", "TAREFA_TRANSFERIDA"] }, usuarioId: admin.id } })
    const comJustificativa = await prisma.logAuditoria.count({ where: { entidade: "Tarefa", entidadeId: { in: idsIt }, acao: "TAREFA_ATRIBUIDA", detalhes: { path: ["motivo"], string_contains: "Distribuir por aptidão e carga" } } })
    ok("cada atribuição ficou no histórico da tarefa (quem, o quê, quando)", hist === 6, `${hist}`)
    ok("…com a justificativa (critério: aptidão e menor carga) gravada no detalhe", comJustificativa === 6, `${comJustificativa}`)
    const resumo = await prisma.logAuditoria.findFirst({ where: { acao: "TORRE_EQUIPE_SEM_RESPONSAVEL_DISTRIBUIDAS", usuarioId: admin.id }, orderBy: { id: "desc" } })
    ok("o lote deixa UM resumo auditado (quantas, para quem, quantas sem apto)", !!resumo && /atribuída\(s\)/.test(resumo.descricao) && /sem apto/.test(resumo.descricao), resumo?.descricao ?? "")
    ok("o Desfazer devolve as atribuídas à fila (sem dono de novo)", jDist.desfazer?.tipo === "ATRIBUICAO" && await (async () => {
      const d = await desfazerLote({ tipo: "ATRIBUICAO", tarefaIds: jDist.desfazer.tarefaIds, autorId: admin.id })
      const depois = await prisma.tarefa.findMany({ where: { id: { in: idsIt } }, select: { responsavelId: true } })
      return d.desfeitas >= 6 && depois.every((t) => t.responsavelId === null)
    })())

    // ─── CENÁRIO 2: ausência ─────────────────────────────────────────────────────────────────────────
    secao("DISTRIBUIR — respeita a AUSÊNCIA: quem está ausente não recebe; o sucessor sugerido (apto e disponível) recebe")
    const aus = await abrirIndisponibilidade({ usuarioId: ana.id, tipo: "FERIAS", inicio: new Date(hoje - DIA), fim: new Date(hoje + 9 * DIA), autorId: admin.id, sucessorSugeridoId: beto.id })
    ok("pré-condição: Ana em férias, sucessor sugerido Beto", aus.ok)
    const r2 = await distribuirSemResponsavel({ autorId: admin.id })
    const donos2 = new Map((await prisma.tarefa.findMany({ where: { id: { in: idsIt } }, select: { id: true, responsavelId: true } })).map((t) => [t.id, t.responsavelId]))
    ok("nenhuma foi para a Ana (ausente); todas as de Itália foram a pessoas aptas e disponíveis", r2.atribuidas >= 6 && idsIt.every((id) => [beto.id, dora.id].includes(donos2.get(id) as number)) && ![...donos2.values()].includes(ana.id), JSON.stringify([...donos2]))
    await desfazerLote({ tipo: "ATRIBUICAO", tarefaIds: r2.tarefaIds, autorId: admin.id })
    await prisma.indisponibilidadeOperacional.deleteMany({ where: { usuarioId: ana.id } })

    // ─── CENÁRIO 3: limite de carga ──────────────────────────────────────────────────────────────────
    secao("DISTRIBUIR — o LIMITE de carga segura (ninguém recebe acima do limite do cadastro)")
    await definirCapacidade({ usuarioId: beto.id, limiteExecutaveis: 3, autorId: admin.id })   // Beto já tem 3 executáveis
    await definirCapacidade({ usuarioId: ana.id, limiteExecutaveis: 1, autorId: admin.id })    // Ana já tem 1
    await definirCapacidade({ usuarioId: dora.id, limiteExecutaveis: 1, autorId: admin.id })   // Dora tem 0 → cabe 1
    const r3 = await distribuirSemResponsavel({ autorId: admin.id })
    const org3 = await lerOrganizacao()
    const exec = async (id: number) => (await quadroDaEquipe()).pessoas.find((p) => p.usuarioId === id)!.carga.executaveis
    ok("no máximo 1 foi para a Dora (cabia 1) e ninguém ultrapassou o limite", r3.atribuidas <= 1 && (await exec(ana.id)) <= (org3.get(ana.id)!.limiteExecutaveis as number) && (await exec(beto.id)) <= 3 && (await exec(dora.id)) <= 1, JSON.stringify({ atrib: r3.atribuidas, seg: r3.seguradas }))
    ok("o resto fica SEGURADO pelo limite (Precisa de você), contado à parte", r3.seguradas + r3.semApto >= 6 - r3.atribuidas)
    await desfazerLote({ tipo: "ATRIBUICAO", tarefaIds: r3.tarefaIds, autorId: admin.id })

    // ─── CENÁRIO 4: redistribuir ─────────────────────────────────────────────────────────────────────
    secao("REDISTRIBUIR — o excesso de quem passou do limite vai ao sucessor apto; a sugestão prevê o que a execução faz")
    await definirCapacidade({ usuarioId: ana.id, limiteExecutaveis: 50, autorId: admin.id })
    await definirCapacidade({ usuarioId: beto.id, limiteExecutaveis: 50, autorId: admin.id })
    await definirCapacidade({ usuarioId: dora.id, limiteExecutaveis: 2, autorId: admin.id })
    const daDora = []; for (let i = 0; i < 4; i++) daDora.push(await nova(pIt.id, { responsavelId: dora.id, dataPrazo: new Date(hoje + (i + 1) * DIA) }))
    const q4 = await quadroDaEquipe()
    const dora4 = q4.pessoas.find((p) => p.usuarioId === dora.id)!
    ok("pré-condição: Dora com 4 executáveis e limite 2 (barra vermelha)", dora4.carga.executaveis >= 4 && dora4.carga.limite === 2)
    const mDora = q4.sugestao.movimentos.find((m) => m.deUsuarioId === dora.id)
    ok("a sugestão manda o EXCESSO (executáveis − limite) da Dora para quem é apto e tem menor custo", !!mDora && mDora.quantidade === Math.min(dora4.carga.executaveis - 2, mDora.quantidade) && [ana.id, beto.id].includes(mDora.paraUsuarioId) && mDora.quantidade >= 1, JSON.stringify(mDora))
    const rRed = await postRedistribuir(req("/api/torre/equipe/redistribuir", tAdmin))
    const jRed = await rRed.json()
    const feitoDora = jRed.movimentos.find((m: { deUsuarioId: number }) => m.deUsuarioId === dora.id)
    ok("a execução move EXATAMENTE o que a sugestão previu", rRed.status === 200 && feitoDora?.movidas === mDora!.quantidade && feitoDora.paraUsuarioId === mDora!.paraUsuarioId, JSON.stringify(feitoDora))
    const q4b = await quadroDaEquipe()
    ok("a Dora volta ao limite (não fica acima do que o cadastro comporta)", q4b.pessoas.find((p) => p.usuarioId === dora.id)!.carga.executaveis <= 2)
    ok("o resumo da redistribuição ficou na auditoria", (await prisma.logAuditoria.count({ where: { acao: "TORRE_EQUIPE_REDISTRIBUIDA", usuarioId: admin.id } })) >= 1)
    const d4 = await desfazerLote({ tipo: "ATRIBUICAO", tarefaIds: jRed.desfazer.tarefaIds, autorId: admin.id })
    ok("o Desfazer devolve TODAS as tarefas (movidas e distribuídas)", d4.desfeitas === jRed.desfazer.tarefaIds.length && (await quadroDaEquipe()).pessoas.find((p) => p.usuarioId === dora.id)!.carga.executaveis >= 4)
    // permissão: a rota exige gestor com usuarios.gerenciar e tarefas.editar
    const sem = await mk("SemPermissao", "assistente", { "tarefas.ver": true })
    const tSem = await signAuthToken({ userId: sem.id, email: sem.email, tipo: sem.tipo, sessaoInicio: Date.now() })
    ok("quem não é gestor da Torre: 403 em Distribuir e Redistribuir", (await postDistribuir(req("/api/torre/equipe/distribuir-sem-responsavel", tSem))).status === 403 && (await postRedistribuir(req("/api/torre/equipe/redistribuir", tSem))).status === 403)

    // ─── CENÁRIO 5: sucessor por país + simulação ────────────────────────────────────────────────────
    secao("SUCESSOR e SIMULAÇÃO — o sucessor respeita a aptidão por PAÍS; o texto é o do protótipo; simular não grava")
    await prisma.tarefa.updateMany({ where: { titulo: { startsWith: MARCA }, responsavelId: { in: [ana.id, beto.id, dora.id] } }, data: { responsavelId: null } })
    const suc = await sugerirSucessor(dora.id)
    ok("o sucessor sugerido da Dora (apta na Itália) é apto na Itália: Ana ou Beto — nunca a Cris nem o administrador", !!suc && [ana.id, beto.id].includes(suc.usuarioId), JSON.stringify(suc))
    // Dora apta em Itália E Espanha; só a Cris é apta na Espanha → o sucessor precisa ser apto em ao menos um dos países da Dora.
    await definirAptidoesPais(dora.id, [pIt.id, pEs.id], admin.id)
    await definirAptidoesPais(cris.id, [pEs.id], admin.id)
    for (let i = 0; i < 3; i++) await nova(pIt.id, { responsavelId: dora.id, dataPrazo: new Date(hoje + 2 * DIA) })
    await nova(pEs.id, { responsavelId: dora.id, dataPrazo: new Date(hoje - 2 * DIA) })
    await nova(pIt.id, { responsavelId: dora.id, dataPrazo: new Date(hoje + 40 * DIA), aguardando: true })
    for (let i = 0; i < 4; i++) await prisma.tarefa.create({ data: { titulo: `${MARCA} concluida ${i}`, statusTarefa: "CONCLUIDO_RECEBIDO", responsavelId: beto.id, dataConclusao: new Date(hoje - (i + 1) * 3 * DIA) } })
    const estado = async () => ({ t: JSON.stringify(await prisma.tarefa.findMany({ orderBy: { id: "asc" }, select: { id: true, responsavelId: true, lockVersion: true } })), l: await prisma.logAuditoria.count(), a: await prisma.indisponibilidadeOperacional.count() })
    const e0 = await estado()
    const sim = await simularSaida(dora.id, 10)
    ok("SIMULAR não grava nada (tarefas, auditoria, ausências idênticas)", JSON.stringify(e0) === JSON.stringify(await estado()))
    ok("começa com 'Vencem N prazos nesses 10 dias e M certidões ficam sem toque.'", /^Vencem \d+ prazos nesses 10 dias e \d+ certidões ficam sem toque\. /.test(sim!.texto), sim!.texto)
    ok("…cita o sucessor sugerido e, entre parênteses, onde ele é apto e com quem fica o resto (formato do protótipo)",
      !!sim!.sucessor && sim!.texto.includes(`Sucessor sugerido: ${sim!.sucessor.nome} (apto(a) em `) && / fica com /.test(sim!.texto) && /\)\. Depois da mudança/.test(sim!.texto), sim!.texto)
    ok("…termina com 'Depois da mudança, a fila do sucessor sobe X.X semana(s).' (decimal com ponto) ou diz que não há base", /Depois da mudança, a fila do sucessor sobe \d+\.\d semana\(s\)\.$|não há base para estimar semanas|a fila do sucessor não muda\.$/.test(sim!.texto), sim!.texto)
    ok("'ficam sem toque' = as executáveis (a que esperam o terceiro NÃO entram)", sim!.texto.includes(`e ${sim!.ativas - sim!.comOCartorio} certidões ficam sem toque`), `${sim!.ativas} ativas, ${sim!.comOCartorio} aguardando`)
    ok("o período usa os dias pedidos (3 dias muda os prazos contados)", (await simularSaida(dora.id, 3))!.texto.includes("nesses 3 dias") && (await simularSaida(dora.id, 60))!.vencemNoPeriodo >= sim!.vencemNoPeriodo)

    // aplicar: a ausência recebe o motivo 'saída simulada · N dias' (o texto que a tela mostra)
    const rApl = await postAplicar(req("/api/torre/equipe/aplicar-saida", tAdmin, { usuarioId: dora.id, dias: 10 }))
    const jApl = await rApl.json()
    const ausDora = (await quadroDaEquipe()).pessoas.find((p) => p.usuarioId === dora.id)!.ausencia
    ok("'Aplicar': a pessoa passa a 'ausente (saída simulada · 10 dias)'", rApl.status === 200 && ausDora?.motivo === "saída simulada · 10 dias", JSON.stringify(ausDora))
    ok("…e o Desfazer encerra a ausência E devolve a carteira", !!jApl.desfazer && await (async () => {
      const d = await desfazerLote({ tipo: "ATRIBUICAO", tarefaIds: jApl.desfazer.tarefaIds, autorId: admin.id, ausenciaId: jApl.desfazer.ausenciaId })
      return d.ausenciaEncerrada === true && (await quadroDaEquipe()).pessoas.find((p) => p.usuarioId === dora.id)!.ausencia === null
    })())
  } finally {
    await prisma.tarefa.deleteMany({ where: { titulo: { startsWith: MARCA } } })
    await prisma.aptidaoOperacionalPais.deleteMany({ where: { usuario: { email: { startsWith: MARCA.toLowerCase() } } } })
    await prisma.capacidadeOperacional.deleteMany({ where: { usuario: { email: { startsWith: MARCA.toLowerCase() } } } })
    await prisma.indisponibilidadeOperacional.deleteMany({ where: { usuario: { email: { startsWith: MARCA.toLowerCase() } } } })
    await prisma.logAuditoria.deleteMany({ where: { OR: [{ entidade: "CapacidadeOperacional" }, { acao: { in: ["TORRE_EQUIPE_SEM_RESPONSAVEL_DISTRIBUIDAS", "TORRE_EQUIPE_REDISTRIBUIDA", "APTIDAO_PAIS_ALTERADA"] } }] } })
    await c.limpar()
    await prisma.processo.updateMany({ where: { paisId: { in: paisesCriados } }, data: { paisId: null } })
    await prisma.catalogoPais.deleteMany({ where: { id: { in: paisesCriados } } })
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
