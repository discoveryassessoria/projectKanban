// scripts/saude-pendencias-mtr-cob-tor.test.ts
// 30/09/2026 (autorizado): (a) MTR-001 deixa de acusar traducao_juramentada/apostilamento (as telas já não existem);
// (b) as duas rotas POST mortas e os dois motores mortos foram REMOVIDOS (tabelas Pasta* ficam); (c) COB-001 deixa de
// acusar os crons da Torre porque a TOR-001 os vigia DE VERDADE (rastro do job, não só o nome).
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("saude-pendencias-mtr-cob-tor.test.ts")

import { existsSync, readFileSync } from "node:fs"
import { prisma } from "../lib/prisma"
import { verificacaoPorCodigo } from "../lib/saude/catalogo"
import "../lib/saude"
import { mapearSuperficie, lacunasDeCobertura } from "../lib/saude/superficie"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n} ${extra}`) } }
const DIA = 86_400_000

async function main() {
  console.log("MTR-001 e o que foi removido")
  const cad = readFileSync("lib/saude/verificacoes/cadastro-execucao.ts", "utf8")
  const lista = cad.slice(cad.indexOf("const TELAS_ANTERIORES"), cad.indexOf("const TELAS_ANTERIORES") + 400)
  ok("a MTR-001 não lista mais traducao_juramentada nem apostilamento", !/traducao_juramentada|apostilamento:/.test(lista))
  ok("e continua listando as telas que AINDA existem (Análise e Emissão Retificada)", /analise_documental/.test(lista) && /emissao_documental_retificada/.test(lista))
  ok("as duas rotas POST mortas foram removidas", !existsSync("src/app/api/processos/[processoId]/traducao/etapas/[stepId]/route.ts") && !existsSync("src/app/api/processos/[processoId]/apostilamento/etapas/[stepId]/route.ts"))
  ok("os dois motores mortos foram removidos", !existsSync("src/lib/process-stage/traducao-engine.ts") && !existsSync("src/lib/process-stage/apostilamento-engine.ts"))
  const guard = readFileSync("scripts/central-unificada-guard.test.ts", "utf8")
  ok("o central-unificada-guard não exige mais as rotas removidas (e mantém as outras)", !/traducao\/etapas|apostilamento\/etapas/.test(guard) && /Fase Final/.test(guard))
  const schema = readFileSync("prisma/schema.prisma", "utf8")
  ok("as tabelas antigas FICAM (Pasta de Tradução e de Apostilamento)", /model PastaTraducao\b/.test(schema) && /model PastaApostilamento\b/.test(schema))

  console.log("\nCOB-001 e TOR-001")
  const lacunas = lacunasDeCobertura(mapearSuperficie()).filter((l) => l.tipo === "CRON").map((l) => l.alvo)
  ok("COB-001 não acusa mais torre-indicadores nem torre-regras", !lacunas.includes("/api/cron/torre-indicadores") && !lacunas.includes("/api/cron/torre-regras"), JSON.stringify(lacunas))
  const tor = verificacaoPorCodigo("TOR-001")!
  ok("a TOR-001 existe no catálogo", !!tor)

  await prisma.torreIndicadorDiario.deleteMany({})
  await prisma.configuracaoSistema.deleteMany({ where: { chave: "torre.regra.r1" } })
  await prisma.logAuditoria.deleteMany({ where: { acao: "REGRA_TORRE_EXECUTADA" } })
  const rodar = async () => (await tor.executar({} as never)).achados.map((a) => a.chave)
  ok("sem nenhuma foto ainda e r1 desligada: nenhum achado (nada a cobrar)", (await rodar()).length === 0)

  const dia = (d: number) => { const x = new Date(Date.now() - d * DIA); x.setUTCHours(0, 0, 0, 0); return x }
  const zeros = { vencidas: 0, vencemEm7Dias: 0, semDono: 0, aguardandoTerceiro: 0, cobrancasPendentes: 0, escaladas: 0, emRisco: 0, backlogAbertas: 0, backlogFechadasNaSemana: 0 }
  await prisma.torreIndicadorDiario.create({ data: { data: dia(1), ...zeros } })
  ok("foto de ontem: cron saudável, sem achado", !(await rodar()).includes("torre-indicadores-parado"))
  await prisma.torreIndicadorDiario.deleteMany({})
  await prisma.torreIndicadorDiario.create({ data: { data: dia(5), ...zeros } })
  ok("foto de 5 dias atrás: o cron parou → achado", (await rodar()).includes("torre-indicadores-parado"))
  await prisma.torreIndicadorDiario.deleteMany({})

  await prisma.configuracaoSistema.upsert({ where: { chave: "torre.regra.r1" }, update: { valor: "1" }, create: { chave: "torre.regra.r1", valor: "1", grupo: "torre" } })
  ok("r1 LIGADA sem nenhuma execução registrada → achado", (await rodar()).includes("torre-regras-parado"))
  await prisma.logAuditoria.create({ data: { acao: "REGRA_TORRE_EXECUTADA", entidade: "RegraTorre", descricao: "TOR-001 teste", detalhes: {} } })
  ok("r1 ligada com execução recente → sem achado", !(await rodar()).includes("torre-regras-parado"))
  await prisma.configuracaoSistema.deleteMany({ where: { chave: "torre.regra.r1" } })
  await prisma.logAuditoria.deleteMany({ where: { acao: "REGRA_TORRE_EXECUTADA", descricao: "TOR-001 teste" } })

  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) process.exit(1)
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
