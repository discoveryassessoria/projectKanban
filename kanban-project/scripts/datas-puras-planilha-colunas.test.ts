// scripts/datas-puras-planilha-colunas.test.ts
//
// DUAS ESPÉCIES DE DATA, NUNCA MISTURADAS (07/10/2026):
//   • DATA PURA (evento/registro/nascimento/óbito/casamento/emissão/validade) — dia do calendário. Guardada como `AAAA-MM-DDT00:00:00Z`; lida no fuso
//     do navegador/servidor (UTC-3) mostrava o DIA ANTERIOR (16/07/2019 → 15/07). Função única: `formatarDataPura` (datas-br).
//   • DATA COM HORÁRIO (movimentações, prazos, criação) — instante real, SEMPRE em America/Sao_Paulo: `formatarDataHoraBrasilia`.
// E a planilha documental tem DUAS colunas — «Data do evento» e «Data do registro» — cada uma só com o seu valor.
// Puro: sem banco. O fuso do processo é trocado em execução para provar UTC e America/Sao_Paulo.

import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { formatarDataPura, formatarDataHoraBrasilia, formatarDiaBrasilia } from "../src/lib/datas-br"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (f: string) => readFileSync(join(RAIZ, f), "utf8")
let n = 0, falhou = 0
const ok = (nome: string, c: boolean, d = "") => { n++; if (c) console.log(`  ✅ ${nome}`); else { falhou++; console.log(`  ❌ ${nome}${d ? ` — ${d}` : ""}`) } }

console.log("\n1) Data pura: 16/07/2019 aparece 16/07/2019 com o servidor em UTC e em America/Sao_Paulo")
const fusoOriginal = process.env.TZ
for (const tz of ["UTC", "America/Sao_Paulo", "Pacific/Auckland", "America/Los_Angeles"]) {
  process.env.TZ = tz
  ok(`[${tz}] string ISO do banco`, formatarDataPura("2019-07-16T00:00:00.000Z") === "16/07/2019", formatarDataPura("2019-07-16T00:00:00.000Z"))
  ok(`[${tz}] Date do Prisma`, formatarDataPura(new Date("2019-07-16T00:00:00Z")) === "16/07/2019")
  ok(`[${tz}] AAAA-MM-DD do formulário`, formatarDataPura("2019-07-16") === "16/07/2019")
  ok(`[${tz}] 1º de janeiro não vira 31/12`, formatarDataPura("1937-01-01T00:00:00.000Z") === "01/01/1937")
  ok(`[${tz}] vazio e inválido viram «—»`, formatarDataPura(null) === "—" && formatarDataPura("") === "—" && formatarDataPura("lixo") === "—")
}
process.env.TZ = fusoOriginal ?? "UTC"

console.log("\n2) Data com horário: sempre Brasília, qualquer que seja o fuso do servidor")
for (const tz of ["UTC", "America/Sao_Paulo", "Asia/Tokyo"]) {
  process.env.TZ = tz
  ok(`[${tz}] 2026-10-07T02:30Z é 06/10/2026 23:30 em Brasília`, formatarDataHoraBrasilia("2026-10-07T02:30:00Z") === "06/10/2026 23:30", formatarDataHoraBrasilia("2026-10-07T02:30:00Z"))
  ok(`[${tz}] dia de um instante`, formatarDiaBrasilia("2026-10-07T02:30:00Z") === "06/10/2026")
}
process.env.TZ = fusoOriginal ?? "UTC"

console.log("\n3) As telas de data pura usam a função única (nenhuma lê o dia no fuso do navegador)")
const PURAS = [
  "src/components/kanban/DocumentoOperationalDrawer.tsx", "src/components/kanban/DocumentoBibliotecaDrawer.tsx", "src/components/kanban/ProcessoAnalise.tsx",
  "src/components/kanban/PedidosDeRetificacao.tsx", "src/components/kanban/AvisoMaioridadeProcesso.tsx", "src/components/genealogical-tree.tsx",
  "src/components/contratantes-tabela.tsx", "src/components/financeiro/v3/PlanilhaDocumentalView.tsx", "src/lib/relatorios/motor/dominios/_comuns.ts",
  "src/lib/relatorios/motor/dominios/protocolos.ts", "src/app/api/processos/[processoId]/analise/route.ts",
]
for (const f of PURAS) {
  const c = ler(f).replace(/\/\/.*$/gm, "")
  ok(`${f} usa formatarDataPura`, /formatarDataPura/.test(c))
}
const drawer = ler("src/components/kanban/DocumentoOperationalDrawer.tsx")
ok("a gaveta: evento/registro/emissão/validade passam por fmtDate (= formatarDataPura)", /const fmtDate = \(s: string \| null\): string => formatarDataPura\(s\)/.test(drawer))
ok("a gaveta: data COM horário (fmtDateTime) usa o fuso de Brasília", /const fmtDateTime = \(s: string \| null\): string => formatarDataHoraBrasilia\(s\)/.test(drawer))
ok("a gaveta não lê mais toLocaleDateString/toLocaleTimeString", !/toLocale(Date|Time)String/.test(drawer.replace(/\/\/.*$/gm, "")))
for (const f of ["src/components/arvore/react-flow-tree.tsx", "src/components/arvore/couple-card.tsx", "src/components/arvore/person-card-simple.tsx"])
  ok(`${f}: ano de nascimento/óbito em UTC (1º de janeiro não cai no ano anterior)`, !/new Date\(date\)\.getFullYear\(\)/.test(ler(f)) && /getUTCFullYear/.test(ler(f)))

console.log("\n4) Planilha documental: DUAS colunas, cada uma só com o seu valor")
const view = ler("src/components/financeiro/v3/PlanilhaDocumentalView.tsx")
ok("cabeçalhos «Data do evento» e «Data do registro» (e não mais «Data»)", /"Registro", "Data do evento", "Data do registro", "Local"/.test(view) && !/"Registro", "Data", "Local"/.test(view))
ok("a view mostra l.dataEvento e l.dataRegistro, cada um na sua coluna", /dataBR\(l\.dataEvento\)/.test(view) && /dataBR\(l\.dataRegistro\)/.test(view))
ok("configuração da planilha lista as duas colunas fixas", /COLUNAS_FIXAS = \["Data do evento", "Data do registro"/.test(ler("src/components/financeiro/v3/ConfiguracaoPlanilhaDocumental.tsx")))
const est = ler("lib/financeiro/leitura/planilha-documental.ts")
const linhaReg = /dataRegistro: iso\(([^\n]*)\),?\n/.exec(est)?.[1] ?? ""
const linhaEv = /dataEvento: iso\(([^\n]*)\),?\n/.exec(est)?.[1] ?? ""
ok("estrutura: a data do REGISTRO nunca empresta o evento (nem nascimento/óbito da árvore)", linhaReg !== "" && !/data_evento|data_nasc|data_obito|data_inicio/.test(linhaReg), linhaReg)
ok("estrutura: a data do EVENTO nunca empresta o registro", linhaEv !== "" && !/data_registro/.test(linhaEv), linhaEv)
const analise = ler("src/app/api/processos/[processoId]/analise/route.ts")
ok("rota analise: dataDocumento não usa mais data_registro como substituta do evento", !/dataDocumento: fmtData\([^)]*data_registro/.test(analise))
const leitura = ler("src/services/registral/leitura-documento.ts")
ok("leitura-documento: evento só de evento e registro só de registro", /dataEvento: dataStr\(doc\.data_evento_documento\) \?\? dataStr\(doc\.data_evento\)/.test(leitura) && /dataRegistro: dataStr\(doc\.data_registro_documento\) \?\? dataStr\(doc\.data_registro\)/.test(leitura))

console.log("\n5) Nenhum campo de data nativo (mm/dd/aaaa) nas telas — nem escolhido por expressão")
const painel = ler("src/components/kanban/workflow/PainelDeclarativoDaEtapa.tsx").replace(/\/\/.*$/gm, "")
ok("PainelDeclarativoDaEtapa: campos de data usam CampoDataTexto (máscara dd/mm/aaaa)", /CampoDataTexto/.test(painel) && !/["']date["']/.test(painel))
const edr = ler("src/components/kanban/documento/EditarDadosRegistrais.tsx").replace(/\/\/.*$/gm, "")
ok("Editar dados registrais: datas em CampoDataTexto (dd/mm/aaaa), sem input nativo", /CampoDataTexto/.test(edr) && !/["']date["']/.test(edr))

console.log(`\n${n - falhou}/${n} verificações`)
if (falhou > 0) process.exit(1)
