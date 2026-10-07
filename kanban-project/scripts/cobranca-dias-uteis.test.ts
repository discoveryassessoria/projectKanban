// scripts/cobranca-dias-uteis.test.ts
// ============================================================================
// «COBRAR A PARTIR DE» = 10 DIAS ÚTEIS (07/10/2026): feriados nacionais, padrão configurável, ajuste por cartório, só lembrete, e o que já existia não muda.
// ============================================================================
import { readFileSync } from "node:fs"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { prisma } from "../lib/prisma"
import {
  somarDiasUteis, lembreteDeCobranca, diasDeCobranca, lerConfigDeCobranca, definirDiasPadraoDaCobranca, definirDiasDoOrgao,
  COBRANCA_UTEIS_VIGENTE_DESDE, CONFIG_DE_COBRANCA_PADRAO,
} from "../lib/operacional/cobranca-uteis"
import { diaOperacional } from "../lib/operacional/tempo-operacional"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const dia = (d: Date | null) => (d ? diaOperacional(d) : null)

async function main() {
  exigirBancoDeTeste("cobranca-dias-uteis.test.ts")
  secao("A) Dias úteis (puro)")
  ok("10 dias úteis a partir de qua 07/10/2026 = qui 22/10 (pula fins de semana e o feriado de 12/10)", dia(somarDiasUteis(new Date("2026-10-07T15:00:00-03:00"), 10)) === "2026-10-22", String(dia(somarDiasUteis(new Date("2026-10-07T15:00:00-03:00"), 10))))
  ok("sexta 09/10 + 1 dia útil = terça 13/10 (sábado, domingo e feriado de 12/10 não contam)", dia(somarDiasUteis(new Date("2026-10-09T10:00:00-03:00"), 1)) === "2026-10-13")
  ok("sexta 30/10 + 1 = terça 03/11 (Finados, 02/11, é feriado)", dia(somarDiasUteis(new Date("2026-10-30T10:00:00-03:00"), 1)) === "2026-11-03")
  ok("Natal e Ano Novo: 24/12 + 1 = 28/12 (25/12 feriado; 26–27 fim de semana)", dia(somarDiasUteis(new Date("2026-12-24T10:00:00-03:00"), 1)) === "2026-12-28")
  ok("envio à noite (23h em São Paulo) conta o dia de SÃO PAULO, não o de UTC", dia(somarDiasUteis(new Date("2026-10-07T23:30:00-03:00"), 1)) === "2026-10-08")
  secao("B) Só vale para pedidos novos; o antigo não muda")
  const cfg = CONFIG_DE_COBRANCA_PADRAO
  ok("a vigência é 08/10/2026 00:00 (São Paulo)", COBRANCA_UTEIS_VIGENTE_DESDE.toISOString() === "2026-10-08T03:00:00.000Z")
  ok("pedido ANTERIOR à vigência: continua nos 10 dias corridos de sempre (01/10 → 11/10)", dia(lembreteDeCobranca({ pedidoEnviadoEm: new Date("2026-10-01T12:00:00-03:00"), slaDiasDoPasso: 10, orgaoId: null, cfg })) === "2026-10-11")
  ok("pedido NOVO: 10 dias úteis (08/10 → 23/10)", dia(lembreteDeCobranca({ pedidoEnviadoEm: new Date("2026-10-08T12:00:00-03:00"), slaDiasDoPasso: 10, orgaoId: null, cfg })) === "2026-10-23")
  ok("ajuste por cartório vence o padrão (cartório 5 dias úteis: 08/10 → 16/10)", dia(lembreteDeCobranca({ pedidoEnviadoEm: new Date("2026-10-08T12:00:00-03:00"), slaDiasDoPasso: 10, orgaoId: 7, cfg: { padraoDias: 10, porOrgao: { 7: 5 } } })) === "2026-10-16" && diasDeCobranca({ padraoDias: 10, porOrgao: { 7: 5 } }, 8) === 10)
  secao("C) Configuração (auditada) no banco de teste")
  const org = await prisma.orgaoProtocolo.create({ data: { name: "COBR Cartório Teste", type: "cartorio" } as never, select: { id: true } })
  ok("sem nada gravado, o padrão é 10", (await lerConfigDeCobranca()).padraoDias === 10)
  ok("padrão configurável (15) e inválido recusado", (await definirDiasPadraoDaCobranca(15, null)).ok && (await lerConfigDeCobranca()).padraoDias === 15 && !(await definirDiasPadraoDaCobranca(0, null)).ok && !(await definirDiasPadraoDaCobranca(200, null)).ok)
  ok("ajuste por cartório grava e volta ao padrão", (await definirDiasDoOrgao(org.id, 4, null)).ok && (await lerConfigDeCobranca()).porOrgao[org.id] === 4 && (await definirDiasDoOrgao(org.id, null, null)).ok && (await lerConfigDeCobranca()).porOrgao[org.id] === undefined)
  ok("cartório inexistente é recusado, com mensagem em português", /não encontrado/.test(String((await definirDiasDoOrgao(999999999, 3, null) as { erro?: string }).erro)))
  ok("toda mudança é auditada", (await prisma.logAuditoria.count({ where: { acao: { in: ["COBRANCA_PRAZO_PADRAO_ALTERADO", "COBRANCA_PRAZO_ORGAO_ALTERADO"] } } })) >= 3)
  await prisma.configuracaoSistema.deleteMany({ where: { chave: { startsWith: "torre.cobranca." } } })
  await prisma.orgaoProtocolo.delete({ where: { id: org.id } })
  secao("D) É só um lembrete")
  const proj = readFileSync("lib/operacional/tarefa-projecoes.ts", "utf8")
  const usos = (proj.match(/lembreteDeCobrancaEm/g) ?? []).length
  ok("o lembrete só aparece como dado de leitura (projeção + tela) — nenhuma regra de bloqueio/conclusão o consulta", usos === 2 && !/lembreteDeCobrancaEm/.test(readFileSync("lib/operacional/tarefa-canonica.ts", "utf8")) && !/lembreteDeCobrancaEm/.test(readFileSync("src/services/subtarefas-da-etapa.ts", "utf8")))
  ok("a tela de regras da Torre tem o padrão e o ajuste por cartório", /data-testid="prazo-de-cobranca"/.test(readFileSync("src/components/gerenciamentoComponents/saude/SaudeRegras.tsx", "utf8")) && /\/api\/torre\/cobranca/.test(readFileSync("src/components/gerenciamentoComponents/saude/SaudeRegras.tsx", "utf8")))
  console.log(`\n${falhou === 0 ? "✅" : "❌"} COBRANÇA EM DIAS ÚTEIS — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
}
main().catch((e) => { console.log(`  ❌ ERRO: ${String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(-700)}`); process.exit(1) }).finally(() => prisma.$disconnect())
