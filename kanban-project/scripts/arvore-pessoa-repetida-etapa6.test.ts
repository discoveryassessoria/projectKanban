// scripts/arvore-pessoa-repetida-etapa6.test.ts
// ============================================================================
// ETAPA 6 — PESSOA REPETIDA (aviso) E CADASTRO DE LINHAGEM EM SÉRIE.
//
// Parte PURA (sem banco) + varredura de fonte da UI. A rota com banco real está em
// `arvore-pessoa-repetida-rota-etapa6.test.ts`.
//
//   npx tsx scripts/arvore-pessoa-repetida-etapa6.test.ts
// ============================================================================
import { existsSync, readFileSync } from "node:fs"

import {
  dataCompleta,
  distanciaDeEdicao,
  linkDaPessoaNoProcesso,
  mesmaDataDeNascimento,
  nomesParecidos,
  normalizarNome,
  parametrosDaConsulta,
} from "@/src/lib/genealogia/pessoa-repetida"
import { estenderTrilha, proximosPassosDaLinhagem, rotuloDaTrilha } from "@/src/lib/genealogia/cadastro-linhagem"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const fonte = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "")
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

secao("1) normalização e nomes parecidos")
ok("1a) acento/caixa/pontuação não contam", normalizarNome("  JOSÉ  d'Ávila-Neto. ") === "jose d avila neto")
ok("1b) mesmo nome com grafia diferente em acento e caixa", nomesParecidos({ nome: "José", sobrenome: "SILVA" }, { nome: "jose", sobrenome: "Silva" }))
ok("1c) ordem das partes não conta", nomesParecidos({ nome: "Maria", sobrenome: "Silva Santos" }, { nome: "Santos", sobrenome: "Maria Silva" }))
ok("1d) partículas não contam", nomesParecidos({ nome: "Maria", sobrenome: "da Silva" }, { nome: "Maria", sobrenome: "Silva" }))
ok("1e) uma letra de diferença em nome longo", nomesParecidos({ nome: "Giuseppe", sobrenome: "Bertolazzi" }, { nome: "Giuseppe", sobrenome: "Bertolazi" }))
ok("1f) nomes diferentes não casam", !nomesParecidos({ nome: "Giuseppe", sobrenome: "Rossi" }, { nome: "Giovanni", sobrenome: "Rossi" }))
ok("1g) erros somados em partes curtas não casam (Mario Rossi x Maria Rosso)", !nomesParecidos({ nome: "Mario", sobrenome: "Rossi" }, { nome: "Maria", sobrenome: "Rosso" }))
ok("1h) vazio nunca casa", !nomesParecidos({ nome: "", sobrenome: "" }, { nome: "", sobrenome: "" }))
ok("1i) distância de edição", distanciaDeEdicao("kitten", "sitting") === 3 && distanciaDeEdicao("a", "a") === 0)

secao("2) data de nascimento exata")
ok("2a) mesma data", mesmaDataDeNascimento("1980-05-17", new Date("1980-05-17T00:00:00.000Z")))
ok("2b) um dia de diferença não casa", !mesmaDataDeNascimento("1980-05-17", "1980-05-18"))
ok("2c) sem data não casa com nada", !mesmaDataDeNascimento(null, null) && !mesmaDataDeNascimento("1980-05-17", null))
ok("2d) data incompleta/impossível não vale", dataCompleta("1980-05") === null && dataCompleta("1980-02-31") === null && dataCompleta("1980-05-17") === "1980-05-17")

secao("3) quando a consulta vale")
ok("3a) nome curto → não consulta", parametrosDaConsulta({ nome: "Jo", dataNascimento: "1980-05-17" }) === null)
ok("3b) sem data completa → não consulta", parametrosDaConsulta({ nome: "Giuseppe", dataNascimento: "1980-05" }) === null)
ok("3c) nome 3+ letras e data completa → consulta", parametrosDaConsulta({ nome: " Ana ", sobrenome: "Lima", dataNascimento: "1980-05-17" })?.nome === "Ana")
ok("3d) link leva ao processo e à pessoa", linkDaPessoaNoProcesso(7, 42) === "/kanban?processoId=7&pessoaId=42")

secao("4) linhagem em série — regras puras")
ok("4a) pai/mãe novo na linha reta → oferece pai e mãe", proximosPassosDaLinhagem({ linhaReta: true, tipo: "pai", temPai: false, temMae: false }).join() === "pai,mae")
ok("4b) fora da linha reta → nada", proximosPassosDaLinhagem({ linhaReta: false, tipo: "pai", temPai: false, temMae: false }).length === 0)
ok("4c) cônjuge nunca entra na linhagem", proximosPassosDaLinhagem({ linhaReta: true, tipo: "conjuge", temPai: false, temMae: false }).length === 0)
ok("4d) só oferece o que falta", proximosPassosDaLinhagem({ linhaReta: true, tipo: "filho", temPai: true, temMae: false }).join() === "mae")
ok("4e) trilha começa na pessoa-base e cresce", estenderTrilha([], "Fulano", "Pai").join("|") === "Fulano|Pai" && estenderTrilha(["Fulano", "Pai"], null, "Avô").join("|") === "Fulano|Pai|Avô")
ok("4f) rótulo só existe com lote", rotuloDaTrilha([], "pai") === null && rotuloDaTrilha(["Fulano", "Pai"], null) === "Cadastrando linhagem: Fulano → Pai")

secao("5) UI e rota — varredura de fonte")
const view = semComentarios(fonte("src/components/arvore/arvore-genealogica-view.tsx"))
const aviso = semComentarios(fonte("src/components/arvore/aviso-pessoa-repetida.tsx"))
const rota = semComentarios(fonte("src/app/api/genealogy/pessoas-repetidas/route.ts"))
ok("5a) o aviso entra nos DOIS modais (adicionar e editar)", (view.match(/<AvisoPessoaRepetida/g) ?? []).length === 2 && (view.match(/usePessoasParecidas\(/g) ?? []).length === 2)
ok("5b) o aviso é informativo: nada no submit depende dele", !/parecidas/.test(view.slice(view.indexOf("const handleSubmit"), view.indexOf("const titles"))))
ok("5c) debounce e consulta só com parâmetros válidos", /DEBOUNCE_PESSOA_REPETIDA_MS/.test(aviso) && /parametrosDaConsulta/.test(aviso) && /AbortController/.test(aviso))
ok("5d) o aviso respeita processos.ver na UI e a rota exige arvore.ver + processos.ver", /processos\.ver/.test(aviso) && /"arvore\.ver"/.test(rota) && /"processos\.ver"/.test(rota))
ok("5e) o aviso tem link 'Abrir'", /Abrir/.test(aviso) && /c\.link/.test(aviso))
ok("5f) lote: continuar usa handleAddPai/handleAddMae (mesmo caminho do vínculo)", /onContinuarLinhagem=\{[\s\S]*?handleAddPai\(pessoaId\)[\s\S]*?handleAddMae\(pessoaId\)/.test(view))
ok("5g) lote: botões 'Adicionar pai/mãe de', 'Concluir' e indicador 'Cadastrando linhagem'", /Adicionar \{ROTULO_GENITOR\[g\]\} de \{proximo\.nome\}/.test(view) && /Concluir/.test(view) && /rotuloDaTrilha/.test(view))
ok("5h) Esc do modal de adicionar fecha e encerra o lote", /useFecharComEsc\(true, onClose\)/.test(view) && /if \(showAddPersonModal\) return/.test(view))
ok("5i) fechar zera a trilha", (view.match(/setTrilhaLinhagem\(\[\]\)/g) ?? []).length >= 2)
ok("5j) nenhuma escrita nova: o POST de pessoa continua único", (view.match(/authFetch\('\/api\/pessoas', \{\s*method: 'POST'/g) ?? []).length === 1)

console.log(`\n${passou} passaram, ${falhou} falharam`)
if (falhou > 0) console.log("Falhas:", falhas.join(", "))
process.exit(falhou > 0 ? 1 : 0)
