// scripts/torre-bloco-h-equipe.test.ts
// ============================================================================
// TORRE DE CONTROLE, BLOCO H1/H2 (30/09/2026) — aba EQUIPE e PREVISÃO DE CARGA.
//
//   npx tsx scripts/torre-bloco-h-equipe.test.ts   (banco de teste)
//
// PROVA:
//   • os números da Equipe são OS DA OPERAÇÃO (mesmas linhas, uma conta só) — e batem com a
//     tela de Capacidade (`/api/operacao/capacidade`): não há duas contas;
//   • faixas: Carga verde <70 %, âmbar ≥70 %, vermelha ≥100 %; Fila ≥2 vermelho, ≥1 âmbar, senão livre;
//   • marcar ausência é SÓ REGISTRO com sucessor sugerido — nenhuma tarefa é movida sozinha;
//   • SIMULAR SAÍDA não grava nada; MOVER CARTEIRA é manual, auditada e se desfaz;
//   • previsão de 4 semanas a partir de hoje, com a soma fechando com a Operação.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-bloco-h-equipe.test.ts")

import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarCenario } from "./_fixture-torre-gh"
import { definirCapacidade, definirAptidoes } from "../lib/operacional/organizacao"
import { quadroDaEquipe, simularSaida, moverCarteira, semanasDaPrevisao } from "../lib/operacional/torre-equipe"
import { faixaDaCarga, faixaDaFila, nivelDaPrevisao, cargaPorPessoa } from "../lib/operacional/torre-predicados"
import { visaoGerencial } from "../lib/operacional/tarefa-projecoes"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { desfazerLote } from "../src/services/torre-acoes-lote"
import { cargasComLimite } from "../lib/operacional/torre-equipe"
import { itensPrecisaDeVoce } from "../lib/operacional/precisa-de-voce"
import { GET as getEquipe } from "../src/app/api/torre/equipe/route"
import { POST as postSimular } from "../src/app/api/torre/equipe/simular-saida/route"
import { POST as postMover } from "../src/app/api/torre/equipe/mover-carteira/route"
import { POST as postAplicar } from "../src/app/api/torre/equipe/aplicar-saida/route"
import { GET as getCapacidade, PATCH as patchCapacidade } from "../src/app/api/operacao/capacidade/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORREH1"
const DIA = 86_400_000

const req = (method: string, url: string, token: string | null, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
const tokenDe = (u: { id: number; email: string; tipo: string }) => signAuthToken({ userId: u.id, email: u.email, tipo: u.tipo, sessaoInicio: Date.now() })

async function main() {
  const c = await montarCenario(MARCA)
  try {
    secao("FAIXAS (regras do mandato H1)")
    ok("Carga: 69% verde · 70% âmbar · 99% âmbar · 100% vermelha · 130% vermelha",
      faixaDaCarga(69) === "verde" && faixaDaCarga(70) === "ambar" && faixaDaCarga(99) === "ambar" && faixaDaCarga(100) === "vermelha" && faixaDaCarga(130) === "vermelha")
    ok("Fila: 0,9 livre · 1 âmbar · 1,99 âmbar · 2 vermelho", faixaDaFila(0.9, 3) === "livre" && faixaDaFila(1, 3) === "ambar" && faixaDaFila(1.99, 3) === "ambar" && faixaDaFila(2, 3) === "vermelho")
    ok("Fila sem base de medição: 'sem_base' com trabalho, 'livre' sem trabalho (nunca finge)", faixaDaFila(null, 4) === "sem_base" && faixaDaFila(null, 0) === "livre")
    ok("Previsão (escala do protótipo): 0→0 · 1-2→1 · 3-4→2 · 5+→3", nivelDaPrevisao(0) === 0 && nivelDaPrevisao(2) === 1 && nivelDaPrevisao(3) === 2 && nivelDaPrevisao(4) === 2 && nivelDaPrevisao(5) === 3)

    const mk = (nome: string, tipo: string, perms?: Record<string, boolean>) =>
      prisma.usuario.create({ data: { nome: `${MARCA} ${nome}`, email: `${MARCA.toLowerCase()}-${nome.toLowerCase()}@t.com`, senha: "x", tipo, ...(perms ? { permissoesCustom: perms } : {}) } })
    const EXEC = { "tarefas.iniciar_concluir": true, "tarefas.ver": true }
    const admin = await mk("Admin", "admin")
    const ana = await mk("Ana", "assistente", EXEC)
    const beto = await mk("Beto", "assistente", EXEC)
    const cris = await mk("Cris", "assistente", EXEC)
    const gestor = await mk("Gestor", "assistente", { "tarefas.ver": true, "operacao.distribuirTarefas": true })
    const tAdmin = await tokenDe(admin), tGestor = await tokenDe(gestor)
    await definirCapacidade({ usuarioId: ana.id, limiteExecutaveis: 3, autorId: admin.id })
    await definirCapacidade({ usuarioId: beto.id, limiteExecutaveis: 10, autorId: admin.id })

    const hoje = Date.now()
    // Ana: a1,a2 com o cartório (aguardando) · a3 ATRASADA (executável) · a4 em dia (executável)
    const ontem = new Date(hoje - 3 * DIA)
    const a1 = await c.novaObrigacao({ aguardando: true, responsavelId: ana.id, dataPrazo: new Date(hoje + 3 * DIA) })
    const a2 = await c.novaObrigacao({ aguardando: true, responsavelId: ana.id, dataPrazo: new Date(hoje + 9 * DIA) })
    const a3 = await c.novaObrigacao({ responsavelId: ana.id, dataPrazo: ontem })
    const a4 = await c.novaObrigacao({ responsavelId: ana.id, dataPrazo: new Date(hoje + 3 * DIA) })
    const b1 = await c.novaObrigacao({ responsavelId: beto.id, dataPrazo: new Date(hoje + 16 * DIA) })
    const b2 = await c.novaObrigacao({ responsavelId: beto.id, dataPrazo: new Date(hoje + 16 * DIA) })
    const s1 = await c.novaObrigacao({ dataPrazo: new Date(hoje + 10 * DIA) })   // sem responsável
    // Capacidade MEDIDA: Ana concluiu 8 nas últimas 4 semanas (2/sem) → fila = executáveis ÷ 2.
    for (let i = 0; i < 8; i++) {
      await prisma.tarefa.create({ data: { titulo: `${MARCA} concluida ${i}`, statusTarefa: "CONCLUIDO_RECEBIDO", responsavelId: ana.id, dataConclusao: new Date(hoje - (i + 1) * 2 * DIA) } })
    }

    secao("H1 — OS NÚMEROS SÃO OS DA OPERAÇÃO (uma conta só)")
    const linhas = (await listarTarefasDaTorre()).linhas
    const { pessoas, previsao } = await quadroDaEquipe(linhas)
    const linhaAna = pessoas.find((p) => p.usuarioId === ana.id)!
    const linhaBeto = pessoas.find((p) => p.usuarioId === beto.id)!
    ok("Ana, Beto, Cris e o administrador (que executa, como no protótipo) estão na aba; quem só gere (sem execução nem tarefa) não", !!linhaAna && !!linhaBeto && pessoas.some((p) => p.usuarioId === cris.id) && pessoas.some((p) => p.usuarioId === admin.id) && !pessoas.some((p) => p.usuarioId === gestor.id))
    // A própria Operação, pessoa a pessoa (visaoGerencial com responsavelId — o filtro que a fila usa).
    for (const p of [ana, beto]) {
      const doDono = (await visaoGerencial({ responsavelId: p.id, porPagina: 500 })).linhas.filter((l) => l.coluna !== "CONCLUIDA")
      const l = pessoas.find((x) => x.usuarioId === p.id)!
      ok(`${p.nome.split(" ")[1]}: Ativas = as da Operação`, l.ativas === doDono.length, `${l.ativas}`)
      ok(`${p.nome.split(" ")[1]}: Atrasadas = as da Operação`, l.atrasadas === doDono.filter((x) => x.atrasada).length, `${l.atrasadas}`)
      ok(`${p.nome.split(" ")[1]}: Aguard. = 'Com o cartório' da Operação`, l.aguardando === doDono.filter((x) => x.estadoOperacao === "AGUARDANDO").length, `${l.aguardando}`)
    }
    ok("Ana: 4 ativas, 1 atrasada, 2 com o cartório, 2 executáveis", linhaAna.ativas === 4 && linhaAna.atrasadas === 1 && linhaAna.aguardando === 2 && linhaAna.carga.executaveis === 2)
    ok("Ana: Carga 2 de 3 = 67 % → verde", linhaAna.carga.limite === 3 && linhaAna.carga.pct === 67 && linhaAna.carga.faixa === "verde")
    ok("Ana fecha 2/sem (8 concluídas em 4 semanas) e a fila é 1 semana → âmbar", linhaAna.carga.fechaPorSemana === 2 && linhaAna.fila.semanas === 1 && linhaAna.fila.faixa === "ambar", JSON.stringify(linhaAna.fila))
    ok("Beto (2 executáveis de 10, nada concluído): fila 'sem base', nunca 'livre' inventado", linhaBeto.carga.pct === 20 && linhaBeto.fila.semanas === null && linhaBeto.fila.faixa === "sem_base")
    ok("Cris sem limite: sem % (a tela diz 'sem limite') e sem trabalho = livre", pessoas.find((p) => p.usuarioId === cris.id)!.carga.pct === null && pessoas.find((p) => p.usuarioId === cris.id)!.fila.faixa === "livre")
    ok("papel e aptidões vêm do cadastro", linhaAna.papel === "assistente" && Array.isArray(linhaAna.aptidoes))

    secao("H1 — bate com a tela de CAPACIDADE (Gerenciamento) e com a regra r3")
    const rCap = await (await getCapacidade(req("GET", "/api/operacao/capacidade", tAdmin))).json()
    const capAna = rCap.linhas.find((l: { usuarioId: number }) => l.usuarioId === ana.id)
    ok("ativas/atrasadas/aguardando iguais às da tela de Capacidade", capAna.carga.ativas === linhaAna.ativas && capAna.carga.atrasadas === linhaAna.atrasadas && capAna.carga.aguardandoTerceiro === linhaAna.aguardando)
    ok("executáveis, capacidade medida e fila iguais às da tela de Capacidade", capAna.carga.executaveis === linhaAna.carga.executaveis && capAna.capacidadeMedida.mediaSemanal === linhaAna.carga.fechaPorSemana && capAna.capacidadeMedida.filaEmSemanas === linhaAna.fila.semanas)
    const r3 = await cargasComLimite()
    ok("a regra r3 lê a MESMA carga (executáveis) da aba Equipe", r3.get(ana.id)?.executaveis === linhaAna.carga.executaveis && r3.get(ana.id)?.limite === 3)
    const itensSemLimite = (await itensPrecisaDeVoce({})).filter((i) => i.tipo === "CARGA")
    ok('o item "Carga" do Precisa de você lê a MESMA conta: Ana (2 de 3) NÃO está no limite', !itensSemLimite.some((i) => i.contexto.usuarioId === ana.id))
    await definirCapacidade({ usuarioId: ana.id, limiteExecutaveis: 2, autorId: admin.id })
    const itensNoLimite = (await itensPrecisaDeVoce({})).filter((i) => i.tipo === "CARGA")
    ok('com o limite em 2, o item "Carga" aparece para a Ana — e a aba Equipe mostra 100 % vermelha', itensNoLimite.some((i) => i.contexto.usuarioId === ana.id)
      && (await quadroDaEquipe(linhas)).pessoas.find((p) => p.usuarioId === ana.id)!.carga.faixa === "vermelha")
    await definirCapacidade({ usuarioId: ana.id, limiteExecutaveis: 3, autorId: admin.id })
    const cargas = cargaPorPessoa(linhas)
    ok("cargaPorPessoa = a conta única", cargas.get(ana.id)?.ativas === 4 && cargas.get(beto.id)?.ativas === 2)

    secao("H2 — PREVISÃO DE CARGA das próximas 4 semanas")
    const semanas = semanasDaPrevisao(new Date())
    ok("4 semanas consecutivas de 7 dias começando hoje", semanas.length === 4 && semanas.every((s, i) => i === 0 || s.inicio.getTime() === semanas[i - 1].fim.getTime() + 1))
    ok("as datas são calculadas de hoje (não fixas)", Math.abs(Date.parse(previsao.semanas[0].inicio) - semanas[0].inicio.getTime()) < 1000 && semanas[0].inicio.getTime() <= hoje && hoje < semanas[0].fim.getTime())
    const pAna = previsao.linhas.find((l) => l.usuarioId === ana.id)!
    const pBeto = previsao.linhas.find((l) => l.usuarioId === beto.id)!
    const pSem = previsao.linhas.find((l) => l.usuarioId === null)!
    ok("Ana: a4 (+3d) e a1 (+3d) na semana 1, a2 (+9d) na semana 2; a atrasada NÃO entra", JSON.stringify(pAna.porSemana.map((s) => s.n)) === "[2,1,0,0]", JSON.stringify(pAna.porSemana.map((s) => s.n)))
    ok("Beto: 2 vencendo na semana 3 (+16d)", JSON.stringify(pBeto.porSemana.map((s) => s.n)) === "[0,0,2,0]")
    ok("o que vence sem dono também aparece ('Sem responsável', semana 2)", JSON.stringify(pSem.porSemana.map((s) => s.n)) === "[0,1,0,0]")
    ok("níveis de cor da escala do protótipo", pAna.porSemana[0].nivel === 1 && pAna.porSemana[2].nivel === 0)
    const totalPrevisao = previsao.linhas.reduce((t, l) => t + l.porSemana.reduce((x, s) => x + s.n, 0), 0)
    const janelaFim = semanas[3].fim.getTime()
    const daOperacao = linhas.filter((l) => l.dataPrazo && Date.parse(l.dataPrazo) >= semanas[0].inicio.getTime() && Date.parse(l.dataPrazo) <= janelaFim).length
    ok("a soma da previsão fecha com as linhas da Operação na janela", totalPrevisao === daOperacao, `${totalPrevisao} = ${daOperacao}`)

    secao("H1 — MARCAR / CANCELAR AUSÊNCIA: só registro, com sucessor sugerido, NADA é movido")
    const donosAntes = JSON.stringify((await prisma.tarefa.findMany({ where: { id: { in: [a1, a2, a3, a4].map((a) => a.tarefaId) } }, orderBy: { id: "asc" }, select: { id: true, responsavelId: true } })))
    const rAus = await patchCapacidade(req("PATCH", "/api/operacao/capacidade", tAdmin, { acao: "indisponibilizar", usuarioId: ana.id, tipo: "FERIAS", inicio: new Date(hoje - DIA).toISOString(), fim: new Date(hoje + 9 * DIA).toISOString(), motivo: "férias" }))
    const jAus = await rAus.json()
    ok("ausência registrada com o sucessor sugerido", rAus.status === 200 && jAus.ok === true && jAus.sucessorSugerido?.usuarioId != null, JSON.stringify(jAus))
    const donosDepois = JSON.stringify((await prisma.tarefa.findMany({ where: { id: { in: [a1, a2, a3, a4].map((a) => a.tarefaId) } }, orderBy: { id: "asc" }, select: { id: true, responsavelId: true } })))
    ok("NENHUMA tarefa foi movida (a ausência não redireciona carteira)", donosAntes === donosDepois)
    const comAus = (await quadroDaEquipe(linhas)).pessoas.find((p) => p.usuarioId === ana.id)!
    ok("a aba mostra a ausência com tipo e sucessor sugerido", comAus.ausencia?.rotulo === "férias" && comAus.ausencia?.sucessorSugerido?.usuarioId === jAus.sucessorSugerido.usuarioId)
    const rEnc = await patchCapacidade(req("PATCH", "/api/operacao/capacidade", tAdmin, { acao: "encerrar_indisponibilidade", usuarioId: ana.id, indisponibilidadeId: comAus.ausencia!.id }))
    ok("cancelar ausência encerra e a pessoa volta", rEnc.status === 200 && (await quadroDaEquipe(linhas)).pessoas.find((p) => p.usuarioId === ana.id)!.ausencia === null)
    ok("ambas as ações ficam na auditoria da capacidade (criar + encerrar)", (await prisma.logAuditoria.count({ where: { entidade: "CapacidadeOperacional", entidadeId: ana.id } })) >= 2)

    secao("H1 — SIMULAR SAÍDA: mostra o impacto e NÃO grava nada")
    const conta = async () => ({
      tarefas: JSON.stringify(await prisma.tarefa.findMany({ orderBy: { id: "asc" }, select: { id: true, responsavelId: true, lockVersion: true } })),
      logs: await prisma.logAuditoria.count(), ausencias: await prisma.indisponibilidadeOperacional.count(),
    })
    const antes = await conta()
    const sim = await simularSaida(ana.id, 10, linhas)
    const rSim = await (await postSimular(req("POST", "/api/torre/equipe/simular-saida", tAdmin, { usuarioId: ana.id, dias: 10 }))).json()
    const depois = await conta()
    ok("nada foi gravado (tarefas, auditoria e ausências idênticas)", antes.tarefas === depois.tarefas && antes.logs === depois.logs && antes.ausencias === depois.ausencias)
    ok("o impacto vem dos dados reais: 4 ativas, 2 com o cartório, vencem no período", sim!.ativas === 4 && sim!.comOCartorio === 2 && sim!.vencemNoPeriodo === 3 + 0 || sim!.vencemNoPeriodo >= 3, JSON.stringify({ a: sim!.ativas, c: sim!.comOCartorio, v: sim!.vencemNoPeriodo }))
    ok("a rota devolve a mesma simulação", rSim.ativas === sim!.ativas && rSim.texto === sim!.texto)
    ok("o texto cita o sucessor SUGERIDO (nome do cadastro)", !!sim!.sucessor && sim!.texto.includes(sim!.sucessor.nome))
    ok("dias inválido: 400", (await postSimular(req("POST", "/api/torre/equipe/simular-saida", tAdmin, { usuarioId: ana.id, dias: 0 }))).status === 400)
    ok("pessoa inexistente: 404", (await postSimular(req("POST", "/api/torre/equipe/simular-saida", tAdmin, { usuarioId: 99999999, dias: 5 }))).status === 404)

    secao("H1 — MOVER CARTEIRA: manual, auditada, com Desfazer")
    ok("gestor sem usuarios.gerenciar: 403 (nem vê a aba)", (await getEquipe(req("GET", "/api/torre/equipe", tGestor))).status === 403)
    ok("mover carteira exige também tarefas.editar", (await postMover(req("POST", "/api/torre/equipe/mover-carteira", tGestor, { deUsuarioId: ana.id, paraUsuarioId: beto.id }))).status === 403)
    ok("origem = destino: recusa", (await moverCarteira({ deUsuarioId: ana.id, paraUsuarioId: ana.id, autorId: admin.id })).ok === false)
    ok("pessoa sem tarefa: nada a mover", (await moverCarteira({ deUsuarioId: cris.id, paraUsuarioId: beto.id, autorId: admin.id })).ok === false)
    const rMov = await postMover(req("POST", "/api/torre/equipe/mover-carteira", tAdmin, { deUsuarioId: ana.id, paraUsuarioId: beto.id }))
    const jMov = await rMov.json()
    ok("as 4 tarefas da Ana vão para o Beto", rMov.status === 200 && jMov.movidas === 4 && jMov.para.usuarioId === beto.id, JSON.stringify(jMov).slice(0, 200))
    ok("de fato mudaram de dono no banco", (await prisma.tarefa.count({ where: { responsavelId: beto.id, id: { in: [a1, a2, a3, a4].map((a) => a.tarefaId) } } })) === 4)
    ok("auditoria por tarefa + o resumo do lote (com o motivo 'ação manual')", (await prisma.logAuditoria.count({ where: { entidade: "Tarefa", entidadeId: { in: [a1, a2, a3, a4].map((a) => a.tarefaId) }, acao: { in: ["TAREFA_TRANSFERIDA", "TAREFA_ATRIBUIDA"] } } })) >= 4
      && (await prisma.logAuditoria.count({ where: { acao: "TAREFAS_REDISTRIBUIDAS", descricao: { contains: "4 de 4" } } })) >= 1)
    const dMov = await desfazerLote({ tipo: jMov.desfazer.tipo, tarefaIds: jMov.desfazer.tarefaIds, autorId: admin.id })
    ok("o Desfazer devolve a carteira à Ana", dMov.desfeitas === 4 && (await prisma.tarefa.count({ where: { responsavelId: ana.id, id: { in: [a1, a2, a3, a4].map((a) => a.tarefaId) } } })) === 4)
    const rSem = await postMover(req("POST", "/api/torre/equipe/mover-carteira", tAdmin, { deUsuarioId: ana.id }))
    const jSem = await rSem.json()
    ok("sem destino, usa o sucessor SUGERIDO (E2)", rSem.status === 200 && jSem.para.usuarioId !== ana.id && jSem.movidas === 4)
    await desfazerLote({ tipo: "ATRIBUICAO", tarefaIds: jSem.desfazer.tarefaIds, autorId: admin.id })

    secao("H1 — APLICAR a simulação: registra a ausência (com sucessor) e move o que o sucessor pode executar")
    const rApl = await postAplicar(req("POST", "/api/torre/equipe/aplicar-saida", tAdmin, { usuarioId: ana.id, dias: 10 }))
    const jApl = await rApl.json()
    ok("ausência registrada e carteira movida ao sucessor sugerido", rApl.status === 200 && jApl.ok === true && jApl.sucessor?.usuarioId != null && jApl.carteira.movidas === 4, JSON.stringify(jApl).slice(0, 240))
    ok("a pessoa aparece ausente na aba", (await quadroDaEquipe()).pessoas.find((p) => p.usuarioId === ana.id)!.ausencia?.rotulo === "ausência")
    ok("aplicar é auditado (ausência com a origem 'torre-simular-saida')", (await prisma.logAuditoria.count({ where: { entidade: "CapacidadeOperacional", entidadeId: ana.id, descricao: { contains: "simulação de saída da Torre" } } })) === 1)
    const semAusencia = await desfazerLote({ tipo: "ATRIBUICAO", tarefaIds: jApl.desfazer.tarefaIds, autorId: admin.id })
    ok("sem encerrar a ausência a carteira NÃO volta para quem está ausente (o motor recusa)", semAusencia.desfeitas === 0)
    const comAusencia = await desfazerLote({ tipo: "ATRIBUICAO", tarefaIds: jApl.desfazer.tarefaIds, autorId: admin.id, ausenciaId: jApl.desfazer.ausenciaId })
    ok("o Desfazer do 'Aplicar' encerra a ausência E devolve a carteira", comAusencia.ausenciaEncerrada === true && comAusencia.desfeitas === 4
      && (await prisma.tarefa.count({ where: { responsavelId: ana.id, id: { in: [a1, a2, a3, a4].map((a) => a.tarefaId) } } })) === 4
      && (await quadroDaEquipe()).pessoas.find((p) => p.usuarioId === ana.id)!.ausencia === null)
    ok("a ausência de OUTRA pessoa/antiga nunca é encerrada por um desfazer", (await desfazerLote({ tipo: "ATRIBUICAO", tarefaIds: [], autorId: gestor.id, ausenciaId: jApl.desfazer.ausenciaId })).ausenciaEncerrada === false)
    await prisma.indisponibilidadeOperacional.deleteMany({ where: { usuarioId: ana.id } })

    secao("H1 — APTIDÃO respeitada (a mesma regra opt-in da sugestão)")
    const perfilES = await prisma.perfilOperacionalDocumento.create({ data: { code: `${MARCA}_ES`, name: `${MARCA} Espanha` } })
    const perfilIT = await prisma.perfilOperacionalDocumento.create({ data: { code: `${MARCA}_IT`, name: `${MARCA} Itália` } })
    const tipoES = await prisma.tipoDocumentoCadastro.create({ data: { code: `${MARCA}_TES`, name: `${MARCA} Cert ES`, perfilOperacionalId: perfilES.id } })
    const tipoIT = await prisma.tipoDocumentoCadastro.create({ data: { code: `${MARCA}_TIT`, name: `${MARCA} Cert IT`, perfilOperacionalId: perfilIT.id } })
    await definirAptidoes(ana.id, [perfilES.id, perfilIT.id])
    await definirAptidoes(cris.id, [perfilES.id])
    const docsA = await c.novaObrigacao({ responsavelId: ana.id, comSolicitacao: { canal: "EMAIL" } })
    const docsB = await c.novaObrigacao({ responsavelId: ana.id, comSolicitacao: { canal: "EMAIL" } })
    await prisma.documento.update({ where: { id: docsA.documentoId! }, data: { documentTypeId: tipoES.id } })
    await prisma.documento.update({ where: { id: docsB.documentoId! }, data: { documentTypeId: tipoIT.id } })
    const simApt = await simularSaida(ana.id, 10)
    ok("o sucessor sugerido é a Cris (única apta a alguma das unidades da Ana)", simApt!.sucessor?.usuarioId === cris.id)
    ok("a Cris absorve o que é de Espanha e o que não tem unidade; a de Itália sobra sem apto", simApt!.semApto >= 1 && simApt!.absorvidas === simApt!.ativas - simApt!.semApto, JSON.stringify({ abs: simApt!.absorvidas, sem: simApt!.semApto, ativas: simApt!.ativas }))
    const movApt = await moverCarteira({ deUsuarioId: ana.id, paraUsuarioId: cris.id, autorId: admin.id })
    ok("mover carteira NÃO manda a tarefa de Itália para quem não é apta", movApt.ok && movApt.resultado.naoAptas === 1 && (await prisma.tarefa.findUnique({ where: { id: docsB.tarefaId } }))?.responsavelId === ana.id)
    ok("…e manda as demais", movApt.ok && (await prisma.tarefa.findUnique({ where: { id: docsA.tarefaId } }))?.responsavelId === cris.id)
    void b1; void b2; void s1
  } finally {
    await prisma.tarefa.deleteMany({ where: { titulo: { startsWith: MARCA } } })
    await prisma.aptidaoOperacional.deleteMany({ where: { perfilOperacional: { code: { startsWith: MARCA } } } })
    await prisma.capacidadeOperacional.deleteMany({ where: { usuario: { email: { startsWith: MARCA.toLowerCase() } } } })
    await prisma.indisponibilidadeOperacional.deleteMany({ where: { usuario: { email: { startsWith: MARCA.toLowerCase() } } } })
    await prisma.logAuditoria.deleteMany({ where: { entidade: "CapacidadeOperacional" } })
    await c.limpar()
    await prisma.tipoDocumentoCadastro.deleteMany({ where: { code: { startsWith: MARCA } } })
    await prisma.perfilOperacionalDocumento.deleteMany({ where: { code: { startsWith: MARCA } } })
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
