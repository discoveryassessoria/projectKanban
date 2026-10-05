// scripts/guard-migration-preview.test.ts — o Preview não cai por migration pendente; a PRODUÇÃO continua travada (sem banco).
import { readFileSync } from "node:fs"
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}`) } }
const g = readFileSync("scripts/migration-pendente-guard.mjs", "utf8")
const iPrev = g.indexOf("AMBIENTE === 'preview'")
const iFalha = g.indexOf("MIGRATION PENDENTE — O BUILD PARA AQUI")
ok("existe a saída de aviso para preview", iPrev > -1)
ok("ela vem ANTES da reprovação e não reprova (exit 0)", iPrev > -1 && iPrev < iFalha && /AMBIENTE === 'preview'[\s\S]{0,700}process\.exit\(0\)/.test(g))
ok("a reprovação continua existindo para produção (exit 1)", /MIGRATION PENDENTE — O BUILD PARA AQUI[\s\S]*process\.exit\(1\)/.test(g))
ok("a lista de pendentes continua sendo escrita no preview", /preview[\s\S]{0,400}for \(const m of pendentes\)/.test(g))
ok("o guard continua sem escrever em banco", !g.includes("migrate deploy") && !g.includes("$executeRaw"))
console.log(`\n${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
