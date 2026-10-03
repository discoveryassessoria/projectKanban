// scripts/arvore-operacao-localizar-naturalizacao.test.ts
// ============================================================================
// O QUE FICA NA ABA OPERAÇÃO DA PESSOA depois que o painel "Inteligência" saiu:
//   • sugestão de ONDE LOCALIZAR a certidão, DENTRO da exigência correspondente
//     (nascimento / casamento), com "Criar tarefa" quando não há tarefa;
//   • naturalização do ascendente transmissor, item destacado só nele;
//   • alertas cronológicos e "filho em comum sem união" continuam como itens.
// Nenhum texto exibido cita nome técnico de entidade.
//
//   npx tsx scripts/arvore-operacao-localizar-naturalizacao.test.ts
// ============================================================================
import { readFileSync } from "node:fs"
import { analisarArvore } from "@/src/lib/genealogia/motor/analisar"
import type { PessoaEntrada } from "@/src/lib/genealogia/motor/tipos"
import { fatosDePesquisa } from "@/src/lib/genealogia/operacional/localizar-certidao"
import { achadosDoMotorPorPessoa } from "@/src/lib/genealogia/operacional/achados-do-motor"
import { montarFilaDaPessoa, type NecessidadeDaFila } from "@/src/lib/genealogia/operacional/fila-da-pessoa"

let passou = 0, falhou = 0
const ok = (c: boolean, n: string, extra: unknown = "") => {
  const e = extra === "" ? "" : ` — ${JSON.stringify(extra)}`
  if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}${e}`) }
}

const PESSOAS: PessoaEntrada[] = [
  { id: 1, nome: "Giuseppe", sobrenome: "Rossi", sexo: "M", pais_nasc: "Itália", local_nasc: "Vicenza", data_nasc: "1880-03-02" },
  { id: 2, nome: "Antonio", sobrenome: "Rossi", sexo: "M", pais_nasc: "Brasil", local_nasc: "Caxias do Sul", data_nasc: "1915-06-11", paiId: 1 },
  { id: 3, nome: "Marcos", sobrenome: "Rossi", sexo: "M", pais_nasc: "Brasil", data_nasc: "1950-01-20", paiId: 2, requerente: "maior" },
]
const analise = analisarArvore(PESSOAS, [], { paisAlvo: "ITALIA", raizId: 3 })
const fatos = fatosDePesquisa(analise)

const nec = (id: number, pessoaId: number | null, ruleCode: string, situacaoCertidao: NecessidadeDaFila["situacaoCertidao"], uniaoId: number | null = null): NecessidadeDaFila => ({
  id, pessoaId, uniaoId, status: "PENDENTE", obrigatoriedade: "OBRIGATORIA", ciclo: 1, ruleCode, situacaoCertidao,
  itemCatalogo: { id: 1, code: "X", name: "Certidão" },
})
const base = { processoId: 9, faseAtualKey: "genealogia", uniaoIdsDaPessoa: [] as number[], achados: [], registros: fatos.registros, naturalizacao: fatos.naturalizacao, nomeDePessoa: (id: number) => PESSOAS.find((p) => p.id === id)!.nome }

console.log("\nOnde localizar a certidão")
const reg = fatos.registros.find((r) => r.evento === "nascimento" && r.pessoaId === 2)
ok(!!reg && reg.municipio === "Caxias do Sul" && reg.ano === 1915 && reg.orgao.length > 0, "o motor entrega órgão, município e ano calculado do nascimento", reg)

const semTarefa = montarFilaDaPessoa({ ...base, pessoaId: 2, necessidades: [nec(10, 2, "GEN-CIVIL-NASC", "NAO_LOCALIZADA")], tarefas: [] })
const doc = semTarefa.itens.find((i) => i.tipo === "documento")
ok(doc?.tipo === "documento" && doc.localizacao?.municipio === "Caxias do Sul", "a sugestão aparece DENTRO da exigência de nascimento")
ok(doc?.tipo === "documento" && doc.acoes.some((a) => a.tipo === "criar_tarefa"), "sem tarefa: oferece 'Criar tarefa'")
const rasc = doc?.tipo === "documento" ? doc.acoes.find((a) => a.tipo === "criar_tarefa") : undefined
ok(rasc?.tipo === "criar_tarefa" && rasc.rascunho.necessidadeId === 10 && /Caxias do Sul/.test(rasc.rascunho.motivo), "o rascunho vincula a exigência e leva a sugestão na descrição")

const comTarefa = montarFilaDaPessoa({ ...base, pessoaId: 2, necessidades: [nec(10, 2, "GEN-CIVIL-NASC", "NAO_LOCALIZADA")], tarefas: [{ id: 77, titulo: "t", concluida: false, necessidadeId: 10 }] })
const doc2 = comTarefa.itens.find((i) => i.tipo === "documento")
ok(doc2?.tipo === "documento" && doc2.localizacao != null && !doc2.acoes.some((a) => a.tipo === "criar_tarefa") && doc2.acoes.some((a) => a.tipo === "abrir_tarefa"), "com tarefa: abre a existente, não oferece criar")

const recebida = montarFilaDaPessoa({ ...base, pessoaId: 2, necessidades: [nec(10, 2, "GEN-CIVIL-NASC", "RECEBIDA")], tarefas: [] })
const doc3 = recebida.itens.find((i) => i.tipo === "documento")
ok(doc3?.tipo === "documento" && doc3.localizacao === null, "exigência já resolvida (recebida): sem sugestão")

const outraRegra = montarFilaDaPessoa({ ...base, pessoaId: 2, necessidades: [nec(11, 2, "GEN-CIVIL-OBITO", "NAO_LOCALIZADA")], tarefas: [] })
const doc4 = outraRegra.itens.find((i) => i.tipo === "documento")
ok(doc4?.tipo === "documento" && doc4.localizacao === null, "a sugestão de nascimento não vaza para a exigência de óbito")

console.log("\nNaturalização do ascendente transmissor")
ok(fatos.naturalizacao?.pessoaId === 1, "o motor aponta o ascendente que origina o direito", fatos.naturalizacao?.pessoaId)
const filaTransm = montarFilaDaPessoa({ ...base, pessoaId: 1, necessidades: [], tarefas: [] })
const nat = filaTransm.itens.find((i) => i.tipo === "naturalizacao")
ok(nat?.tipo === "naturalizacao" && /decide a viabilidade/.test(nat.explicacao) && nat.acoes.some((a) => a.tipo === "criar_tarefa"), "item destacado na pessoa transmissora, com explicação e 'Criar tarefa'")
ok(filaTransm.itens[0]?.tipo === "naturalizacao", "vem primeiro na fila")
const filaOutra = montarFilaDaPessoa({ ...base, pessoaId: 2, necessidades: [], tarefas: [] })
ok(!filaOutra.itens.some((i) => i.tipo === "naturalizacao"), "não aparece em quem não é o transmissor")

console.log("\nCronologia e filho em comum continuam")
const PESS2: PessoaEntrada[] = [
  { id: 4, nome: "Ana", sobrenome: "Lima", sexo: "F", data_nasc: "1971-04-04" },
  { id: 5, nome: "Pedro", sobrenome: "Souza", sexo: "M", data_nasc: "1970-01-01" },
  { id: 6, nome: "Lia", sobrenome: "Souza", sexo: "F", data_nasc: "1995-01-01", paiId: 5, maeId: 4 },
  { id: 7, nome: "Tio", sobrenome: "Souza", sexo: "M", data_nasc: "1980-01-01", vivo: false, data_obito: "1970-01-01" },
]
const a2 = analisarArvore(PESS2, [], { paisAlvo: "ITALIA", raizId: 6 })
const ach = achadosDoMotorPorPessoa(a2)
ok((ach.get(4) ?? []).some((a) => a.categoria === "relacao"), "filho em comum sem união registrada: item na pessoa envolvida")
ok((ach.get(7) ?? []).some((a) => a.categoria === "divergencia"), "data impossível (óbito antes do nascimento): item na pessoa envolvida")

console.log("\nTextos")
const textos = JSON.stringify([semTarefa, filaTransm, fatos])
ok(!/NECESSIDADEDOCUMENTAL|NecessidadeDocumental|ruleCode|GEN-CIVIL/i.test(textos.replace(/"ruleCode":"[^"]*"/g, "")), "nenhum nome técnico de entidade nos textos")
ok(/Regras documentais \/ motor genealógico/.test(JSON.stringify(semTarefa)), "a fonte citada é 'Regras documentais / motor genealógico'")
const tela = readFileSync("src/components/arvore/fila-da-pessoa.tsx", "utf8")
ok(!/NECESSIDADEDOCUMENTAL|NecessidadeDocumental/i.test(tela.replace(/\/\/.*$/gm, "")), "a tela não exibe nome técnico")

console.log(`\n${passou + falhou} verificações · ${falhou === 0 ? "OK ✅" : "FALHOU ❌"}`)
process.exit(falhou === 0 ? 0 : 1)
