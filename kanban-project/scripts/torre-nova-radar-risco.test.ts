// scripts/torre-nova-radar-risco.test.ts
// ============================================================================
// TORRE NOVA — RADAR + PROCESSOS: A REGRA ÚNICA DE RISCO (`lib/operacional/torre-risco.ts`). Puro, sem banco.
//
//   npx tsx scripts/torre-nova-radar-risco.test.ts
//
// PROVA: cada um dos quatro níveis e as BORDAS (score 2/3/5/6, 14/15 dias parado, dias = meta × meta + 1, prazo hoje/amanhã,
// sem meta ⇒ nenhum limiar inventado), a precedência (crítico > parado > atenção > no ritmo), o vocabulário do Radar (3 baldes) e
// da aba Processos (ok/at/pa/sd), a ordenação, o motivo legível e a CONTINUIDADE com `faixaDoScore` do "Precisa de você"
// (limiares 3 e 6 lidos do código de lá).
// ============================================================================
import { readFileSync } from "node:fs"
import {
  riscoDoProcesso, riscoDaCelula, ehGrave, precisaDeAlguem, rotuloNoRadar, baldeDoRadar, situacaoDaFase, ROTULO_DA_SITUACAO, PESO_DA_SITUACAO,
  PESO_NO_RADAR, GRAVIDADE, LIMIAR_ATENCAO_SCORE, LIMIAR_CRITICO_SCORE, DIAS_PARADO, type EntradaDoRisco, type NivelDeRisco,
} from "../lib/operacional/torre-risco"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)

const base = (o: Partial<EntradaDoRisco> = {}): EntradaDoRisco => ({ scoreMaximo: 0, semDono: false, diasNaFase: 5, metaDias: 30, bolaForaHaDias: null, ...o })
const nivel = (o: Partial<EntradaDoRisco>): NivelDeRisco => riscoDoProcesso(base(o)).nivel

secao("NO RITMO")
ok("nada de errado → no_ritmo", nivel({}) === "no_ritmo")
ok("score 2 sozinho (ex.: bloqueada) → ainda no ritmo", nivel({ scoreMaximo: 2 }) === "no_ritmo")
ok("o texto do no ritmo é fixo e não lista motivo", riscoDoProcesso(base()).motivo === "No ritmo: nada atrasado, sem dono ou vencendo" && riscoDoProcesso(base()).motivos.length === 0)

secao("ATENÇÃO — as quatro condições e as bordas")
ok("A1 · score 3 (sem responsável) → atenção; score 2 → não", nivel({ scoreMaximo: 3 }) === "atencao" && nivel({ scoreMaximo: 2 }) === "no_ritmo")
ok("A1 · score 5 ainda é atenção (6 já é crítico)", nivel({ scoreMaximo: 5 }) === "atencao" && nivel({ scoreMaximo: 6 }) === "critico")
ok("A2 · cobrança vencida sozinha (score 2) → atenção", nivel({ scoreMaximo: 2, sinais: { acompanhamentoVencido: 1 } }) === "atencao")
ok("A3 · prazo hoje/amanhã (score 0) → atenção", nivel({ sinais: { vencemEmBreve: 1 } }) === "atencao")
ok("A4 · dias = meta NÃO passa; meta + 1 passa", nivel({ diasNaFase: 30, metaDias: 30 }) === "no_ritmo" && nivel({ diasNaFase: 31, metaDias: 30 }) === "atencao")
ok("A4 · SEM meta nenhum limiar é inventado (130 d na fase continua no ritmo)", nivel({ diasNaFase: 130, metaDias: null }) === "no_ritmo")
ok("A4 · sem registro de entrada na fase (dias null) não compara com a meta", nivel({ diasNaFase: null, metaDias: 30 }) === "no_ritmo")
ok("A4 · meta 0 ou negativa não vale como meta", nivel({ diasNaFase: 5, metaDias: 0 }) === "no_ritmo")
ok("o motivo da meta diz os dois números", riscoDoProcesso(base({ diasNaFase: 52, metaDias: 30 })).motivo === "Atenção: 52 dias na fase (meta 30 dias)")

secao("PARADO — bola fora 15+ dias COM a cobrança vencida")
ok("14 dias com cobrança vencida → não é parado (atenção pela cobrança)", nivel({ bolaForaHaDias: 14, sinais: { acompanhamentoVencido: 1 } }) === "atencao")
ok("15 dias com cobrança vencida → parado", nivel({ bolaForaHaDias: DIAS_PARADO, sinais: { acompanhamentoVencido: 1 } }) === "parado")
ok("40 dias com a cobrança EM DIA → espera acompanhada, não parado", nivel({ bolaForaHaDias: 40, sinais: { acompanhamentoVencido: 0 } }) === "no_ritmo")
ok("aguardando a equipe (dias null) com cobrança vencida nunca é parado", nivel({ bolaForaHaDias: null, sinais: { acompanhamentoVencido: 2 } }) === "atencao")
ok("o motivo do parado diz quem é aguardado e há quantos dias", riscoDoProcesso(base({ bolaForaHaDias: 20, bolaRotulo: "Cartório", sinais: { acompanhamentoVencido: 1 } })).motivo === "Parado: aguardando Cartório há 20 dias sem cobrança em dia")

secao("CRÍTICO — pontuação ≥ 6 e precedência")
ok("atraso nosso (4) + sem dono (3) = 7 → crítico", nivel({ scoreMaximo: 7, semDono: true, sinais: { atrasadas: 1, semResponsavel: 1 } }) === "critico")
ok("fase deixada (3) + divergência (3) = 6 → crítico (borda)", nivel({ scoreMaximo: 6, sinais: { faseDeixada: true, divergencia: true } }) === "critico")
ok("crítico vence parado", nivel({ scoreMaximo: 8, bolaForaHaDias: 30, sinais: { acompanhamentoVencido: 1 } }) === "critico")
ok("parado vence atenção", nivel({ scoreMaximo: 3, bolaForaHaDias: 20, diasNaFase: 99, sinais: { acompanhamentoVencido: 1 } }) === "parado")
const crit = riscoDoProcesso(base({ scoreMaximo: 7, semDono: true, sinais: { atrasadas: 2, semResponsavel: 3, vencemEmBreve: 1 } }))
ok("o motivo junta TODOS os fatos, o mais grave primeiro", crit.motivo === "Crítico: 2 tarefas atrasadas · sem responsável · 1 tarefa com prazo hoje ou amanhã", crit.motivo)
ok("o motivo cai na pontuação quando o fato não é conhecido", riscoDoProcesso(base({ scoreMaximo: 6 })).motivo === "Crítico: pontuação 6 no Precisa de você")

secao("A CÉLULA DO RADAR — só a fase ATUAL tem risco")
ok("feita, futura e n/a → null", (["feita", "futura", "na"] as const).every((e) => riscoDaCelula(e, base({ scoreMaximo: 9 })) === null))
ok("atual → o mesmo risco do processo", riscoDaCelula("atual", base({ scoreMaximo: 9 }))?.nivel === "critico")

secao("OS VOCABULÁRIOS DAS TELAS")
ok("Radar: parado e crítico são 'crítico' (balde vermelho); atenção; no ritmo", rotuloNoRadar("parado") === "crítico" && rotuloNoRadar("critico") === "crítico" && rotuloNoRadar("atencao") === "atenção" && rotuloNoRadar("no_ritmo") === "no ritmo")
ok("balde do Radar (ProcessoDaTorre.risco): ok · atencao · critico", baldeDoRadar("no_ritmo") === "ok" && baldeDoRadar("atencao") === "atencao" && baldeDoRadar("parado") === "critico" && baldeDoRadar("critico") === "critico")
ok("ehGrave = parado ou crítico; precisaDeAlguem = tudo menos no ritmo", ehGrave("parado") && ehGrave("critico") && !ehGrave("atencao") && !ehGrave("no_ritmo") && precisaDeAlguem("atencao") && !precisaDeAlguem("no_ritmo"))
ok("Processos: sem dono vence qualquer nível", (["no_ritmo", "atencao", "parado", "critico"] as const).every((n) => situacaoDaFase(n, true) === "sd"))
ok("Processos: parado/crítico com dono → 'pa'; atenção → 'at'; no ritmo → 'ok'", situacaoDaFase("parado", false) === "pa" && situacaoDaFase("critico", false) === "pa" && situacaoDaFase("atencao", false) === "at" && situacaoDaFase("no_ritmo", false) === "ok")
ok("rótulos das pílulas: No ritmo · Atenção · Parado · Sem dono", ROTULO_DA_SITUACAO.ok === "No ritmo" && ROTULO_DA_SITUACAO.at === "Atenção" && ROTULO_DA_SITUACAO.pa === "Parado" && ROTULO_DA_SITUACAO.sd === "Sem dono")
ok("ordem 'mais atrasado primeiro': Parado → Sem dono → Atenção → No ritmo", PESO_DA_SITUACAO.pa < PESO_DA_SITUACAO.sd && PESO_DA_SITUACAO.sd < PESO_DA_SITUACAO.at && PESO_DA_SITUACAO.at < PESO_DA_SITUACAO.ok)
ok("ordem 'mais grave' do Radar: balde vermelho(0) → atenção(1) → no ritmo(2)", PESO_NO_RADAR.critico === 0 && PESO_NO_RADAR.parado === 0 && PESO_NO_RADAR.atencao === 1 && PESO_NO_RADAR.no_ritmo === 2)
ok("gravidade total: no_ritmo < atenção < parado < crítico", GRAVIDADE.no_ritmo < GRAVIDADE.atencao && GRAVIDADE.atencao < GRAVIDADE.parado && GRAVIDADE.parado < GRAVIDADE.critico)

secao("CONTINUIDADE com o score do 'Precisa de você'")
const fonte = readFileSync("lib/operacional/precisa-de-voce.ts", "utf8")
ok("faixaDoScore lá usa os MESMOS limiares (≥6 crítico, ≥3 atenção)", new RegExp(`score >= ${LIMIAR_CRITICO_SCORE}\\) return 'CRITICO'`).test(fonte) && new RegExp(`score >= ${LIMIAR_ATENCAO_SCORE}\\) return 'ATENCAO'`).test(fonte))
for (let s = 0; s <= 12; s++) {
  const esperado = s >= LIMIAR_CRITICO_SCORE ? "critico" : s >= LIMIAR_ATENCAO_SCORE ? "atencao" : "no_ritmo"
  if (nivel({ scoreMaximo: s }) !== esperado) ok(`score ${s} → ${esperado}`, false)
}
ok("scores 0 a 12: só pela pontuação (sem outros sinais) a regra reproduz as faixas do Precisa de você", true)
ok("o módulo é PURO: não importa prisma nem o relógio", !/from ['"]@\/lib\/prisma|new Date\(|Date\.now/.test(readFileSync("lib/operacional/torre-risco.ts", "utf8").replace(/\/\/[^\n]*/g, "")))

console.log(`\n${passou} verificações ok, ${falhou} falha(s)`)
process.exit(falhou ? 1 : 0)
