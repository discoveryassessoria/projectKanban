// scripts/genealogia-passo-nasce-com-tentativa.test.ts
//
// TODO PASSO NASCE COM A PRIMEIRA TENTATIVA (09/10/2026): o materializador local da Genealogia criava o passo «Localizar registro» SEM tentativa
// (o vigia EXE-002 acusou 2 passos do processo ES-27). Reabrir um passo sem tentativa apagaria o histórico em vez de arquivá-lo. Estático: sem banco.
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (f: string) => readFileSync(join(RAIZ, f), "utf8")
let n = 0, falhou = 0
const ok = (nome: string, c: boolean) => { n++; if (c) console.log(`  ✅ ${nome}`); else { falhou++; console.log(`  ❌ ${nome}`) } }
const mg = ler("src/services/genealogia/materializar-genealogia.ts"), pw = ler("src/services/phase-workflow.ts")
ok("os DOIS lugares que criam passo (instanciar e o materializador da Genealogia) garantem a tentativa", /garantirTentativa\(si\.id/.test(pw) && /garantirTentativa\(passoCriado\.id/.test(mg))
ok("no materializador a tentativa nasce logo depois da criação do passo", /const passoCriado = await db\.phaseWorkflowStepInstance\.create/.test(mg) && mg.indexOf("garantirTentativa(passoCriado.id") > mg.indexOf("const passoCriado"))
ok("só há dois criadores de PhaseWorkflowStepInstance no código de serviço", (["src/services/phase-workflow.ts", "src/services/genealogia/materializar-genealogia.ts"].every((f) => /phaseWorkflowStepInstance\.create\(/.test(ler(f)))))
console.log(`\n${n - falhou}/${n} verificações`)
if (falhou) process.exit(1)
