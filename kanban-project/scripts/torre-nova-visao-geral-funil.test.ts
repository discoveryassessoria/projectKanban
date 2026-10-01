// scripts/torre-nova-visao-geral-funil.test.ts — Visão geral (frente B1), COM BANCO: o funil lê as mesmas fontes que o resto da Torre.
//   npx tsx scripts/torre-nova-visao-geral-funil.test.ts   (banco de teste)
// PROVA: tempo médio do funil = `tempoMedioRealPorFase` (paridade, geral); por país soma só os processos daquele país; meta = país → padrão → null;
// semana = `tendenciasDaTorre` (abre/fecha); fase terminal fora do funil; a rota exige gestor; cartão = lista real.
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-nova-visao-geral-funil.test.ts")

import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarCenario } from "./_fixture-torre-gh"
import { funilDaTorre, faseTerminal, FASE_PROTOCOLADA } from "../lib/operacional/torre-funil"
import { tempoMedioRealPorFase } from "../lib/operacional/metricas-processo"
import { tendenciasDaTorre } from "../lib/operacional/torre-tendencias"
import { definirMeta } from "../lib/operacional/torre-metas"
import { numeroDoKpi, linhasDoKpi } from "../lib/operacional/torre-kpis"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { GET as getFunil } from "../src/app/api/torre/funil/route"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const MARCA = "TORREFUNIL"
const req = (token: string | null) => new NextRequest("http://localhost/api/torre/funil", { headers: token ? { Authorization: `Bearer ${token}` } : {} })

async function main() {
  const c = await montarCenario(MARCA)
  try {
    const admin = await prisma.usuario.create({ data: { nome: `${MARCA} Admin`, email: `${MARCA.toLowerCase()}-admin@t.com`, senha: "x", tipo: "admin" } })
    const comum = await prisma.usuario.create({ data: { nome: `${MARCA} Comum`, email: `${MARCA.toLowerCase()}-comum@t.com`, senha: "x", tipo: "assistente", permissoesCustom: { "tarefas.ver": true } } })
    const a = await c.novaObrigacao({ responsavelId: admin.id }), b = await c.novaObrigacao({})
    const pais = await prisma.catalogoPais.findFirstOrThrow({ where: { ativo: true }, orderBy: { id: "asc" } })
    await prisma.processo.updateMany({ where: { id: { in: [a.processoId, b.processoId] } }, data: { paisId: pais.id } })
    const t0 = Date.now(), dia = 86_400_000
    let seq = 0
    const log = (processoId: number, de: string, para: string, quando: number) => prisma.phaseAdvanceLog.create({ data: {
      processoId, faseAtual: de, fasePretendida: para, regrasAvaliadas: [], pendencias: [], resultado: "MOVIDO", origem: "MANUAL",
      correlationId: `${MARCA}-${++seq}`, chaveIdempotencia: `${MARCA}-${seq}`, criadoEm: new Date(quando),
    } })
    // processo A: genealogia → emissão_documental (10 dias) → analise; processo B: genealogia → emissão (4 dias) → analise
    for (const [p, dias] of [[a.processoId, 10], [b.processoId, 4]] as const) {
      await log(p, "genealogia", "emissao_documental", t0 - 30 * dia)
      await log(p, "emissao_documental", "analise_documental", t0 - 30 * dia + dias * dia)
    }
    const pa = await prisma.processo.findUniqueOrThrow({ where: { id: a.processoId }, select: { paisCanonico: { select: { id: true, countryLabel: true } } } })

    console.log("\nfunil × tempoMedioRealPorFase")
    const f = await funilDaTorre()
    const base = await tempoMedioRealPorFase()
    ok("tempo médio geral do funil = tempoMedioRealPorFase, fase a fase (paridade)", base.length >= 1 && base.every((x) => f.geral.tempos[x.fase]?.mediaDias === x.mediaDias && f.geral.tempos[x.fase]?.amostras === x.amostras), JSON.stringify([base, f.geral.tempos]))
    ok("emissão documental: média 7 dias, 2 amostras", f.geral.tempos.emissao_documental?.mediaDias === 7 && f.geral.tempos.emissao_documental?.amostras === 2)
    const rotulo = pa.paisCanonico?.countryLabel
    ok("por país: o país dos processos tem as 2 amostras", !!rotulo && f.porPais[rotulo!]?.tempos.emissao_documental?.amostras === 2)
    ok("fase sem amostra concluída não aparece (sem estimativa)", f.geral.tempos.analise_documental === undefined)

    console.log("\nmeta: país → padrão → null (só exibição)")
    await definirMeta({ phaseKey: "emissao_documental", metaDias: 30, autorId: admin.id })
    await definirMeta({ phaseKey: "emissao_documental", paisId: pa.paisCanonico!.id, metaDias: 45, autorId: admin.id })
    const f2 = await funilDaTorre()
    ok("geral usa a padrão (30); o país usa a dele (45); fase sem meta = null", f2.geral.metas.emissao_documental === 30 && f2.porPais[rotulo!].metas.emissao_documental === 45 && f2.geral.metas.genealogia === null)
    await prisma.metaTempoFase.deleteMany({ where: { phaseKey: "emissao_documental" } })

    console.log("\nfases e semana")
    ok("as fases vêm do cadastro, em ordem, e a TERMINAL (Finalizado) não é etapa do funil", f.fases.length >= 8 && !f.fases.some((x) => faseTerminal(x.key)) && f.fases.some((x) => x.key === FASE_PROTOCOLADA) && faseTerminal("finalizado") && !faseTerminal("analise_documental"))
    const tend = await tendenciasDaTorre()
    ok("abre/fecha da semana = tendenciasDaTorre (mesma conta)", f.geral.semana.tarefasAbertas === tend.backlog.abertas && f.geral.semana.tarefasFechadas === tend.backlog.fechadas, JSON.stringify([f.geral.semana, tend.backlog]))
    ok("processos abertos na semana contam os criados agora (2)", f.geral.semana.processosAbertos >= 2)

    console.log("\nrota")
    const tAdmin = await signAuthToken({ userId: admin.id, email: admin.email, tipo: admin.tipo, sessaoInicio: Date.now() })
    const tComum = await signAuthToken({ userId: comum.id, email: comum.email, tipo: comum.tipo, sessaoInicio: Date.now() })
    const r = await getFunil(req(tAdmin)); const corpo = await r.json()
    ok("admin: 200 com fases, geral e porPais", r.status === 200 && Array.isArray(corpo.fases) && !!corpo.geral && !!corpo.porPais)
    ok("quem não é gestor da Torre: 403; sem login: 401", (await getFunil(req(tComum))).status === 403 && (await getFunil(req(null))).status === 401)

    console.log("\ncartão = lista real")
    const agora = new Date()
    const linhas = (await listarTarefasDaTorre({}, agora)).linhas
    ok("cada cartão = linhasDoKpi(...).length sobre as linhas reais", (["abertas", "equipe", "cartorio", "ninguem", "venc", "hoje", "amanha", "prox7", "sprazo", "cob"] as const).every((k) => numeroDoKpi(k, linhas, agora) === linhasDoKpi(k, linhas, agora).length))
  } finally {
    await prisma.metaTempoFase.deleteMany({ where: { phaseKey: "emissao_documental" } }).catch(() => {})
    await prisma.logAuditoria.deleteMany({ where: { OR: [{ descricao: { contains: MARCA } }, { acao: { startsWith: "META_TEMPO_FASE" } }] } }).catch(() => {})
    await c.limpar()
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  process.exit(falhou === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
