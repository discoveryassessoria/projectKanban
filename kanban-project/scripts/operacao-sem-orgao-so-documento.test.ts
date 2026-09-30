// scripts/operacao-sem-orgao-so-documento.test.ts
// Operação, card "Sem órgão emissor" (30/09/2026): contava as tarefas de gestor "Atribuir tarefas — Cibils"
// (#3980) e "— Salvarani" (#3928), que não têm documento nem cartório por natureza. Só tarefa DE DOCUMENTO que
// precisa de órgão conta; card, aviso "Vincular órgão nas N" e a lista que o card abre usam a MESMA definição.
import { readFileSync } from "node:fs"
import { precisaDeOrgaoEmissor, orgaoTxt, orgaoCls } from "../src/components/operacao/operacao-v3-derivacoes"
import type { LinhaOperacaoV3 } from "../src/components/operacao/operacao-v3-tipos"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}`) } }
const linha = (o: Partial<LinhaOperacaoV3>) => ({ documentoId: null, terceiroNome: null, faseMacroKey: null, ...o }) as LinhaOperacaoV3

const gestor3980 = linha({ taskId: 3980, titulo: "Atribuir tarefas — Cibils", documentoId: null, faseMacroKey: null })
const gestor3928 = linha({ taskId: 3928, titulo: "Atribuir tarefas — Salvarani", documentoId: null, faseMacroKey: null })
const certidaoSemOrgao = linha({ taskId: 3869, documentoId: 2270, faseMacroKey: "emissao_documental" })
const certidaoComOrgao = linha({ taskId: 3870, documentoId: 2271, faseMacroKey: "emissao_documental", terceiroNome: "Cartório X" })
const genealogia = linha({ taskId: 1, documentoId: 5, faseMacroKey: "genealogia" })

ok("a tarefa de gestor 'Atribuir tarefas — Cibils' (#3980) NÃO conta", !precisaDeOrgaoEmissor(gestor3980))
ok("a tarefa de gestor 'Atribuir tarefas — Salvarani' (#3928) NÃO conta", !precisaDeOrgaoEmissor(gestor3928))
ok("tarefa de gestor não conta nem se tiver fase", !precisaDeOrgaoEmissor(linha({ documentoId: null, faseMacroKey: "emissao_documental" })))
ok("certidão da Emissão SEM órgão conta (o caso real do card)", precisaDeOrgaoEmissor(certidaoSemOrgao))
ok("certidão COM órgão não conta", !precisaDeOrgaoEmissor(certidaoComOrgao))
ok("Genealogia sem órgão continua fora (é o trabalho em curso)", !precisaDeOrgaoEmissor(genealogia))
const abertas = [gestor3980, gestor3928, certidaoSemOrgao, certidaoComOrgao, genealogia]
ok("num conjunto misto o card conta só 1 (a certidão), não 3", abertas.filter(precisaDeOrgaoEmissor).length === 1)
ok("a coluna Órgão da tarefa de gestor mostra '—' neutro, não 'não vinculado' vermelho", orgaoTxt(gestor3980) === "—" && orgaoCls(gestor3980) === "opv3-p-gry")
ok("a certidão sem órgão continua 'não vinculado' vermelho", orgaoTxt(certidaoSemOrgao) === "não vinculado" && orgaoCls(certidaoSemOrgao) === "opv3-p-red")

const v3 = readFileSync("src/components/operacao/operacao-v3.tsx", "utf8")
ok("card e lista do radar usam a MESMA função (número = lista)", /const noOrg = useMemo\(\(\) => abertosVisiveis\.filter\(precisaDeOrgaoEmissor\)/.test(v3) && /linhasDoRadar\(radar, abertosVisiveis, filaBase/.test(v3) && /if \(radar === "noorg"\) return fila\.filter\(precisaDeOrgaoEmissor\)/.test(readFileSync("src/components/operacao/operacao-v3-derivacoes.ts", "utf8")))
ok("nenhuma definição paralela '!l.terceiroNome && l.faseMacroKey !== \"genealogia\"' sobrou", !/!l\.terceiroNome && l\.faseMacroKey !== "genealogia"/.test(v3))

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
