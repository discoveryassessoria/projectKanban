// scripts/anexo-abre-sem-baixar.test.ts
//
// PRÉ-VISUALIZAR NUNCA BAIXA (08/10/2026): a gaveta do documento pedia a URL do arquivo sem dizer o tipo; a porta assumia
// `application/octet-stream` e o navegador baixava em vez de mostrar (quadro em branco). Agora o tipo sai do que a tela informa ou, na falta,
// da extensão — e só `baixar: true` (botão «Baixar») gera `attachment`. Puro: sem banco e sem rede.
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { mimeDoAnexo, TIPO_GENERICO } from "../src/lib/anexos/mime"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (f: string) => readFileSync(join(RAIZ, f), "utf8")
let n = 0, falhou = 0
const ok = (nome: string, c: boolean, d = "") => { n++; if (c) console.log(`  ✅ ${nome}`); else { falhou++; console.log(`  ❌ ${nome}${d ? ` — ${d}` : ""}`) } }

console.log("\n1) O tipo do arquivo")
ok("tipo informado e específico vale", mimeDoAnexo({ mime: "application/pdf", nome: "x.png" }) === "application/pdf")
ok("sem tipo: sai da extensão do nome (o caso da gaveta)", mimeDoAnexo({ nome: "1.  Nascimento Juan Abellan Bano.pdf" }) === "application/pdf")
ok("tipo genérico não vence a extensão", mimeDoAnexo({ mime: TIPO_GENERICO, nome: "foto.JPG" }) === "image/jpeg")
ok("sem nome: sai da extensão da chave", mimeDoAnexo({ chave: "privado/anexos/documento/2411/1791469898663-1f92d426-1._Nascimento_Juan_Abellan_Bano.pdf" }) === "application/pdf")
ok("extensão desconhecida continua genérica", mimeDoAnexo({ nome: "arquivo.xyz" }) === TIPO_GENERICO && mimeDoAnexo({}) === TIPO_GENERICO)

console.log("\n2) A porta e as telas")
const porta = ler("src/app/api/anexos/abrir/route.ts"), storage = ler("src/lib/anexos/storage.ts")
ok("a porta usa mimeDoAnexo (não assume genérico)", /mimeDoAnexo\(/.test(porta) && !/: "application\/octet-stream"/.test(porta))
ok("só baixar:true gera attachment", /\$\{baixar \? "attachment" : "inline"\}/.test(storage) && /body\.baixar === true/.test(porta))
const gaveta = ler("src/components/kanban/DocumentoBibliotecaDrawer.tsx")
ok("a pré-visualização (iframe e imagem) leva nome e tipo", /<IframeDeAnexo valor=\{arquivoUrl\} nome=\{arquivoNome \?\? undefined\} mime=/.test(gaveta) && /<ImagemDeAnexo valor=\{arquivoUrl\} nome=/.test(gaveta))
ok("«Abrir em nova aba» e «Abrir arquivo principal» levam o tipo", (gaveta.match(/mime=\{(item\.arquivoMimeType|arquivoMimeType) \?\? undefined\}/g) ?? []).length >= 4)
const visores = ler("src/lib/anexos/visores.tsx")
ok("os visores repassam nome e tipo ao pedido da URL", (visores.match(/useUrlDeAnexo\(valor, \{ nome, mime \}\)/g) ?? []).length === 2)

console.log(`\n${n - falhou}/${n} verificações`)
if (falhou > 0) process.exit(1)
