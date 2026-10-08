// scripts/vinculo-requerente-varios-processos.test.ts
//
// UM REQUERENTE EM VÁRIOS PROCESSOS (08/10/2026): a Caroline é requerente da cidadania italiana (IT-70, ainda sem árvore) e da espanhola (ES-3, árvore 315).
// O requerente é UM cadastro, ligado a UMA pessoa — a da árvore de um dos processos dele. O vigia INT-004 acusava o outro processo de «vínculo cruzado».
// Só é cruzado se a árvore da pessoa não é de NENHUM processo do requerente. Estático: sem banco.
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const fonte = readFileSync(join(RAIZ, "lib/saude/verificacoes/vinculo-requerente-arvore.ts"), "utf8")
let n = 0, falhou = 0
const ok = (nome: string, c: boolean) => { n++; if (c) console.log(`  ✅ ${nome}`); else { falhou++; console.log(`  ❌ ${nome}`) } }
ok("o vigia monta as árvores de TODOS os processos do requerente", /arvoresDoRequerente/.test(fonte) && /arvoresDoRequerente\.set\(v\.requerenteId/.test(fonte))
ok("o caso D só acusa se a árvore da pessoa não é de nenhum processo do requerente", /pes\.arvoreId !== proc\.arvoreId && !arvoresDoRequerente\.get\(r\.id\)\?\.has\(pes\.arvoreId\)/.test(fonte))
ok("o outro processo do requerente (pessoa de outra árvore DELE) não cai nos casos B/C por engano", /requerente em mais de um processo/.test(fonte))
console.log(`\n${n - falhou}/${n} verificações`)
if (falhou) process.exit(1)
