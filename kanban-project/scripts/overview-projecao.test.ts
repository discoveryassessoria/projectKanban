/**
 * Painel Geral do Gerenciamento — GUARDA da projeção (achados 1, 2, 3 e 4).
 * Rodar: npm run test:overview
 *
 * O que este teste garante:
 *  1. um número tem UM nome só — cards e strip usam ROTULOS_CONTAGEM;
 *  2. rótulos carregam o recorte real da query (ativos / financeiras);
 *  3. as contagens vêm marcadas como duplicadoEmCards e "Última alteração" não;
 *  4. acesso (entidade ACESSO) NÃO é alteração de configuração;
 *  5. a rota filtra por entidade e mantém `ultimaAcao` (retrocompat);
 *  6. o OverviewTab filtra o strip e tem fallback para backend antigo;
 *  7. nenhum resquício de "MOCK/prévia" no cabeçalho da rota.
 */
import {
  ENTIDADE_ACESSO, ehEventoDeAcesso, montarStrip, formatarDataCurta,
  ROTULOS_CONTAGEM, ORDEM_CONTAGEM, type ContagensOverview,
} from "../lib/gerenciamento/overview-projecao"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const rotaSrc = readFileSync(join(ROOT, "src/app/api/gerenciamento/overview/route.ts"), "utf8")
const tabSrc = readFileSync(join(ROOT, "src/components/gerenciamentoComponents/OverviewTab.tsx"), "utf8")

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

const CONTAGENS: ContagensOverview = {
  usuarios: 3, perfis: 5, contas: 1, fornecedores: 0, configsFinanceiras: 0, statusCols: 0,
}

// ═══════════ 1) ACHADO 2 — um número, um nome ═══════════
console.log("\n1) Rótulos (achado 2)")
ok(ORDEM_CONTAGEM.length === 6, "as 6 contagens estão na ordem canônica")
ok(
  ORDEM_CONTAGEM.every((k) => typeof ROTULOS_CONTAGEM[k] === "string" && ROTULOS_CONTAGEM[k].length > 0),
  "toda contagem tem rótulo canônico",
)
ok(ROTULOS_CONTAGEM.fornecedores === "Fornecedores ativos", 'fornecedores diz "ativos" (a query filtra ativo:true)')
ok(ROTULOS_CONTAGEM.configsFinanceiras === "Configurações financeiras ativas", 'configsFinanceiras diz "ativas" (a query filtra ativo:true)')
ok(!("categorias" in ROTULOS_CONTAGEM) && !("centros" in ROTULOS_CONTAGEM), 'classificação financeira (categorias/centros) não é mais contada — cadastros eliminados')
ok(!/label: "Categorias"/.test(tabSrc) && !/label: "Fornecedores"/.test(tabSrc), "OverviewTab não hardcoda os rótulos ambíguos antigos")
ok(/ROTULOS_CONTAGEM/.test(tabSrc), "cards consomem a fonte única de rótulos")

// ═══════════ 2) ACHADO 1 — sem número duplicado ═══════════
console.log("\n2) Duplicidade cards × strip (achado 1)")
const strip = montarStrip(CONTAGENS, new Date("2026-07-20T10:00:00Z"))
ok(strip.length === 7, "strip tem 7 entradas (6 contagens + última alteração)")
ok(strip.filter((k) => k.duplicadoEmCards).length === 6, "as 6 contagens vêm marcadas como duplicadas")
const naoDuplicados = strip.filter((k) => !k.duplicadoEmCards)
ok(naoDuplicados.length === 1 && naoDuplicados[0].label === "Última alteração", "só 'Última alteração' sobrevive ao filtro")
ok(
  strip.filter((k) => k.duplicadoEmCards).every((k) => ORDEM_CONTAGEM.some((c) => ROTULOS_CONTAGEM[c] === k.label)),
  "todo item duplicado do strip usa o mesmo rótulo do card",
)
ok(/duplicadoEmCards/.test(tabSrc) && /filter\(\(k\) => !k\.duplicadoEmCards\)/.test(tabSrc), "OverviewTab filtra o strip pela marca")
ok(/d\.strip \?\? \[\]/.test(tabSrc), "strip ausente não quebra a tela")

// ═══════════ 3) ACHADO 3 — acesso não é alteração ═══════════
console.log("\n3) Última alteração ignora acesso (achado 3)")
ok(ENTIDADE_ACESSO === "ACESSO", "entidade de acesso é 'ACESSO' (igual ao login/route.ts)")
ok(ehEventoDeAcesso("ACESSO") && ehEventoDeAcesso("acesso") && ehEventoDeAcesso(" Acesso "), "reconhece acesso sem depender de caixa/espaço")
ok(!ehEventoDeAcesso("CONFIG_FINANCEIRA") && !ehEventoDeAcesso(null) && !ehEventoDeAcesso(undefined), "não confunde alteração com acesso")
ok(/NOT: \{ entidade: ENTIDADE_ACESSO \}/.test(rotaSrc), "a rota exclui acesso por ENTIDADE (campo indexado)")
ok(/ultimaAlteracao:/.test(rotaSrc), "a rota expõe `ultimaAlteracao`")
ok(/ultimaAcao: ultimoLog/.test(rotaSrc), "a rota MANTÉM `ultimaAcao` (retrocompat)")
ok(/DEPRECADO/.test(rotaSrc), "`ultimaAcao` está marcado como depreciado")
ok(
  /d\.ultimaAlteracao !== undefined \? d\.ultimaAlteracao : d\.ultimaAcao/.test(tabSrc),
  "OverviewTab tem fallback: ausente usa o campo antigo, null significa 'sem alteração'",
)
ok(formatarDataCurta(null) === "—", "sem alteração vira travessão, não data falsa")

// ═══════════ 4) ACHADO 4 — cabeçalho honesto ═══════════
console.log("\n4) Cabeçalho da rota (achado 4)")
const cabecalho = rotaSrc.split("import")[0]
ok(!/MOCK \("prévia"\)/i.test(cabecalho), "cabeçalho não declara mais a seção MOCK/prévia")
ok(!/devolvidas como exemplo/i.test(cabecalho), "cabeçalho não promete mais valores de exemplo")
ok(/NÃO existe valor mock/i.test(cabecalho), "cabeçalho afirma explicitamente que não há valor mock")
ok(/TODOS os números são REAIS/i.test(cabecalho), "cabeçalho declara que todo número é real")
ok(
  strip.every((k) => k.real === true),
  "todo item do strip é real (nenhum mock foi introduzido)",
)

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
console.log("Projeção do Painel Geral: validada ✅")
