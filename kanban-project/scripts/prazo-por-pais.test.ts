// scripts/prazo-por-pais.test.ts
//
// PRAZO POR PAÍS DO REGISTRO (08/10/2026): «nasceu na Itália: 30 dias; casou e morreu no Brasil: 1 dia». Cadastro no Gerenciamento
// (`RegraTemporalPais`), UM decisor (`lib/operacional/prazo-por-pais.ts`). Puro: sem banco — prova a regra e que os pontos de
// escrita do prazo da instância passam pelo decisor.
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { chaveDoPais, categoriaDoItem, paisDoEvento, decidirSla } from "../lib/operacional/prazo-por-pais"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (f: string) => readFileSync(join(RAIZ, f), "utf8")
let n = 0, falhou = 0
const ok = (nome: string, c: boolean, d = "") => { n++; if (c) console.log(`  ✅ ${nome}`); else { falhou++; console.log(`  ❌ ${nome}${d ? ` — ${d}` : ""}`) } }

console.log("\n1) Chave do país")
ok("Brasil e variantes = «brasil»", ["Brasil", "brasil", " Brazil ", "BR"].every((p) => chaveDoPais(p) === "brasil"))
ok("Itália/Italia = «italia»; Alemanha sem acento", chaveDoPais("Itália") === "italia" && chaveDoPais("italia") === "italia" && chaveDoPais("Alemanha") === "alemanha")
ok("VAZIO NÃO vira Brasil: sem país a regra não se aplica", chaveDoPais("") === null && chaveDoPais(null) === null && chaveDoPais("   ") === null)

console.log("\n2) Evento da certidão → país")
const pessoa = { pais_nasc: "Itália", pais_obito: "Brasil" }, uniao = { pais: "Brasil" }
ok("nascimento lê o país de nascimento", paisDoEvento(categoriaDoItem({ code: "CERT_NASCIMENTO_IT" }), { pessoa, uniao }) === "Itália")
ok("óbito lê o país do óbito", paisDoEvento(categoriaDoItem({ code: "CERT_OBITO_IT" }), { pessoa, uniao }) === "Brasil")
ok("casamento lê o país da união", paisDoEvento(categoriaDoItem({ code: "CERT_CASAMENTO_IT" }), { pessoa, uniao }) === "Brasil")
ok("pelo nome também (sem código)", categoriaDoItem({ name: "Certidão de Óbito - Inteiro Teor" }) === "OBITO")
ok("evento sem país → null (nunca palpite)", paisDoEvento("NASCIMENTO", { pessoa: { pais_nasc: null } }) === null && paisDoEvento("CASAMENTO", { uniao: null }) === null)
ok("item que não é certidão de evento → null", paisDoEvento(categoriaDoItem({ code: "DOC_RG", name: "RG" }), { pessoa, uniao }) === null)

console.log("\n3) Decisão: a regra do país ganha; sem regra, vale o prazo do passo")
const regras = [{ id: 1, paisChave: "brasil", slaDays: 1, ativo: true }, { id: 2, paisChave: "portugal", slaDays: 10, ativo: false }]
ok("Brasil → 1 dia (origem PAIS)", decidirSla(30, "brasil", regras).slaDays === 1 && decidirSla(30, "brasil", regras).origem === "PAIS")
ok("Itália (sem regra) → 30 do passo", decidirSla(30, "italia", regras).slaDays === 30 && decidirSla(30, "italia", regras).origem === "PASSO")
ok("sem país → 30 do passo", decidirSla(30, null, regras).slaDays === 30)
ok("regra inativa não vale", decidirSla(30, "portugal", regras).slaDays === 30)
ok("passo sem prazo + Brasil → 1 (a regra dá o prazo)", decidirSla(0, "brasil", regras).slaDays === 1)

console.log("\n4) Todo ponto que grava o prazo do passo passa pelo decisor")
const pw = ler("src/services/phase-workflow.ts"), mg = ler("src/services/genealogia/materializar-genealogia.ts")
ok("criação do passo (phase-workflow) usa slaDoPassoDaNecessidade", /slaDays: \(await slaDoPassoDaNecessidade\(tx,/.test(pw) && !/slaDays: a\.def\.slaDays,/.test(pw))
ok("criação do passo (materializar-genealogia) usa slaDoPassoDaNecessidade", /slaDays: \(await slaDoPassoDaNecessidade\(db,/.test(mg) && !/slaDays: slaDaysLocalizarRegistro,/.test(mg))
ok("a republicação compara o SLA EFETIVO (com o país), não o do passo cru", /slaAntigoEfetivo/.test(pw) && /slaNovoEfetivo/.test(pw) && !/antes\.slaDays !== depois\.slaDays/.test(pw))

console.log("\n5) Cadastro no Gerenciamento: rota + tela + vigia, nada de botão morto")
const rota = ler("src/app/api/gerenciamento/prazo-por-pais/route.ts"), tela = ler("src/components/gerenciamentoComponents/PrazoPorPaisDoPasso.tsx")
ok("rota GET/PUT/DELETE com permissão e auditoria", /export async function GET/.test(rota) && /export async function PUT/.test(rota) && /export async function DELETE/.test(rota) && /usuarios\.gerenciar/.test(rota) && /PRAZO_POR_PAIS_ALTERADO/.test(rota))
ok("a tela chama a rota (adicionar, alterar, remover)", /method: "PUT"/.test(tela) && /method: "DELETE"/.test(tela) && /prazo-por-pais\?stepKey=/.test(tela))
ok("o modal do passo mostra o cadastro", /<PrazoPorPaisDoPasso /.test(ler("src/components/gerenciamentoComponents/ConfiguracaoDoPassoModal.tsx")))
ok("a migration já deixa o Brasil = 1 dia cadastrado para localizar_registro", /'localizar_registro', 'brasil', 'Brasil', 1/.test(ler("prisma/migrations/20261008190000_regra_temporal_pais/migration.sql")))
ok("vigia u existe e entra na varredura", /detectarRegraU/.test(ler("lib/saude/verificacoes/regras-do-marco.ts")) && /"t", "u"/.test(ler("scripts/vigia-regras-do-marco.ts")))

console.log(`\n${n - falhou}/${n} verificações`)
if (falhou > 0) process.exit(1)
