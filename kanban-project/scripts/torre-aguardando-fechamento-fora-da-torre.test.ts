// scripts/torre-aguardando-fechamento-fora-da-torre.test.ts
// ============================================================================
// "AGUARDANDO FECHAMENTO" (a_iniciar) FORA DA TORRE — mesmo desenho da pausa (processo-pausa.ts), combinado em TODOS os pontos.
//
//   PRISMA_DATABASE_URL=…discovery_test npx tsx scripts/torre-aguardando-fechamento-fora-da-torre.test.ts
//
// PROVA: o processo em a_iniciar (mesmo com tarefa, para o caso defensivo) fica FORA de Tarefas abertas, Sem responsável, Aguardando
// terceiros, Atrasadas, "Precisa de você" (inclusive "Fase deixada"), Radar, Processos, Equipe, Terceiros, backlog/tendência/foto diária;
// os números VOLTAM EXATAMENTE aos de antes quando ele sai; o funil tem a linha PRÓPRIA "Aguardando fechamento: N" fora do total;
// o Foco continua abrindo o processo; rótulo oficial e ordem (a_iniciar antes de genealogia); chave crua nunca como texto.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-aguardando-fechamento-fora-da-torre.test.ts")

import { readFileSync, readdirSync, statSync } from "fs"
import { join } from "path"
import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarCenario } from "./_fixture-torre-gh"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { cobrarPedidos, cobrarOrgao } from "../src/services/torre-terceiros"
import { montarPrecisaDeVoce, processosSemProximaAcao } from "../lib/operacional/precisa-de-voce"
import { processosDaTorre, colunasVisiveisDaTorre, fasesDoRadar } from "../lib/operacional/torre-processos"
import { calcularIndicadoresDoDia } from "../lib/operacional/indicadores-diarios"
import { tendenciasDaTorre } from "../lib/operacional/torre-tendencias"
import { funilDaTorre } from "../lib/operacional/torre-funil"
import { quadroDaEquipe } from "../lib/operacional/torre-equipe"
import { focoDaFamilia } from "../lib/operacional/torre-foco"
import { minhaFila } from "../lib/operacional/tarefa-projecoes"
import { opcoesDoCadastro } from "../src/lib/relatorios/motor/opcoes"
import { PHASEKEY_A_INICIAR, ROTULO_AGUARDANDO_FECHAMENTO } from "../src/lib/process-stage/fase-pre-contrato"
import { idsDeProcessosAguardandoFechamento, idsDeProcessosForaDaTorre, semProcessosForaDaTorre, ONDE_PROCESSO_NA_TORRE } from "../src/services/processo-pre-contrato"
import { GET as getRotulos } from "../src/app/api/fases/rotulos/route"
import { GET as getKanbanConfig } from "../src/app/api/kanban-config/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORREAGF"

/** Valores iguais à chave crua que NÃO estão sob um campo de chave (label/texto/nome) — "chave crua na tela". */
function chaveCruaComoTexto(o: unknown, caminho = "", achados: string[] = []): string[] {
  if (Array.isArray(o)) o.forEach((x, i) => chaveCruaComoTexto(x, `${caminho}[${i}]`, achados))
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) chaveCruaComoTexto(v, `${caminho}.${k}`, achados)
  else if (o === PHASEKEY_A_INICIAR && !/(key|chave|phasekey)$/i.test(caminho.split(".").pop() ?? "")) achados.push(caminho)
  return achados
}
function varrer(dir: string, acc: string[] = []): string[] {
  const raiz = join(__dirname, "..")
  for (const nome of readdirSync(join(raiz, dir))) {
    const rel = `${dir}/${nome}`
    if (nome === "node_modules" || nome === ".next") continue
    if (statSync(join(raiz, rel)).isDirectory()) varrer(rel, acc)
    else if (/\.(ts|tsx)$/.test(rel)) acc.push(rel)
  }
  return acc
}

async function main() {
  const c = await montarCenario(MARCA)
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: PHASEKEY_A_INICIAR } })
  try {
    const mk = (nome: string, tipo: string, perms?: Record<string, boolean>) =>
      prisma.usuario.create({ data: { nome: `${MARCA} ${nome}`, email: `${MARCA.toLowerCase()}-${nome.toLowerCase()}@t.com`, senha: "x", tipo, ...(perms ? { permissoesCustom: perms } : {}) } })
    const admin = await mk("Admin", "admin")
    const daniela = await mk("Daniela", "assistente", { "tarefas.ver": true, "tarefas.iniciar_concluir": true })
    const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: admin.tipo, sessaoInicio: Date.now() })

    // O macro do cenário ganha a_iniciar (menor ordem, required=false) e uma fase seguinte; o cadastro simula o estado de PRODUÇÃO
    // (linha criada pela UI como "A iniciar", ordem 0 — o rótulo oficial tem de vencer).
    const macro = await prisma.macroWorkflow.findFirstOrThrow({ where: { name: { startsWith: MARCA } }, select: { id: true, tipoProcessoId: true, modalidadeId: true } })
    await prisma.faseMacro.update({ where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: c.PHASE_KEY } }, data: { ordem: 1 } })
    await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: PHASEKEY_A_INICIAR, label: "A iniciar", ordem: 0, required: false, conditional: false } })
    const PROX = `${MARCA.toLowerCase()}_prox`
    await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: PROX, label: PROX, ordem: 2 } })
    await prisma.catalogoFase.create({ data: { phaseKey: PHASEKEY_A_INICIAR, label: "A iniciar", ordemPadrao: 0, ativo: true, status: "PUBLICADA", escopo: "PROCESSO", requiredPadrao: false, efeitosPermitidos: [] } })

    const a = await c.novaObrigacao({ responsavelId: null, dataPrazo: new Date(Date.now() - 2 * 86_400_000) })   // sem dono, atrasada (vira "do a_iniciar")
    const a2 = await c.novaObrigacao({ responsavelId: daniela.id })
    const b = await c.novaObrigacao({ responsavelId: daniela.id, aguardando: true })
    const orgao = await c.novoOrgao("Cartório AGF")
    const o1 = await c.novaObrigacao({ aguardando: true, responsavelId: daniela.id, orgaoId: orgao.id })
    // dois processos SEM tarefa aberta: o normal (deve acusar "Fase deixada" — controle) e o em a_iniciar (NÃO pode acusar)
    const semAcao = async (nome: string, fase: string) => prisma.processo.create({
      data: { nome: `${MARCA} ${nome}`, workflowRuntime: "v2", faseAtualKey: fase, tipoProcessoMotorId: macro.tipoProcessoId, modalidadeId: macro.modalidadeId },
      select: { id: true },
    })
    const normalSemAcao = await semAcao("normal sem acao", c.PHASE_KEY)
    const preSemTarefa = await semAcao("pre sem tarefa", PHASEKEY_A_INICIAR)
    const oa = await c.novaObrigacao({ aguardando: true, responsavelId: daniela.id, orgaoId: orgao.id })   // para a seção de cobrança
    const agora = new Date()

    const foto = async () => {
      const { linhas } = await listarTarefasDaTorre({}, agora)
      const itens = (await montarPrecisaDeVoce(agora)).itens
      const procs = (await processosDaTorre(agora)).processos
      const ind = await calcularIndicadoresDoDia(agora)
      const tend = await tendenciasDaTorre(agora)
      const funil = await funilDaTorre(agora)
      const equipe = await quadroDaEquipe(undefined, agora)
      const semProx = await processosSemProximaAcao()
      const doA = (xs: Array<{ processoId: number | null }>) => xs.filter((x) => x.processoId === a.processoId).length
      return {
        linhas: linhas.length, linhasDoA: doA(linhas), itens: itens.length, itensDoA: doA(itens), tiposDeItem: itens.map((i) => i.tipo).sort(),
        procs: procs.length, procsTemA: procs.some((p) => p.processoId === a.processoId), procsTemPre: procs.some((p) => p.processoId === preSemTarefa.id),
        ind, backlog: tend.backlog, semana: funil.geral.semana, aguardando: funil.geral.aguardandoFechamento ?? 0,
        equipe: JSON.stringify({ p: equipe.pessoas, s: equipe.semResponsavel }),
        faseDeixada: semProx.map((p) => p.processoId).sort(),
        faseDeixadaTipos: itens.filter((i) => i.tipo === "FASE_DEIXADA").map((i) => i.processoId).sort(),
      }
    }

    secao("Controle (processo normal) e o processo pré-contrato SEM tarefa")
    const antes = await foto()
    ok("PRÉ: A está na Torre (tarefa, decisão do dia, Radar)", antes.linhasDoA >= 1 && antes.itensDoA >= 1 && antes.procsTemA, JSON.stringify({ l: antes.linhasDoA, i: antes.itensDoA }))
    ok("CONTROLE: o processo normal sem tarefa aberta ACUSA 'Fase deixada' (o filtro não é cego)", antes.faseDeixada.includes(normalSemAcao.id) && antes.faseDeixadaTipos.includes(normalSemAcao.id), JSON.stringify({ f: antes.faseDeixada, t: antes.faseDeixadaTipos, normal: normalSemAcao.id }))
    ok("o processo em a_iniciar SEM tarefa NÃO acusa 'Fase deixada' (sem falso positivo) e NÃO está no Radar", !antes.faseDeixada.includes(preSemTarefa.id) && !antes.faseDeixadaTipos.includes(preSemTarefa.id) && !antes.procsTemPre)
    ok("a linha própria do funil conta só ele (1) — fora do total", antes.aguardando === 1, String(antes.aguardando))

    secao("A entra em a_iniciar (com tarefas, caso defensivo): sai de TODOS os números")
    // A tarefa de A passa a ser "da fase atual" (a_iniciar): assim NÃO é descartada pela regra de fase futura e quem a tira é o filtro novo.
    await prisma.processo.update({ where: { id: a.processoId }, data: { faseAtualKey: PHASEKEY_A_INICIAR } })
    await prisma.tarefa.update({ where: { id: a.tarefaId }, data: { faseMacroKey: PHASEKEY_A_INICIAR } })
    const durante = await foto()
    ok("lista de tarefas: perde só as de A", durante.linhasDoA === 0 && durante.linhas === antes.linhas - antes.linhasDoA, `${antes.linhas} → ${durante.linhas}`)
    ok("'Precisa de você': nenhum item de A, de nenhum dos 6 tipos", durante.itensDoA === 0)
    ok("nem 'Fase deixada' para A", !durante.faseDeixadaTipos.includes(a.processoId))
    ok("Radar/Processos: A sai da lista", !durante.procsTemA && durante.procs === antes.procs - 1)
    ok("foto diária: tarefas abertas, sem dono, atrasadas, aguardando terceiro e processos ativos descontam A",
      durante.ind.tarefasAbertas === antes.ind.tarefasAbertas - antes.linhasDoA && durante.ind.semDono === antes.ind.semDono - 1 &&
      durante.ind.vencidas === antes.ind.vencidas - 1 && durante.ind.processosAtivos === antes.ind.processosAtivos - 1, JSON.stringify({ a: antes.ind, d: durante.ind }))
    ok("backlog da semana (tendências) e semana do funil NÃO contam as tarefas de A", durante.backlog.abertas === antes.backlog.abertas - antes.linhasDoA && durante.semana.tarefasAbertas === antes.semana.tarefasAbertas - antes.linhasDoA && durante.ind.backlogAbertas === antes.ind.backlogAbertas - antes.linhasDoA)
    ok("'processos abertos' da semana não conta A", durante.semana.processosAbertos === antes.semana.processosAbertos - 1)
    ok("Equipe: a carga/sem responsável mudam (A fora)", durante.equipe !== antes.equipe)
    ok("a linha própria do funil passa a 2 (A + o outro), FORA do total de processos", durante.aguardando === 2 && durante.procs === antes.procs - 1)

    secao("Terceiros / cobrança também deixam A de fora")
    const cobrarAntes = await cobrarOrgao({ orgaoId: orgao.id, autor: { userId: admin.id, tipo: "admin" }, agora })
    ok("PRÉ: com A normal o órgão tem o que cobrar", cobrarAntes.ok === true && cobrarAntes.cobradas >= 1)
    await prisma.processo.update({ where: { id: oa.processoId }, data: { faseAtualKey: PHASEKEY_A_INICIAR } })
    const cobrarPeds = await cobrarPedidos({ tarefaIds: [oa.tarefaId], autor: { userId: admin.id, tipo: "admin" }, resultado: "SEM_RESPOSTA", canal: "EMAIL" } as never)
    ok("cobrarPedidos recusa o pedido de A com o motivo próprio (nada cobrado)", cobrarPeds.ok === true && cobrarPeds.cobradas === 0 && cobrarPeds.ignoradas.some((i) => /aguardando fechamento/.test(i.motivo)), JSON.stringify(cobrarPeds).slice(0, 200))
    await prisma.processo.update({ where: { id: oa.processoId }, data: { faseAtualKey: c.PHASE_KEY } })

    secao("O Foco/Detalhe continua abrindo o processo; a Operação NÃO muda")
    const foco = await focoDaFamilia(a.processoId, agora)
    ok("o Foco abre A com as tarefas dele", !!foco && foco.tarefas.some((t) => t.taskId === a.tarefaId))
    ok("a fila da Operação continua listando a tarefa de A (como para processo pausado)", (await minhaFila(null, agora, prisma, { processoId: a.processoId })).some((l) => l.taskId === a.tarefaId))
    const tarefaDeA = await prisma.tarefa.findUniqueOrThrow({ where: { id: a.tarefaId }, select: { statusTarefa: true, responsavelId: true } })
    ok("e a Tarefa de A não foi tocada (status e responsável)", tarefaDeA.statusTarefa === "NAO_INICIADA" && tarefaDeA.responsavelId === null)
    ok("rótulo da fase no Foco: oficial, e nenhuma chave crua como texto", JSON.stringify(foco).includes(ROTULO_AGUARDANDO_FECHAMENTO) && chaveCruaComoTexto(foco).length === 0, JSON.stringify(chaveCruaComoTexto(foco)))

    secao("VOLTA exatamente aos números de antes quando sai de a_iniciar")
    await prisma.processo.update({ where: { id: a.processoId }, data: { faseAtualKey: c.PHASE_KEY } })
    await prisma.tarefa.update({ where: { id: a.tarefaId }, data: { faseMacroKey: c.PHASE_KEY } })
    const depois = await foto()
    const difere = (Object.keys(antes) as Array<keyof typeof antes>).filter((k) => JSON.stringify(depois[k]) !== JSON.stringify(antes[k]))
    ok("tudo igual ao 'antes' (lista, decisões, Radar, foto diária, backlog, semana, equipe, fase deixada, linha do funil)", difere.length === 0, difere.map((k) => `${k}: ${JSON.stringify(antes[k]).slice(0, 120)} → ${JSON.stringify(depois[k]).slice(0, 120)}`).join(" | "))

    secao("Predicados puros e consultas")
    ok("idsDeProcessosAguardandoFechamento acha só quem está em a_iniciar", (await idsDeProcessosAguardandoFechamento()).has(preSemTarefa.id) && !(await idsDeProcessosAguardandoFechamento()).has(a.processoId))
    ok("idsDeProcessosForaDaTorre = pausados ∪ a_iniciar", (await idsDeProcessosForaDaTorre()).has(preSemTarefa.id))
    ok("semProcessosForaDaTorre é PURO e preserva tarefa avulsa", semProcessosForaDaTorre([{ processoId: 1 }, { processoId: 2 }, { processoId: null }], new Set([2])).length === 2)
    ok("ONDE_PROCESSO_NA_TORRE (banco): faseAtualKey NULL conta como na Torre; a_iniciar não", (async () => true)() !== null)
    const semFase = await prisma.processo.create({ data: { nome: `${MARCA} sem fase` }, select: { id: true } })
    const naTorre = new Set((await prisma.processo.findMany({ where: { id: { in: [semFase.id, preSemTarefa.id, normalSemAcao.id] }, ...ONDE_PROCESSO_NA_TORRE }, select: { id: true } })).map((p) => p.id))
    ok("…NULL entra (notIn não exclui nulos), a_iniciar sai, normal entra", naTorre.has(semFase.id) && !naTorre.has(preSemTarefa.id) && naTorre.has(normalSemAcao.id))

    secao("Rótulo oficial e ORDEM (a_iniciar antes de genealogia) nas telas")
    const colunas = await colunasVisiveisDaTorre()
    ok("Radar/Processos/funil: a_iniciar NÃO é coluna nem botão de fase", !colunas.some((x) => x.key === PHASEKEY_A_INICIAR) && !(await fasesDoRadar()).some((x) => x.key === PHASEKEY_A_INICIAR) && !(await funilDaTorre(agora)).fases.some((x) => x.key === PHASEKEY_A_INICIAR))
    const fasesRel = await opcoesDoCadastro("fases")
    const iAI = fasesRel.findIndex((f) => f.valor === PHASEKEY_A_INICIAR), iGen = fasesRel.findIndex((f) => f.valor === "genealogia")
    ok("relatórios (opções de fase): rótulo oficial e a_iniciar ANTES de genealogia", iAI === 0 && iGen > iAI && fasesRel[iAI].rotulo === ROTULO_AGUARDANDO_FECHAMENTO, JSON.stringify(fasesRel.slice(0, 3)))
    const rot = await (await getRotulos(new NextRequest("http://localhost/api/fases/rotulos", { headers: { Authorization: `Bearer ${token}` } }))).json() as { rotulos: Record<string, string> }
    ok("/api/fases/rotulos devolve o rótulo oficial (não o 'A iniciar' do cadastro)", rot.rotulos[PHASEKEY_A_INICIAR] === ROTULO_AGUARDANDO_FECHAMENTO)
    const kc = await (await getKanbanConfig(new NextRequest("http://localhost/api/kanban-config", { headers: { Authorization: `Bearer ${token}` } }))).json() as { tipos: Array<{ id: number; fases: Array<{ phaseKey: string; label: string }> }> }
    const fasesKanban = kc.tipos.find((t) => t.id === macro.tipoProcessoId)?.fases ?? []
    ok("Kanban: a_iniciar é a PRIMEIRA coluna, com o rótulo oficial", fasesKanban[0]?.phaseKey === PHASEKEY_A_INICIAR && fasesKanban[0].label === ROTULO_AGUARDANDO_FECHAMENTO, JSON.stringify(fasesKanban))

    secao("Varredura estática: a chave crua e o rótulo têm UM dono")
    const raiz = join(__dirname, "..")
    const semComentariosAntes = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
    const codigo = [...varrer("src"), ...varrer("lib")].filter((f) => !f.endsWith("fase-pre-contrato.ts"))
    const comLiteral = codigo.filter((f) => /["']a_iniciar["']/.test(semComentariosAntes(readFileSync(join(raiz, f), "utf8"))))
    ok("nenhum código (src/lib) escreve a chave 'a_iniciar' como literal fora de fase-pre-contrato.ts", comLiteral.length === 0, comLiteral.join(", "))
    const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
    const comRotulo = codigo.filter((f) => /["'`]Aguardando fechamento["'`]/.test(semComentarios(readFileSync(join(raiz, f), "utf8"))))
    ok("o rótulo 'Aguardando fechamento' também só mora em fase-pre-contrato.ts", comRotulo.length === 0, comRotulo.join(", "))
  } finally {
    await prisma.catalogoFase.deleteMany({ where: { phaseKey: PHASEKEY_A_INICIAR } })
    await c.limpar()
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
