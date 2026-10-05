// scripts/torre-bola-com.test.ts
// ============================================================================
// TORRE NOVA, ETAPA A (01/10/2026) — "BOLA COM": a função única (`lib/operacional/torre-bola.ts`) e os campos ADITIVOS da linha:
// iniciouEm · bolaCom · bolaDesde · categoriaTerceiro · pedidaEm · cobrarEm (+ cobrarEmPadrao).
//
//   npx tsx scripts/torre-bola-com.test.ts   (banco de teste)
//
// PROVA:
//   • os SEIS valores (Equipe, Cartório, Cliente, Tradutor, Juízo, Consulado) e a regra: Cliente = AGUARDANDO_CLIENTE, terceiro =
//     categoria do órgão (`rotuloBola` do CADASTRO; sem categoria/rótulo → Cartório), Nossa = o resto; 'Aguardando a equipe' × 'Aguardando terceiros';
//   • `bolaDesde`: início da espera atual, só de registro real (auditoria → envio da subtarefa → envio do pedido → null);
//   • `pedidaEm` = SolicitacaoDocumento.dataEnvio; `cobrarEm` = o acompanhamento REGISTRADO, senão 7 dias corridos depois da última
//     cobrança/pedido (e `cobrarEmPadrao` avisa); nada a cobrar quando a bola é nossa; sem registro → null;
//   • a leitura é EM LOTE: 4 consultas, qualquer que seja o nº de linhas (sem N+1); o módulo é importável pela tela (sem prisma estático);
//   • os campos chegam na LinhaDaTorre sem mudar os existentes, e o Foco (detalhe do processo) os traz.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-bola-com.test.ts")

import { readFileSync } from "node:fs"
import { PrismaClient } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import {
  VALORES_DE_BOLA, ROTULOS_DE_TERCEIRO, DIAS_PADRAO_DA_COBRANCA, bolaDaLinha, ladoDaBola, rotuloDoLado, categoriaDoTerceiro, cobrarEmDe, montarBola,
  lerBolaEmLote, ehRotuloDeTerceiro, type LinhaParaBola, type FatosDaBola,
} from "../lib/operacional/torre-bola"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { focoDaFamilia } from "../lib/operacional/torre-foco"
import { bolaDoProcesso, processosDaTorre } from "../lib/operacional/torre-processos"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORREA_BOLA"
const DIA = 86_400_000
const ler = (p: string) => readFileSync(p, "utf8")

const linha = (o: Partial<LinhaParaBola> = {}): LinhaParaBola => ({ estadoOperacao: "FILA", esperandoDe: null, esperandoDesde: null, ...o })
const fatos = (o: Partial<FatosDaBola> = {}): FatosDaBola => ({ categorias: [], temOrgao: true, solicitacaoEnviadaEm: null, subtarefaEnviadaEm: null, proximoAcompanhamentoEm: null, ultimaCobrancaEm: null, ...o })

async function main() {
  secao("PURO — os valores e a regra")
  ok("os SEIS valores, na ordem: Equipe · Cartório · Cliente · Tradutor · Juízo · Consulado", VALORES_DE_BOLA.join(" · ") === "Equipe · Cartório · Cliente · Tradutor · Juízo · Consulado")
  ok("o vocabulário do cadastro (rotuloBola) é fechado: Cartório · Tradutor · Juízo · Consulado", ROTULOS_DE_TERCEIRO.join(" · ") === "Cartório · Tradutor · Juízo · Consulado" && ehRotuloDeTerceiro("Juízo") && !ehRotuloDeTerceiro("Cliente") && !ehRotuloDeTerceiro("Equipe") && !ehRotuloDeTerceiro("qualquer"))
  ok("Cliente = a tarefa espera o cliente", bolaDaLinha(linha({ esperandoDe: "cliente" }), "Tradutor") === "Cliente")
  ok("terceiro (esperandoDe) → o rótulo do órgão", bolaDaLinha(linha({ esperandoDe: "terceiro" }), "Tradutor") === "Tradutor" && bolaDaLinha(linha({ esperandoDe: "terceiro" }), "Juízo") === "Juízo" && bolaDaLinha(linha({ esperandoDe: "terceiro" }), "Consulado") === "Consulado")
  ok("terceiro pela SUBTAREFA em espera externa (estadoOperacao AGUARDANDO) — a mesma definição do cartão 'Aguardando terceiros'", bolaDaLinha(linha({ estadoOperacao: "AGUARDANDO" }), "Consulado") === "Consulado")
  ok("sem categoria/rótulo → 'Cartório'", bolaDaLinha(linha({ estadoOperacao: "AGUARDANDO" }), null) === "Cartório")
  ok("Nossa = o resto (inclusive FILA sem responsável)", bolaDaLinha(linha(), "Tradutor") === "Equipe" && bolaDaLinha(linha({ estadoOperacao: "CONCLUIDA" }), null) === "Equipe")
  ok("'Aguardando a equipe' × 'Aguardando terceiros' = Nossa × qualquer outro (o Cliente conta como terceiro)", VALORES_DE_BOLA.every((b) => (b === "Equipe") === (ladoDaBola(b) === "nossa") && rotuloDoLado(b) === (b === "Equipe" ? "Aguardando a equipe" : "Aguardando terceiros")))

  secao("PURO — a categoria do órgão (cadastro)")
  ok("vale a de MENOR ordem que declara um rótulo válido", categoriaDoTerceiro([{ ordem: 5, rotuloBola: "Juízo" }, { ordem: 2, rotuloBola: "Tradutor" }]) === "Tradutor")
  ok("categoria sem rótulo, inativa ou com rótulo fora do vocabulário não conta", categoriaDoTerceiro([{ ordem: 1, rotuloBola: null }, { ordem: 2, rotuloBola: "Juízo", ativo: false }, { ordem: 3, rotuloBola: "Ninguém" }]) === null)
  ok("sem categorias → null (quem chama cai em 'Cartório')", categoriaDoTerceiro([]) === null)

  secao("PURO — 'desde quando' só de registro real")
  const agora = new Date("2026-10-01T15:00:00Z")
  const iso = (d: number) => new Date(agora.getTime() - d * DIA).toISOString()
  const dt = (d: number) => new Date(agora.getTime() - d * DIA)
  const espera = linha({ estadoOperacao: "AGUARDANDO", esperandoDe: "terceiro" })
  ok("1º: o 'esperando desde' da auditoria", montarBola({ ...espera, esperandoDesde: iso(9) }, fatos({ subtarefaEnviadaEm: dt(5), solicitacaoEnviadaEm: dt(3) })).bolaDesde === iso(9))
  ok("2º: o envio da subtarefa em espera externa", montarBola(espera, fatos({ subtarefaEnviadaEm: dt(5), solicitacaoEnviadaEm: dt(3) })).bolaDesde === iso(5))
  ok("3º: o envio do pedido (SolicitacaoDocumento.dataEnvio)", montarBola(espera, fatos({ solicitacaoEnviadaEm: dt(3) })).bolaDesde === iso(3))
  ok("nenhum registro → null (registro antigo NUNCA é preenchido por suposição)", montarBola(espera, fatos()).bolaDesde === null)
  ok("com a aguardando a equipe, 'desde' é null", montarBola(linha({ esperandoDesde: iso(4) }), fatos({ solicitacaoEnviadaEm: dt(3) })).bolaDesde === null)
  ok("data inválida na auditoria é ignorada (cai no próximo registro real)", montarBola({ ...espera, esperandoDesde: "lixo" }, fatos({ solicitacaoEnviadaEm: dt(3) })).bolaDesde === iso(3))

  secao("PURO — pedida em e COBRAR EM (registrado, ou o padrão de 7 dias)")
  ok(`o padrão é ${DIAS_PADRAO_DA_COBRANCA} dias corridos`, DIAS_PADRAO_DA_COBRANCA === 7)
  const reg = cobrarEmDe({ proximoAcompanhamentoEm: dt(-4), ultimaCobrancaEm: dt(1), pedidaEm: dt(20) })
  ok("o acompanhamento REGISTRADO manda (não é o padrão)", reg.data?.getTime() === dt(-4).getTime() && reg.padrao === false)
  const sobreCobranca = cobrarEmDe({ proximoAcompanhamentoEm: null, ultimaCobrancaEm: dt(2), pedidaEm: dt(20) })
  ok("sem registro: 7 dias depois da ÚLTIMA cobrança (mais recente que o pedido) — e avisa que é o padrão", sobreCobranca.data?.getTime() === dt(2).getTime() + 7 * DIA && sobreCobranca.padrao === true)
  const sobrePedido = cobrarEmDe({ proximoAcompanhamentoEm: null, ultimaCobrancaEm: null, pedidaEm: dt(10) })
  ok("sem cobrança: 7 dias depois do pedido", sobrePedido.data?.getTime() === dt(10).getTime() + 7 * DIA && sobrePedido.padrao === true)
  const cobrancaAntiga = cobrarEmDe({ proximoAcompanhamentoEm: null, ultimaCobrancaEm: dt(30), pedidaEm: dt(2) })
  ok("cobrança de uma espera ANTIGA não adia o pedido novo (vale o mais recente)", cobrancaAntiga.data?.getTime() === dt(2).getTime() + 7 * DIA)
  ok("sem pedido, sem cobrança, sem acompanhamento → null", cobrarEmDe({ proximoAcompanhamentoEm: null, ultimaCobrancaEm: null, pedidaEm: null }).data === null)
  const m = montarBola(espera, fatos({ solicitacaoEnviadaEm: dt(10) }))
  ok("montarBola: pedidaEm = o envio do pedido; cobrarEm = +7 d; cobrarEmPadrao = true", m.pedidaEm === iso(10) && m.cobrarEm === new Date(dt(10).getTime() + 7 * DIA).toISOString() && m.cobrarEmPadrao === true)
  ok("com a aguardando a equipe não há o que cobrar (cobrarEm null) — mas o pedido continua sendo fato (pedidaEm)", (() => { const n = montarBola(linha(), fatos({ solicitacaoEnviadaEm: dt(10), proximoAcompanhamentoEm: dt(-2) })); return n.cobrarEm === null && n.cobrarEmPadrao === false && n.pedidaEm === iso(10) })())
  ok("sem órgão: categoriaTerceiro = null (a tarefa não tem terceiro cadastrado); a espera cai em 'Cartório'", (() => { const n = montarBola(espera, fatos({ temOrgao: false, categorias: null })); return n.categoriaTerceiro === null && n.bolaCom === "Cartório" })())
  ok("com órgão sem categoria: categoriaTerceiro = 'Cartório' (o padrão)", montarBola(linha(), fatos({ categorias: [] })).categoriaTerceiro === "Cartório")

  secao("PURO — a bola do PROCESSO (Radar/Processos) usa a mesma função e o mesmo vocabulário")
  const P = (bolaCom: (typeof VALORES_DE_BOLA)[number], dias: number | null = null) => ({ estadoOperacao: (bolaCom === "Equipe" ? "FILA" : "AGUARDANDO") as "FILA" | "AGUARDANDO", esperandoDe: (bolaCom === "Cliente" ? "cliente" : bolaCom === "Equipe" ? null : "terceiro") as "terceiro" | "cliente" | null, esperandoHaDias: dias, bolaCom })
  ok("metade ou mais com um terceiro → o terceiro dominante (Tradutor), com os dias da maior espera", JSON.stringify(bolaDoProcesso([P("Tradutor", 3), P("Tradutor", 8), P("Equipe")])) === '{"rotulo":"Tradutor","dias":8}')
  ok("terceiros misturados: conta como terceiro e vale o mais frequente (Juízo ×2 contra Cartório ×1)", bolaDoProcesso([P("Juízo"), P("Juízo"), P("Cartório"), P("Equipe")]).rotulo === "Juízo")
  ok("empate entre terceiros → a ordem de VALORES_DE_BOLA (Cartório antes de Consulado)", bolaDoProcesso([P("Consulado"), P("Cartório")]).rotulo === "Cartório")
  ok("só cliente → Cliente; menos da metade com outro → Nossa", bolaDoProcesso([P("Cliente", 5), P("Equipe")]).rotulo === "Cliente" && bolaDoProcesso([P("Cartório"), P("Equipe"), P("Equipe")]).rotulo === "Equipe" && bolaDoProcesso([]).rotulo === "Equipe")
  ok("linha SEM bolaCom (leitor antigo) mantém o critério de sempre", bolaDoProcesso([{ estadoOperacao: "AGUARDANDO", esperandoDe: "terceiro", esperandoHaDias: 2 }]).rotulo === "Cartório")

  secao("O módulo é importável pela TELA: sem prisma estático")
  const fonte = ler("lib/operacional/torre-bola.ts")
  ok("nenhum `import { prisma }` estático (só o leitor em lote carrega o cliente, sob demanda)", !/^\s*import\s*\{[^}]*prisma[^}]*\}\s*from\s*['"]@\/lib\/prisma['"]/m.test(fonte) && /await import\('@\/lib\/prisma'\)/.test(fonte))
  ok("o registro de categorias aceita só o vocabulário fechado: a lista mora em UM lugar (torre-bola.ts) e o cadastro a importa", /ROTULOS_DE_TERCEIRO/.test(ler("src/lib/gerenciamento/cadastros-registry.ts")))

  // ─── BANCO ───────────────────────────────────────────────────────────────
  const c = await montarCenario(MARCA)
  const limpar = async () => {
    await prisma.categoriaOrganizacao.deleteMany({ where: { nome: { startsWith: MARCA } } })
    await c.limpar()
  }
  try {
    secao("BANCO — a categoria do órgão (dado de cadastro) decide o rótulo")
    const mkCat = (nome: string, rotuloBola: string | null, ordem = 0) => prisma.categoriaOrganizacao.create({ data: { code: `${MARCA}_${nome}`.toUpperCase(), nome: `${MARCA} ${nome}`, rotuloBola, ordem } })
    const catTrad = await mkCat("Tradutores", "Tradutor", 1)
    const catCons = await mkCat("Consulados", "Consulado", 2)
    const catTrib = await mkCat("Tribunais", "Juízo", 3)
    const catSem = await mkCat("Sem rotulo", null, 4)
    const orgaoCom = async (nome: string, cats: Array<{ id: number }>) => {
      const o = await c.novoOrgao(nome)
      for (const cat of cats) await prisma.organizacaoCategoria.create({ data: { orgaoId: o.id, categoriaId: cat.id } })
      return o
    }
    const oCart = await orgaoCom("Cartório comum", [])
    const oSemRot = await orgaoCom("Categoria sem rótulo", [catSem])
    const oTrad = await orgaoCom("Tradutora", [catTrad])
    const oCons = await orgaoCom("Consulado", [catCons])
    const oTrib = await orgaoCom("Tribunal", [catTrib])
    const oDuas = await orgaoCom("Duas categorias", [catTrib, catTrad])   // menor ordem com rótulo válido: Tradutor (1)

    const aguardando = async (orgaoId: number | null, extra: Parameters<typeof c.novaObrigacao>[0] = {}) => c.novaObrigacao({ aguardando: true, responsavelId: undefined, orgaoId, ...extra })
    const tCart = await aguardando(oCart.id), tSemRot = await aguardando(oSemRot.id), tTrad = await aguardando(oTrad.id)
    const tCons = await aguardando(oCons.id), tTrib = await aguardando(oTrib.id), tDuas = await aguardando(oDuas.id), tSemOrgao = await aguardando(null)
    const tNossa = await c.novaObrigacao({ orgaoId: oTrad.id })                 // não está aguardando → a bola é nossa, mesmo com órgão de tradutor
    const tCliente = await c.novaObrigacao({ aguardando: true, orgaoId: oCart.id })
    await prisma.tarefa.update({ where: { id: tCliente.tarefaId }, data: { statusTarefa: "AGUARDANDO_CLIENTE" } })

    const { linhas } = await listarTarefasDaTorre({}, new Date())
    const L = (o: { tarefaId: number }) => linhas.find((l) => l.taskId === o.tarefaId)!
    ok("todas as linhas ganharam os campos aditivos (bolaCom, bolaDesde, categoriaTerceiro, pedidaEm, cobrarEm, cobrarEmPadrao, iniciouEm)", linhas.length >= 9 && linhas.every((l) => VALORES_DE_BOLA.includes(l.bolaCom) && "bolaDesde" in l && "categoriaTerceiro" in l && "pedidaEm" in l && "cobrarEm" in l && typeof l.cobrarEmPadrao === "boolean" && "iniciouEm" in l))
    ok("órgão sem categoria → Cartório", L(tCart).bolaCom === "Cartório" && L(tCart).categoriaTerceiro === "Cartório")
    ok("categoria SEM rótulo → Cartório", L(tSemRot).bolaCom === "Cartório")
    ok("categoria 'Tradutor' → Tradutor", L(tTrad).bolaCom === "Tradutor" && L(tTrad).categoriaTerceiro === "Tradutor")
    ok("categoria 'Consulado' → Consulado", L(tCons).bolaCom === "Consulado")
    ok("categoria 'Juízo' → Juízo", L(tTrib).bolaCom === "Juízo")
    ok("duas categorias: vale a de menor ordem com rótulo válido (Tradutor)", L(tDuas).bolaCom === "Tradutor")
    ok("aguardando SEM órgão identificado → Cartório (padrão), categoriaTerceiro null", L(tSemOrgao).bolaCom === "Cartório" && L(tSemOrgao).categoriaTerceiro === null)
    ok("AGUARDANDO_CLIENTE → Cliente", L(tCliente).bolaCom === "Cliente")
    ok("não aguardando → Nossa (mesmo com órgão de tradutor cadastrado); categoriaTerceiro continua dizendo o tipo do órgão", L(tNossa).bolaCom === "Equipe" && L(tNossa).categoriaTerceiro === "Tradutor" && L(tNossa).bolaDesde === null && L(tNossa).cobrarEm === null)
    ok("a linha confere com a função pura (mesma regra, uma só)", linhas.every((l) => l.bolaCom === bolaDaLinha(l, l.categoriaTerceiro)))
    ok("os campos EXISTENTES da linha continuam lá", linhas.every((l) => "estadoOperacao" in l && "esperandoDe" in l && "acompanhamentoPasso" in l && "passoCorrente" in l && "cobravelVencida" in l))

    secao("BANCO — desde quando, pedida em e cobrar em (registros reais)")
    const execucao = async (o: { stepInstanceId: number }) => prisma.subtaskExecution.findFirstOrThrow({ where: { stepInstanceId: o.stepInstanceId, supersededAt: null, status: "AGUARDANDO_EXTERNO" }, select: { id: true } })
    // O motor registra QUANDO a tarefa passou a esperar o terceiro (auditoria/evento) — é o 1º registro de 'desde'. Para provar os
    // registros seguintes (envio da subtarefa, pedido) isolados, tira-se esse registro só das tarefas de cena abaixo.
    const semRegistroDeEspera = async (tarefaId: number) => {
      await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: tarefaId, acao: { in: ["TAREFA_AGUARDANDO_TERCEIRO", "TAREFA_BLOQUEADA"] } } })
      await prisma.workflowEvento.deleteMany({ where: { entityType: "tarefa", entityId: tarefaId, tipo: "TAREFA_BLOQUEADA" } })
    }
    const doMotor = (await listarTarefasDaTorre({}, new Date())).linhas.find((l) => l.taskId === tTrib.tarefaId)!
    ok("1º registro: o 'esperando desde' do motor (quando a tarefa passou a esperar o terceiro) — bolaDesde = esperandoDesde", doMotor.esperandoDesde !== null && doMotor.bolaDesde === doMotor.esperandoDesde, String(doMotor.bolaDesde))
    // sem nenhum registro de envio/solicitação → desde null
    await semRegistroDeEspera(tCart.tarefaId)
    await prisma.subtaskExecution.update({ where: { id: (await execucao(tCart)).id }, data: { enviadoEm: null, proximoAcompanhamentoEm: null } })
    const semRegistro = (await listarTarefasDaTorre({}, new Date())).linhas.find((l) => l.taskId === tCart.tarefaId)!
    ok("sem envio e sem solicitação: bolaDesde = null, pedidaEm = null, cobrarEm = null", semRegistro.bolaDesde === null && semRegistro.pedidaEm === null && semRegistro.cobrarEm === null && semRegistro.cobrarEmPadrao === false)
    // com o envio da subtarefa
    const envio = new Date(Date.now() - 12 * DIA), proxima = new Date(Date.now() + 3 * DIA)
    await semRegistroDeEspera(tTrad.tarefaId)
    await prisma.subtaskExecution.update({ where: { id: (await execucao(tTrad)).id }, data: { enviadoEm: envio, proximoAcompanhamentoEm: proxima } })
    const comEnvio = (await listarTarefasDaTorre({}, new Date())).linhas.find((l) => l.taskId === tTrad.tarefaId)!
    ok("com o envio da subtarefa: bolaDesde = enviadoEm; pedidaEm = enviadoEm (sem solicitação)", comEnvio.bolaDesde === envio.toISOString() && comEnvio.pedidaEm === envio.toISOString())
    ok("cobrarEm = o acompanhamento REGISTRADO (não o padrão)", comEnvio.cobrarEm === proxima.toISOString() && comEnvio.cobrarEmPadrao === false)
    // com a solicitação real
    const comSol = await c.novaObrigacao({ aguardando: true, orgaoId: oCons.id, comSolicitacao: { canal: "EMAIL" } })
    await semRegistroDeEspera(comSol.tarefaId)
    await prisma.subtaskExecution.update({ where: { id: (await execucao(comSol)).id }, data: { enviadoEm: null, proximoAcompanhamentoEm: null } })
    const dataEnvio = new Date(Date.now() - 10 * DIA)
    await prisma.solicitacaoDocumento.updateMany({ where: { tarefaId: comSol.tarefaId }, data: { dataEnvio } })
    const lSol = (await listarTarefasDaTorre({}, new Date())).linhas.find((l) => l.taskId === comSol.tarefaId)!
    ok("pedidaEm = SolicitacaoDocumento.dataEnvio; bolaDesde cai nele quando não há envio de subtarefa", lSol.pedidaEm === dataEnvio.toISOString() && lSol.bolaDesde === dataEnvio.toISOString())
    ok("sem acompanhamento registrado: cobrarEm = pedido + 7 d, marcado como PADRÃO", lSol.cobrarEm === new Date(dataEnvio.getTime() + 7 * DIA).toISOString() && lSol.cobrarEmPadrao === true)
    // com uma cobrança registrada (ContatoTerceiro) mais recente que o pedido
    const exec = await execucao(comSol)
    const cobrado = new Date(Date.now() - 2 * DIA)
    await prisma.contatoTerceiro.create({ data: { subtaskExecutionId: exec.id, tarefaId: comSol.tarefaId, orgaoId: oCons.id, canal: "EMAIL", resultado: "SEM_RESPOSTA", registradoEm: cobrado } })
    const lCob = (await listarTarefasDaTorre({}, new Date())).linhas.find((l) => l.taskId === comSol.tarefaId)!
    ok("com cobrança registrada: o padrão passa a contar da ÚLTIMA cobrança (+7 d)", lCob.cobrarEm === new Date(cobrado.getTime() + 7 * DIA).toISOString() && lCob.cobrarEmPadrao === true)
    const solCancelada = await c.novaObrigacao({ aguardando: true, orgaoId: oCons.id, comSolicitacao: { canal: "EMAIL" } })
    await prisma.solicitacaoDocumento.updateMany({ where: { tarefaId: solCancelada.tarefaId }, data: { status: "CANCELADA" } })
    await prisma.subtaskExecution.update({ where: { id: (await execucao(solCancelada)).id }, data: { enviadoEm: null } })
    ok("solicitação CANCELADA não é pedido (pedidaEm null)", (await listarTarefasDaTorre({}, new Date())).linhas.find((l) => l.taskId === solCancelada.tarefaId)?.pedidaEm === null)

    secao("BANCO — leitura EM LOTE: 4 consultas, qualquer que seja o nº de linhas")
    const entradas = (n: number) => Array.from({ length: n }, (_, i) => ({ taskId: 1000 + i, estadoOperacao: "AGUARDANDO" as const, esperandoDe: "terceiro" as const, esperandoDesde: null, orgaoId: oTrad.id + (i % 2), passoId: 5000 + i }))
    const contar = async (n: number) => {
      const consultas: string[] = []
      const espiao = new PrismaClient({ log: [{ emit: "event", level: "query" }] })
      ;(espiao as unknown as { $on: (e: string, cb: (q: { query: string }) => void) => void }).$on("query", (q) => { consultas.push(q.query) })
      try { await lerBolaEmLote(entradas(n), espiao) } finally { await espiao.$disconnect() }
      return consultas.filter((q) => !/^\s*SELECT 1\b/i.test(q)).length
    }
    const n5 = await contar(5), n40 = await contar(40)
    ok(`o nº de consultas NÃO cresce com as linhas: 5 linhas = ${n5}, 40 linhas = ${n40} (35 a mais) — estritamente menor que o nº de linhas acrescentadas`, n40 < n5 + 35 && n40 <= 8 && n5 <= 8)
    ok("zero linhas = zero consultas", (await lerBolaEmLote([])).size === 0)

    secao("BANCO — o Radar/Processos usam a bola da tarefa: o processo do Tradutor mostra 'Tradutor'")
    const radar = await processosDaTorre(new Date())
    const doTrad = radar.processos.find((p) => p.processoId === tTrad.processoId)
    ok("a coluna 'Aguardando' do processo diz 'Tradutor' (o terceiro dominante), vindo do cadastro da categoria", doTrad?.bola.rotulo === "Tradutor", JSON.stringify(doTrad?.bola))
    ok("e o do Consulado mostra 'Consulado'", radar.processos.find((p) => p.processoId === tCons.processoId)?.bola.rotulo === "Consulado")

    secao("O detalhe do Processo (Foco) traz os mesmos campos")
    const foco = await focoDaFamilia(tTrad.processoId, new Date())
    ok("as tarefas do Foco têm bolaCom/bolaDesde/pedidaEm/cobrarEm/iniciouEm", !!foco && foco.tarefas.length > 0 && foco.tarefas.every((l) => l.bolaCom === "Tradutor" && l.bolaDesde === envio.toISOString() && "iniciouEm" in l))
  } finally {
    await limpar()
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
