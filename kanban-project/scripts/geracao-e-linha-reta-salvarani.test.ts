// scripts/geracao-e-linha-reta-salvarani.test.ts
// ============================================================================
// GUARDA (06/10/2026) — caso real Salvarani (IT-1, 676): (1) o "G" é a GERAÇÃO de verdade, calculada pela filiação (irmãos na MESMA geração; cônjuge na do
// parceiro), e não `numeroLinhagem` (número de sequência); (2) "linha reta" = estar no caminho de filiação entre o ancestral de origem e PELO MENOS UM
// requerente — com dois ramos de requerentes ninguém cai em "sem filiação que chegue ao requerente"; (3) o parentesco diz em relação a quem, e a linha diz de quais.
//   npx tsx scripts/geracao-e-linha-reta-salvarani.test.ts
// ============================================================================
import { calcularGeracoes } from "../src/lib/genealogia/geracao"
import { montarPessoasDoProcesso, type PessoaBruta } from "../src/lib/process-stage/central-operacional-core"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }

// A árvore Salvarani (ids reais do caso, onde conhecidos). numeroLinhagem de PROPÓSITO como o sistema o gera: sequência em profundidade, irmãos diferentes.
const P = (id: number, nome: string, o: Partial<PessoaBruta> & { paiId?: number | null; maeId?: number | null }): PessoaBruta =>
  ({ id, nome, sobrenome: null, requerente: "nao", linhaReta: false, numeroLinhagem: null, paiId: null, maeId: null, ...o })
const ID = { erminio: 1, guilhermina: 2, carlota: 3, antonio: 4, adelia: 5, albertoLuis: 6, silvia: 2949, joseRoberto: 2950, monica: 2875, albertoJr: 2877, renata: 2876, andre: 2879, mariaCarolina: 2880, joseJr: 2952, alessandra: 2953 }
const pessoas: PessoaBruta[] = [
  P(ID.erminio, "Erminio", { linhaReta: true, numeroLinhagem: 1 }), P(ID.guilhermina, "Guilhermina", { numeroLinhagem: 1 }),
  P(ID.carlota, "Carlota", { linhaReta: true, numeroLinhagem: 2, paiId: ID.erminio, maeId: ID.guilhermina }), P(ID.antonio, "Antonio", { numeroLinhagem: 2 }),
  P(ID.adelia, "Adelia", { linhaReta: true, numeroLinhagem: 3, paiId: ID.antonio, maeId: ID.carlota }), P(ID.albertoLuis, "Alberto Luis", { numeroLinhagem: 3 }),
  P(ID.silvia, "Silvia Helena", { linhaReta: true, numeroLinhagem: 8, paiId: ID.antonio, maeId: ID.carlota }), P(ID.joseRoberto, "José Roberto Mantoan", { numeroLinhagem: 8 }),
  P(ID.monica, "Mônica", { linhaReta: true, numeroLinhagem: 4, paiId: ID.albertoLuis, maeId: ID.adelia, requerente: "maior" }),
  P(ID.albertoJr, "Alberto Júnior", { linhaReta: true, numeroLinhagem: 5, paiId: ID.albertoLuis, maeId: ID.adelia, requerente: "maior" }),
  P(ID.andre, "André", { linhaReta: true, numeroLinhagem: 7, paiId: ID.albertoLuis, maeId: ID.adelia, requerente: "maior" }),
  P(ID.renata, "Renata", { numeroLinhagem: 5 }),
  P(ID.mariaCarolina, "Maria Carolina", { linhaReta: true, numeroLinhagem: 6, paiId: ID.albertoJr, maeId: ID.renata, requerente: "maior" }),
  P(ID.joseJr, "José Roberto Junior", { linhaReta: true, numeroLinhagem: 9, paiId: ID.joseRoberto, maeId: ID.silvia, requerente: "maior" }),
  P(ID.alessandra, "Alessandra", { linhaReta: true, numeroLinhagem: 10, paiId: ID.joseRoberto, maeId: ID.silvia, requerente: "maior" }),
]
const unioes = [
  { id: 1, pessoa1Id: ID.erminio, pessoa2Id: ID.guilhermina }, { id: 2, pessoa1Id: ID.antonio, pessoa2Id: ID.carlota },
  { id: 3, pessoa1Id: ID.albertoLuis, pessoa2Id: ID.adelia }, { id: 4, pessoa1Id: ID.joseRoberto, pessoa2Id: ID.silvia }, { id: 5, pessoa1Id: ID.albertoJr, pessoa2Id: ID.renata },
]

console.log("A geração de verdade")
const g = calcularGeracoes(pessoas, unioes)
const G = (id: number) => g.get(id)
ok("G1: Erminio e Guilhermina (o ancestral de origem e o parceiro)", G(ID.erminio) === 1 && G(ID.guilhermina) === 1)
ok("G2: Carlota e Antonio (cônjuge na geração do parceiro)", G(ID.carlota) === 2 && G(ID.antonio) === 2)
ok("G3: Adelia, Alberto Luis, Silvia Helena e José Roberto Mantoan — irmãs na MESMA geração", [ID.adelia, ID.albertoLuis, ID.silvia, ID.joseRoberto].every((i) => G(i) === 3))
ok("G4: Mônica, Alberto Júnior, Renata, André, José Roberto Junior e Alessandra", [ID.monica, ID.albertoJr, ID.renata, ID.andre, ID.joseJr, ID.alessandra].every((i) => G(i) === 4))
ok("G5: Maria Carolina", G(ID.mariaCarolina) === 5)
ok("o numeroLinhagem do cadastro DISCORDA (irmãos com números diferentes) — o G não é ele", pessoas.find((p) => p.id === ID.monica)!.numeroLinhagem !== pessoas.find((p) => p.id === ID.andre)!.numeroLinhagem && G(ID.monica) === G(ID.andre))

console.log("\nA linha reta com dois ramos de requerentes")
const roster = montarPessoasDoProcesso(pessoas, unioes)
const R = (id: number) => roster.find((p) => p.pessoaId === id)!
ok("Silvia Helena (ancestral de José Roberto Junior e Alessandra) NÃO fica pendente: linha principal", R(ID.silvia).classificacao === "LINHA_PRINCIPAL" && R(ID.silvia).pendencia == null, R(ID.silvia).classificacao)
ok("ninguém da linha fica em «Pendente de classificação»", roster.filter((p) => p.linhaReta).every((p) => p.classificacao === "LINHA_PRINCIPAL"))
ok("a linha de Silvia Helena é a de José Roberto Junior e Alessandra (não a da Maria Carolina)", R(ID.silvia).linhaDe.join() === "José Roberto Junior,Alessandra" || (R(ID.silvia).linhaDe.length === 2 && R(ID.silvia).linhaDe.includes("Alessandra") && R(ID.silvia).linhaDe.includes("José Roberto Junior") && !R(ID.silvia).linhaDe.includes("Maria Carolina")), R(ID.silvia).linhaDe.join())
ok("Carlota e Erminio são ancestrais de TODOS os requerentes", [ID.carlota, ID.erminio].every((i) => ["Mônica", "Alberto Júnior", "André", "Maria Carolina", "José Roberto Junior", "Alessandra"].every((n) => R(i).linhaDe.includes(n))))
ok("Adelia está na linha de Mônica, Alberto Júnior, André e Maria Carolina, e não na de José Roberto Junior", R(ID.adelia).linhaDe.includes("Maria Carolina") && !R(ID.adelia).linhaDe.includes("José Roberto Junior"))
ok("requerentes de ramos diferentes: o parentesco diz em relação a QUEM (posicaoEm)", R(ID.silvia).posicaoEm != null && roster.filter((p) => !p.requerente && p.posicao !== "—").every((p) => p.posicaoEm != null))
ok("o G da lista é o calculado", roster.every((p) => p.geracaoNaArvore === (G(p.pessoaId) ?? null)))
ok("pessoa marcada na linha reta que NÃO chega a nenhum requerente continua em pendência (a regra não afrouxou)", (() => {
  const solta = [...pessoas, P(99, "Solta", { linhaReta: true, numeroLinhagem: 11 })]
  const r = montarPessoasDoProcesso(solta, unioes).find((p) => p.pessoaId === 99)!
  return r.classificacao === "PENDENTE_CLASSIFICACAO" && /nenhum requerente/.test(r.pendencia ?? "")
})())

console.log("\nUm só ramo: nada muda")
{
  // Dois requerentes na MESMA cadeia (Alberto Júnior e a filha Maria Carolina): um ramo só.
  const um = pessoas.map((p) => ({ ...p, requerente: p.id === ID.albertoJr || p.id === ID.mariaCarolina ? "maior" : "nao" }))
  const r = montarPessoasDoProcesso(um, unioes)
  ok("sem ramos diferentes, a posição é em relação ao requerente (sem «de fulano»)", r.every((p) => p.posicaoEm == null))
}

console.log("\nGeração sem marcação de linha reta: os ancestrais mais altos do requerente")
{
  const semMarca = pessoas.map((p) => ({ ...p, linhaReta: false }))
  const gg = calcularGeracoes(semMarca, unioes)
  ok("a origem é o ancestral mais alto do requerente", gg.get(ID.erminio) === 1 && gg.get(ID.mariaCarolina) === 5)
}

console.log(`\n${passou} ok, ${falhou} falha(s)`)
if (falhou) { console.log(falhas.join("\n")); process.exit(1) }
