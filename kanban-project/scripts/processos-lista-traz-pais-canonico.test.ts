// scripts/processos-lista-traz-pais-canonico.test.ts
// Achado 30/09/2026: a aba Geral do processo mostrava "PAÍS —" (paisId=1, Itália) porque o modal lê
// `processo.paisCanonico` e NÃO busca de novo, e `GET /api/processos` (lista) não incluía a relação — só o detalhe
// `GET /api/processos/[id]` incluía. Contrato: toda rota que entrega o processo ao modal traz o país canônico.
import { readFileSync } from "node:fs"
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}`) } }
const lista = readFileSync("src/app/api/processos/route.ts", "utf8")
const detalhe = readFileSync("src/app/api/processos/[processoId]/route.ts", "utf8")
const includes = [...lista.matchAll(/familia: \{ select: \{ id: true, nome: true \} \}/g)].length
const comPais = [...lista.matchAll(/paisCanonico: \{ select: \{ countryKey: true, countryLabel: true, flag: true, language: true \} \}/g)].length
ok("a lista tem 2 includes de processo (listagem e resposta da criação)", includes === 2)
ok("os DOIS trazem paisCanonico (countryKey, countryLabel, flag, language)", comPais === 2)
ok("o detalhe continua trazendo paisCanonico", /paisCanonico: \{ select: \{ countryKey: true, countryLabel: true, flag: true \} \}/.test(detalhe))
const modal = readFileSync("src/components/kanban/atividade-details-modal.tsx", "utf8")
ok("o modal lê o país de processo.paisCanonico (a fonte que a lista agora entrega)", /paisRel\?\.countryLabel/.test(modal))
console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
