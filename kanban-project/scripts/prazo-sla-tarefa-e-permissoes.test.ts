// scripts/prazo-sla-tarefa-e-permissoes.test.ts
// ============================================================================
// AÇÕES SOBRE A TAREFA + PERMISSÕES — mandato "Módulo de Prazos, SLA e
// Políticas de Acompanhamento" (22/09/2026). Prova, contra o BANCO DE TESTE
// local e batendo nas ROTAS HTTP REAIS (handler chamado direto, mesmo padrão
// de scripts/permissoes-modulo-fases.test.ts — NextRequest de verdade, sem
// mock de framework):
//   • iniciarEsperaTerceiro/encerrarEsperaTerceiro NUNCA mudam dataPrazo;
//   • reprogramarAcompanhamento respeita acompanhamentoExigeMotivo da versão
//     vinculada (ou exige por padrão, sem política vinculada);
//   • reprogramarPrazoGeral exige justificativa e grava EventoPrazoSla;
//   • PERMISSÕES: Daniela (perfil operacional, sem usuarios.gerenciar) recebe
//     403 real no prazo geral (RESTRITO); ela CONSEGUE iniciar espera de
//     terceiro e reprogramar acompanhamento (permissões operacionais); admin
//     consegue tudo; nada é persistido por uma tentativa negada;
//   • varrerPrazosEAcompanhamentosSla é idempotente POR DIA OPERACIONAL — um
//     aviso por marco, novo dia gera novo evento.
//
// Rodar (banco de teste LOCAL apenas — exigirBancoDeTeste trava produção):
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" \
//   npx tsx scripts/prazo-sla-tarefa-e-permissoes.test.ts
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("prazo-sla-tarefa-e-permissoes.test.ts")

import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { NextRequest } from "next/server"
import type { Prisma } from "@prisma/client"
import { publicarPoliticaPrazoSla, type ParametrosVersaoInput } from "../src/services/prazo-sla/politica-prazo-sla"
import { varrerPrazosEAcompanhamentosSla } from "../src/services/prazo-sla/varredura-prazo-sla"

const MARCA = "PRZSLA3"

let ok = 0, falhou = 0
const falhas: string[] = []
function check(nome: string, cond: boolean | null | undefined, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.error(`  ❌ ${nome}${detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""}`) }
}
function secao(t: string) { console.log(`\n${t}`) }

async function limpar() {
  const tarefas = await prisma.tarefa.findMany({ where: { titulo: { startsWith: `[${MARCA}]` } }, select: { id: true } })
  const tarefaIds = tarefas.map((t) => t.id)
  await prisma.eventoPrazoSla.deleteMany({ where: { tarefaId: { in: tarefaIds } } })
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: "Tarefa", aggregateId: { in: tarefaIds } } })
  await prisma.tarefa.deleteMany({ where: { id: { in: tarefaIds } } })

  const politicas = await prisma.politicaPrazoSla.findMany({ where: { chave: { startsWith: MARCA.toLowerCase() } }, select: { id: true } })
  const politicaIds = politicas.map((p) => p.id)
  await prisma.eventoPrazoSla.deleteMany({ where: { politicaId: { in: politicaIds } } })
  await prisma.politicaPrazoSlaVersao.deleteMany({ where: { politicaId: { in: politicaIds } } })
  await prisma.politicaPrazoSla.deleteMany({ where: { id: { in: politicaIds } } })

  await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } } })
}

// ── DISPATCH DE ROTA — mesmo padrão de scripts/permissoes-modulo-fases.test.ts:
// handler importado e chamado direto com um NextRequest real. ──────────────
async function chamar(method: string, path: string, token: string | null, body?: unknown) {
  const { POST: postVincular } = await import("../src/app/api/tarefas/[tarefaId]/prazo-sla/vincular/route")
  const { POST: postEsperaIniciar } = await import("../src/app/api/tarefas/[tarefaId]/prazo-sla/espera-terceiro/iniciar/route")
  const { POST: postEsperaEncerrar } = await import("../src/app/api/tarefas/[tarefaId]/prazo-sla/espera-terceiro/encerrar/route")
  const { POST: postAcompReprogramar } = await import("../src/app/api/tarefas/[tarefaId]/prazo-sla/acompanhamento/reprogramar/route")
  const { POST: postPrazoReprogramar } = await import("../src/app/api/tarefas/[tarefaId]/prazo-sla/prazo-geral/reprogramar/route")

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers.Authorization = `Bearer ${token}`
  const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers }
  if (body !== undefined) init.body = JSON.stringify(body)
  const req = new NextRequest(`http://localhost${path}`, init)

  const m = /^\/api\/tarefas\/(\d+)\/prazo-sla\/(.+)$/.exec(path)
  if (!m) throw new Error(`rota não mapeada no fixture: ${method} ${path}`)
  const [, tarefaId, resto] = m
  const params = { params: Promise.resolve({ tarefaId }) }

  if (resto === "vincular" && method === "POST") return postVincular(req, params)
  if (resto === "espera-terceiro/iniciar" && method === "POST") return postEsperaIniciar(req, params)
  if (resto === "espera-terceiro/encerrar" && method === "POST") return postEsperaEncerrar(req, params)
  if (resto === "acompanhamento/reprogramar" && method === "POST") return postAcompReprogramar(req, params)
  if (resto === "prazo-geral/reprogramar" && method === "POST") return postPrazoReprogramar(req, params)
  throw new Error(`rota não mapeada no fixture: ${method} ${path}`)
}

const criarTarefa = (titulo: string, overrides: Partial<Prisma.TarefaUncheckedCreateInput> = {}) =>
  prisma.tarefa.create({ data: { titulo: `[${MARCA}] ${titulo}`, statusTarefa: "EM_ANDAMENTO", concluida: false, ...overrides } })

function paramsValidos(overrides: Partial<ParametrosVersaoInput> = {}): ParametrosVersaoInput {
  return {
    prazoQuantidade: 5,
    prazoUnidade: "DIAS_UTEIS",
    prazoEventoInicialChave: `${MARCA.toLowerCase()}_evento_inicial`,
    tratamentoFimDeSemana: "PULA",
    tratamentoFeriado: "PULA",
    politicaDataNaoUtil: "PROXIMO_DIA_UTIL",
    riscoAntecedenciaDias: 2,
    acompanhamentoPrimeiroDias: 2,
    acompanhamentoPadraoDias: 3,
    acompanhamentoUnidade: "DIAS_UTEIS",
    ...overrides,
  }
}

async function main() {
  console.log(`\n=== Ações sobre a Tarefa + Permissões — Prazo/SLA (${MARCA}) ===\n`)
  await limpar()

  // ── Fixtures: admin e Daniela (perfil operacional, sem usuarios.gerenciar) ──
  const admin = await prisma.usuario.create({ data: { nome: `${MARCA} Admin`, email: `admin@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" } })
  const daniela = await prisma.usuario.create({
    data: {
      nome: `${MARCA} Daniela`, email: `daniela@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "colaborador",
      // Concessão NOMINAL das permissões operacionais — SEM usuarios.gerenciar
      // (a que dá o prazo geral). Autorização é por PERMISSÃO, nunca por tipo.
      permissoesCustom: { "tarefas.iniciar_concluir": true, "tarefas.editar": true, "usuarios.gerenciar": false },
    },
  })
  const tokenAdmin = await signAuthToken({ userId: admin.id, email: admin.email, tipo: admin.tipo, sessaoInicio: Date.now() })
  const tokenDaniela = await signAuthToken({ userId: daniela.id, email: daniela.email, tipo: daniela.tipo, sessaoInicio: Date.now() })

  // ── Políticas de apoio: A (acompanhamentoExigeMotivo=true, padrão) e B (=false) ──
  const politicaA = await prisma.politicaPrazoSla.create({ data: { chave: `${MARCA.toLowerCase()}_a`, nome: `[${MARCA}] Política A`, status: "RASCUNHO" } })
  const pubA = await publicarPoliticaPrazoSla({ politicaId: politicaA.id, parametros: paramsValidos(), estrategiaRetroacao: "SOMENTE_NOVAS", publicadoPorId: admin.id })
  if (!pubA.ok) throw new Error("setup: publicação da política A falhou")

  const politicaB = await prisma.politicaPrazoSla.create({ data: { chave: `${MARCA.toLowerCase()}_b`, nome: `[${MARCA}] Política B`, status: "RASCUNHO" } })
  const pubB = await publicarPoliticaPrazoSla({ politicaId: politicaB.id, parametros: paramsValidos({ acompanhamentoExigeMotivo: false }), estrategiaRetroacao: "SOMENTE_NOVAS", publicadoPorId: admin.id })
  if (!pubB.ok) throw new Error("setup: publicação da política B falhou")

  const D_VINC = new Date("2030-03-04T12:00:00.000Z").toISOString()

  // ══════════════════════════════════════════════════════════════════════
  secao("1) ESPERA DE TERCEIRO — iniciar/encerrar NUNCA mudam o dataPrazo (via rota HTTP, admin)")
  // ══════════════════════════════════════════════════════════════════════
  const tarefaEspera = await criarTarefa("Espera de terceiro")
  const rVincular = await chamar("POST", `/api/tarefas/${tarefaEspera.id}/prazo-sla/vincular`, tokenAdmin, { politicaChave: politicaA.chave, baseCalculoEm: D_VINC })
  check("1.1) vincular via rota HTTP (admin) → 200", rVincular.status === 200, await rVincular.clone().json().catch(() => null))
  const tarefaEsperaVinculada = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaEspera.id } })
  const dataPrazoAntesDaEspera = tarefaEsperaVinculada.dataPrazo
  check("1.2) dataPrazo calculado pelo vínculo (não nulo)", dataPrazoAntesDaEspera !== null)

  const rSemMotivo = await chamar("POST", `/api/tarefas/${tarefaEspera.id}/prazo-sla/espera-terceiro/iniciar`, tokenAdmin, { agora: "2030-03-10T12:00:00.000Z" })
  check("1.3) iniciar espera SEM motivo → 400 MOTIVO_OBRIGATORIO", rSemMotivo.status === 400, await rSemMotivo.clone().json().catch(() => null))
  const jSemMotivo = await rSemMotivo.json()
  check("1.4) código do erro é MOTIVO_OBRIGATORIO", jSemMotivo.code === "MOTIVO_OBRIGATORIO")

  const rComMotivo = await chamar("POST", `/api/tarefas/${tarefaEspera.id}/prazo-sla/espera-terceiro/iniciar`, tokenAdmin, { motivo: "Aguardando cartório emitir a certidão", agora: "2030-03-10T12:00:00.000Z" })
  check("1.5) iniciar espera COM motivo → 200", rComMotivo.status === 200, await rComMotivo.clone().json().catch(() => null))
  const tarefaEmEspera = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaEspera.id } })
  check("1.6) aguardandoDesde/origemDaEspera preenchidos (statusTarefa não é dono deste módulo — task-step-sync.ts continua o único escritor)", tarefaEmEspera.aguardandoDesde != null && tarefaEmEspera.origemDaEspera === "TERCEIRO")
  check("1.7) aguardandoDesde gravado com o \"agora\" informado (fixo)", tarefaEmEspera.aguardandoDesde?.getTime() === new Date("2030-03-10T12:00:00.000Z").getTime())
  check("1.8) origemDaEspera é TERCEIRO", tarefaEmEspera.origemDaEspera === "TERCEIRO")
  check("1.9) proximoAcompanhamentoEm foi calculado (política vinculada)", tarefaEmEspera.proximoAcompanhamentoEm !== null)
  check("1.10) dataPrazo NÃO mudou — prova explícita antes === depois", tarefaEmEspera.dataPrazo?.getTime() === dataPrazoAntesDaEspera?.getTime(), { antes: dataPrazoAntesDaEspera, depois: tarefaEmEspera.dataPrazo })

  const rEncerrar = await chamar("POST", `/api/tarefas/${tarefaEspera.id}/prazo-sla/espera-terceiro/encerrar`, tokenAdmin, { agora: "2030-03-15T12:00:00.000Z" })
  check("1.11) encerrar espera → 200", rEncerrar.status === 200, await rEncerrar.clone().json().catch(() => null))
  const tarefaEsperaEncerrada = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaEspera.id } })
  check("1.12) aguardandoDesde/origemDaEspera voltaram a null", tarefaEsperaEncerrada.aguardandoDesde == null && tarefaEsperaEncerrada.origemDaEspera == null)
  check("1.13) campos de espera limpos (aguardandoDesde/origemDaEspera/terceiroResponsavelId)",
    tarefaEsperaEncerrada.aguardandoDesde === null && tarefaEsperaEncerrada.origemDaEspera === null && tarefaEsperaEncerrada.terceiroResponsavelId === null)
  check("1.14) dataPrazo continua EXATAMENTE o mesmo do início ao fim do ciclo de espera",
    tarefaEsperaEncerrada.dataPrazo?.getTime() === dataPrazoAntesDaEspera?.getTime())

  // ══════════════════════════════════════════════════════════════════════
  secao("2) REPROGRAMAR ACOMPANHAMENTO — respeita acompanhamentoExigeMotivo da versão vinculada")
  // ══════════════════════════════════════════════════════════════════════
  const tarefaAcompDefault = await criarTarefa("Acompanhamento sem política (exige motivo por padrão)")
  const rAcompSemMotivoDefault = await chamar("POST", `/api/tarefas/${tarefaAcompDefault.id}/prazo-sla/acompanhamento/reprogramar`, tokenAdmin, { novaData: "2030-04-01T12:00:00.000Z", agora: "2030-03-12T12:00:00.000Z" })
  check("2.1) sem política vinculada (exige motivo por padrão): SEM motivo → 400 MOTIVO_OBRIGATORIO", rAcompSemMotivoDefault.status === 400, await rAcompSemMotivoDefault.clone().json().catch(() => null))
  const rAcompComMotivoDefault = await chamar("POST", `/api/tarefas/${tarefaAcompDefault.id}/prazo-sla/acompanhamento/reprogramar`, tokenAdmin, { novaData: "2030-04-01T12:00:00.000Z", motivo: "cliente pediu adiamento", agora: "2030-03-12T12:00:00.000Z" })
  check("2.2) com motivo → 200", rAcompComMotivoDefault.status === 200, await rAcompComMotivoDefault.clone().json().catch(() => null))
  const tarefaAcompDefaultDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaAcompDefault.id } })
  check("2.3) proximoAcompanhamentoEm atualizado pra data pedida", tarefaAcompDefaultDepois.proximoAcompanhamentoEm?.getTime() === new Date("2030-04-01T12:00:00.000Z").getTime())

  const tarefaAcompLivre = await criarTarefa("Acompanhamento com política B (não exige motivo)")
  const rVincularB = await chamar("POST", `/api/tarefas/${tarefaAcompLivre.id}/prazo-sla/vincular`, tokenAdmin, { politicaChave: politicaB.chave, baseCalculoEm: D_VINC })
  check("2.4) vincular à política B → 200", rVincularB.status === 200)
  const rAcompSemMotivoLivre = await chamar("POST", `/api/tarefas/${tarefaAcompLivre.id}/prazo-sla/acompanhamento/reprogramar`, tokenAdmin, { novaData: "2030-04-05T12:00:00.000Z", agora: "2030-03-12T12:00:00.000Z" })
  check("2.5) política B (acompanhamentoExigeMotivo:false): SEM motivo → 200 (aceito)", rAcompSemMotivoLivre.status === 200, await rAcompSemMotivoLivre.clone().json().catch(() => null))
  const tarefaAcompLivreDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaAcompLivre.id } })
  check("2.6) proximoAcompanhamentoEm atualizado mesmo sem motivo", tarefaAcompLivreDepois.proximoAcompanhamentoEm?.getTime() === new Date("2030-04-05T12:00:00.000Z").getTime())

  // ══════════════════════════════════════════════════════════════════════
  secao("3) REPROGRAMAR PRAZO GERAL — exige justificativa, grava EventoPrazoSla com antes/depois")
  // ══════════════════════════════════════════════════════════════════════
  const tarefaPrazoGeral = await criarTarefa("Prazo geral", { dataPrazo: new Date("2030-01-15T12:00:00.000Z") })
  const rPrazoSemJustificativa = await chamar("POST", `/api/tarefas/${tarefaPrazoGeral.id}/prazo-sla/prazo-geral/reprogramar`, tokenAdmin, { novoPrazo: "2030-05-01T12:00:00.000Z", agora: "2030-03-20T12:00:00.000Z" })
  check("3.1) sem justificativa → 400 JUSTIFICATIVA_OBRIGATORIA", rPrazoSemJustificativa.status === 400, await rPrazoSemJustificativa.clone().json().catch(() => null))
  const tarefaPrazoGeralIntocada = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaPrazoGeral.id } })
  check("3.2) dataPrazo continua o original (tentativa recusada não persiste)", tarefaPrazoGeralIntocada.dataPrazo?.getTime() === new Date("2030-01-15T12:00:00.000Z").getTime())

  const rPrazoComJustificativa = await chamar("POST", `/api/tarefas/${tarefaPrazoGeral.id}/prazo-sla/prazo-geral/reprogramar`, tokenAdmin, { novoPrazo: "2030-05-01T12:00:00.000Z", justificativa: "acordo com o cliente", agora: "2030-03-20T12:00:00.000Z" })
  check("3.3) com justificativa → 200", rPrazoComJustificativa.status === 200, await rPrazoComJustificativa.clone().json().catch(() => null))
  const tarefaPrazoGeralDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaPrazoGeral.id } })
  check("3.4) dataPrazo mudou pro novo prazo pedido", tarefaPrazoGeralDepois.dataPrazo?.getTime() === new Date("2030-05-01T12:00:00.000Z").getTime())
  const eventoPrazoReprogramado = await prisma.eventoPrazoSla.findFirst({ where: { tarefaId: tarefaPrazoGeral.id, tipo: "PRAZO_REPROGRAMADO" } })
  check("3.5) EventoPrazoSla PRAZO_REPROGRAMADO foi gravado", eventoPrazoReprogramado !== null)
  const valorAnterior = eventoPrazoReprogramado?.valorAnterior as { dataPrazo?: string } | null
  const valorNovo = eventoPrazoReprogramado?.valorNovo as { dataPrazo?: string } | null
  check("3.6) valorAnterior guarda o prazo ANTIGO (15/01/2030)", new Date(valorAnterior?.dataPrazo ?? 0).getTime() === new Date("2030-01-15T12:00:00.000Z").getTime(), valorAnterior)
  check("3.7) valorNovo guarda o prazo NOVO (01/05/2030)", new Date(valorNovo?.dataPrazo ?? 0).getTime() === new Date("2030-05-01T12:00:00.000Z").getTime(), valorNovo)

  // ══════════════════════════════════════════════════════════════════════
  secao("4) PERMISSÕES — Daniela é 403 no prazo geral (RESTRITO), mas CONSEGUE espera/acompanhamento; admin consegue tudo")
  // ══════════════════════════════════════════════════════════════════════
  const tarefaPermPrazoGeral = await criarTarefa("Permissão — prazo geral", { dataPrazo: new Date("2030-02-01T12:00:00.000Z") })
  const rDanielaPrazoGeral = await chamar("POST", `/api/tarefas/${tarefaPermPrazoGeral.id}/prazo-sla/prazo-geral/reprogramar`, tokenDaniela, { novoPrazo: "2030-06-01T12:00:00.000Z", justificativa: "tentativa negada", agora: "2030-05-20T12:00:00.000Z" })
  check("4.1) Daniela (sem usuarios.gerenciar): POST prazo-geral/reprogramar → 403 real (nunca 200 disfarçado)", rDanielaPrazoGeral.status === 403, rDanielaPrazoGeral.status)
  const tarefaPermPrazoGeralAposNegativa = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaPermPrazoGeral.id } })
  check("4.2) NADA foi persistido pela tentativa negada de Daniela — dataPrazo é o de antes",
    tarefaPermPrazoGeralAposNegativa.dataPrazo?.getTime() === new Date("2030-02-01T12:00:00.000Z").getTime())

  const rAdminPrazoGeral = await chamar("POST", `/api/tarefas/${tarefaPermPrazoGeral.id}/prazo-sla/prazo-geral/reprogramar`, tokenAdmin, { novoPrazo: "2030-06-01T12:00:00.000Z", justificativa: "admin autoriza", agora: "2030-05-20T12:00:00.000Z" })
  check("4.3) admin: POST prazo-geral/reprogramar → 200 (o mesmo fluxo funciona pra quem tem a permissão)", rAdminPrazoGeral.status === 200, await rAdminPrazoGeral.clone().json().catch(() => null))

  const tarefaPermEspera = await criarTarefa("Permissão — espera de terceiro")
  const rDanielaEspera = await chamar("POST", `/api/tarefas/${tarefaPermEspera.id}/prazo-sla/espera-terceiro/iniciar`, tokenDaniela, { motivo: "aguardando retorno do cartório", agora: "2030-05-21T12:00:00.000Z" })
  check("4.4) Daniela (tem tarefas.iniciar_concluir): POST espera-terceiro/iniciar → 200 (consegue)", rDanielaEspera.status === 200, await rDanielaEspera.clone().json().catch(() => null))
  const tarefaPermEsperaDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaPermEspera.id } })
  check("4.5) o efeito realmente aconteceu (aguardandoDesde preenchido)", tarefaPermEsperaDepois.aguardandoDesde != null)

  const tarefaPermAcomp = await criarTarefa("Permissão — acompanhamento")
  const rDanielaAcomp = await chamar("POST", `/api/tarefas/${tarefaPermAcomp.id}/prazo-sla/acompanhamento/reprogramar`, tokenDaniela, { novaData: "2030-07-01T12:00:00.000Z", motivo: "reagendado com o cliente", agora: "2030-05-22T12:00:00.000Z" })
  check("4.6) Daniela (tem tarefas.editar): POST acompanhamento/reprogramar → 200 (consegue)", rDanielaAcomp.status === 200, await rDanielaAcomp.clone().json().catch(() => null))
  const tarefaPermAcompDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaPermAcomp.id } })
  check("4.7) o efeito realmente aconteceu (proximoAcompanhamentoEm atualizado)", tarefaPermAcompDepois.proximoAcompanhamentoEm?.getTime() === new Date("2030-07-01T12:00:00.000Z").getTime())

  const rSemToken = await chamar("POST", `/api/tarefas/${tarefaPermPrazoGeral.id}/prazo-sla/prazo-geral/reprogramar`, null, { novoPrazo: "2030-08-01T12:00:00.000Z", justificativa: "sem token" })
  check("4.8) sem token nenhum: 401 (nunca 200)", rSemToken.status === 401, rSemToken.status)

  // ══════════════════════════════════════════════════════════════════════
  secao("5) VARREDURA — um aviso por marco, idempotente por DIA OPERACIONAL")
  // ══════════════════════════════════════════════════════════════════════
  const tarefaVarredura = await criarTarefa("Varredura — prazo já vencido")
  const rVincularVarredura = await chamar("POST", `/api/tarefas/${tarefaVarredura.id}/prazo-sla/vincular`, tokenAdmin, { politicaChave: politicaA.chave, baseCalculoEm: "2026-01-05T12:00:00.000Z" })
  check("5.1) vincular tarefaVarredura à política A → 200", rVincularVarredura.status === 200)
  // Sobrescreve o dataPrazo diretamente pra simular uma tarefa cujo prazo já
  // venceu — mantém politicaPrazoSlaVersaoId setado (é o que a varredura exige).
  await prisma.tarefa.update({ where: { id: tarefaVarredura.id }, data: { dataPrazo: new Date("2026-02-05T12:00:00.000Z") } })

  const contarEventosVencido = () => prisma.eventoPrazoSla.count({ where: { tarefaId: tarefaVarredura.id, tipo: "PRAZO_VENCIDO" } })

  const agora1 = new Date("2026-02-10T12:00:00.000Z")
  const relatorio1 = await varrerPrazosEAcompanhamentosSla({ agora: agora1 })
  check("5.2) primeira varredura: gerou PRAZO_VENCIDO para a tarefa (1 evento)", (await contarEventosVencido()) === 1)
  check("5.3) relatório.vencido conta pelo menos essa tarefa", relatorio1.vencido >= 1, relatorio1)

  const relatorio2 = await varrerPrazosEAcompanhamentosSla({ agora: agora1 }) // MESMO agora, mesmo dia operacional
  check("5.4) rodar de novo no MESMO dia operacional: zero eventos NOVOS (ainda 1 no total)", (await contarEventosVencido()) === 1)
  check("5.5) relatório da segunda passada não conta essa tarefa de novo (já registrada hoje)", relatorio2.vencido === 0, relatorio2)

  const agora2 = new Date("2026-02-11T12:00:00.000Z") // dia operacional seguinte
  const relatorio3 = await varrerPrazosEAcompanhamentosSla({ agora: agora2 })
  check("5.6) avançando o \"agora\" fake pro dia seguinte: gera um NOVO evento (dia novo, marco novo) — total 2", (await contarEventosVencido()) === 2)
  check("5.7) relatório do dia novo conta a tarefa de novo", relatorio3.vencido === 1, relatorio3)

  await limpar()
  console.log(`\n=== RESULTADO: ${ok} ok, ${falhou} falhas ===`)
  if (falhou > 0) { console.error("Falhas:", falhas.join(" | ")); process.exitCode = 1 }
}

main().finally(() => prisma.$disconnect())
