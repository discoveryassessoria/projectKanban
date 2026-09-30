// scripts/arvore-fonte-da-verdade-c-pai-mae.test.ts
// ============================================================================
// CAMINHO (c) — PAI / MÃE (FILIAÇÃO). "A árvore genealógica é a única fonte de verdade
// documental" (CLAUDE.md §37). Filiação (paiId/maeId) não entra nas condições das
// Regras Documentais de hoje — o que ela muda é o Nº Linhagem e a posição na
// linhagem —, então aqui a prova é de DERIVAÇÃO E ATOMICIDADE:
//   IDA     ligar/desligar pai e mãe → Nº Linhagem e necessidades reavaliados na MESMA transação (idempotente: nada duplica);
//   VOLTA   remover o pai (HARD) zera a filiação do filho e reavalia tudo na mesma transação;
//   ATOMIC  falha na propagação → a filiação NÃO fica gravada, resposta de erro;
//   REGISTRAL o motor registral (aplicar/reverter proposta) propaga na MESMA transação em que escreve Pessoa.
//
//   node scripts/ci/gate-build.mjs --suite todas --so arvore-fonte-da-verdade-c-pai-mae
// Roda contra o banco de TESTE (rotas reais, token de administrador).
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { criarPalco } from "./_fixture-arvore-fonte"

const MARCA = "ARVC"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function main() {
  exigirBancoDeTeste("arvore-fonte-da-verdade-c-pai-mae.test.ts")
  const P = criarPalco(MARCA)
  await P.montar()
  console.log("ÁRVORE = FONTE DA VERDADE — (c) PAI / MÃE (FILIAÇÃO)\n")

  const { calcularNumerosLinhagem } = await import("../src/services/genealogia/numero-linhagem")
  const c = await P.novoCenario("filia", { avo: true })
  const numerosEsperados = async () => {
    const pessoas = await prisma.pessoa.findMany({ where: { arvoreId: c.arvoreId, removidaEm: null }, select: { id: true, paiId: true, maeId: true, data_nasc: true, linhaReta: true, numeroLinhagem: true } })
    const unioes = await prisma.uniao.findMany({ where: { OR: [{ pessoa1Id: { in: pessoas.map((p) => p.id) } }, { pessoa2Id: { in: pessoas.map((p) => p.id) } }] }, select: { pessoa1Id: true, pessoa2Id: true } })
    const calc = calcularNumerosLinhagem(pessoas, unioes)
    return { pessoas, batem: pessoas.every((p) => (calc.get(p.id) ?? null) === p.numeroLinhagem) }
  }
  const snapshotNecs = async () => JSON.stringify((await P.foto(c.processoId)).necs.map((n) => [n.id, n.status, n.cod, n.pessoaId]))

  secao("IDA — a primeira edição propaga: Nº Linhagem nasce junto, na mesma transação")
  const r0 = await P.putPessoa(c.titularId, { documentacao: true, paiId: c.avoId })
  ok("PUT responde 200", r0.status === 200, String(r0.status))
  let n = await numerosEsperados()
  ok("Nº Linhagem persistido = cálculo oficial da árvore (derivado, nunca digitado)", n.batem, JSON.stringify(n.pessoas.map((p) => [p.id, p.numeroLinhagem])))
  const base = await snapshotNecs()
  ok("a filiação ligada não criou nem removeu necessidade alheia", (await P.foto(c.processoId)).necs.length >= 2)

  secao("VOLTA — desligar o pai e religar: derivados sempre em dia e IDEMPOTENTES")
  await P.putPessoa(c.titularId, { paiId: null })
  ok("sem pai, Nº Linhagem continua = cálculo oficial", (await numerosEsperados()).batem)
  ok("o titular ficou sem pai", (await prisma.pessoa.findUniqueOrThrow({ where: { id: c.titularId }, select: { paiId: true } })).paiId === null)
  await P.putPessoa(c.titularId, { paiId: c.avoId })
  ok("com pai de novo, Nº Linhagem = cálculo oficial", (await numerosEsperados()).batem)
  ok("IDEMPOTÊNCIA: religar devolve exatamente o mesmo conjunto de necessidades (ids e estados), sem duplicar", (await snapshotNecs()) === base)
  await P.putPessoa(c.titularId, { maeId: c.avoId })
  await P.putPessoa(c.titularId, { maeId: null })
  ok("mãe ligada e desligada: derivados em dia e necessidades inalteradas", (await numerosEsperados()).batem && (await snapshotNecs()) === base)

  secao("ATOMICIDADE — a filiação só existe se a propagação também existir")
  // datas que fazem o Nº Linhagem MUDAR ao desligar o pai (o mais velho vira o nº 1)
  await prisma.pessoa.update({ where: { id: c.titularId }, data: { data_nasc: new Date("1900-01-01") } })
  await prisma.pessoa.update({ where: { id: c.avoId! }, data: { data_nasc: new Date("1950-01-01") } })
  await P.putPessoa(c.titularId, { paiId: c.avoId })
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION "fn_${MARCA}_bloqueia"() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'falha injetada na propagação'; END; $$ LANGUAGE plpgsql`)
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "trg_${MARCA}_bloqueia" ON "Pessoa"`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "trg_${MARCA}_bloqueia" BEFORE UPDATE OF "numeroLinhagem" ON "Pessoa" FOR EACH ROW WHEN (NEW."arvoreId" = ${c.arvoreId}) EXECUTE FUNCTION "fn_${MARCA}_bloqueia"()`)
  const antesRoll = await prisma.pessoa.findMany({ where: { arvoreId: c.arvoreId }, select: { id: true, paiId: true, numeroLinhagem: true }, orderBy: { id: "asc" } })
  const rf = await P.putPessoa(c.titularId, { paiId: null })
  ok("a resposta é ERRO (500), não 200 com falha engolida", rf.status === 500, String(rf.status))
  const depoisRoll = await prisma.pessoa.findMany({ where: { arvoreId: c.arvoreId }, select: { id: true, paiId: true, numeroLinhagem: true }, orderBy: { id: "asc" } })
  ok("ROLLBACK: a filiação NÃO mudou e o Nº Linhagem ficou como estava", JSON.stringify(antesRoll) === JSON.stringify(depoisRoll), JSON.stringify(depoisRoll))
  await prisma.$executeRawUnsafe(`DROP TRIGGER "trg_${MARCA}_bloqueia" ON "Pessoa"`)
  const rok = await P.putPessoa(c.titularId, { paiId: null })
  ok("sem a falha, o mesmo pedido passa e converge", rok.status === 200 && (await numerosEsperados()).batem, String(rok.status))

  secao("VOLTA — remover o pai (HARD) zera a filiação do filho e reavalia na mesma transação")
  await P.putPessoa(c.titularId, { paiId: c.avoId })
  const avoNec = (await P.foto(c.processoId)).necDe("NAS", { pessoaId: c.avoId! })[0]
  ok("pré: o avô tem certidão de nascimento", !!avoNec)
  const rd = await P.deletePessoa(c.avoId!, "HARD")
  ok("DELETE do pai responde 200", rd.status === 200, String(rd.status))
  ok("o filho ficou sem pai (paiId nulo, sem FK pendurada)", (await prisma.pessoa.findUniqueOrThrow({ where: { id: c.titularId }, select: { paiId: true } })).paiId === null)
  ok("tudo que derivou do pai saiu (necessidade, documento, passo, tarefa)", (await prisma.necessidadeDocumental.count({ where: { id: avoNec.id } })) === 0)
  ok("Nº Linhagem do que sobrou = cálculo oficial", (await numerosEsperados()).batem)

  secao("REGISTRAL — o motor registral propaga na MESMA transação em que escreve a Pessoa")
  const { readFileSync } = await import("fs")
  const aplicar = readFileSync("src/services/registral/aplicar.ts", "utf8")
  const decisoes = readFileSync("src/services/registral/decisoes.ts", "utf8")
  const dentroDaTx = (src: string) => /prisma\.\$transaction\(async \(tx\) => \{[\s\S]*propagarNaTransacao\(tx,[\s\S]*OPCOES_TX_ARVORE\)/.test(src)
  ok("aplicarProposta chama propagarNaTransacao DENTRO da transação que escreve Pessoa/paiId/maeId", dentroDaTx(aplicar))
  ok("reverter proposta também", dentroDaTx(decisoes))
  ok("e os efeitos que não aceitam tx rodam depois do commit (erro sobe)", /efeitosPosCommitDaArvore\(/.test(aplicar) && /efeitosPosCommitDaArvore\(/.test(decisoes))

  await P.limpar()
  console.log(`\n${falhou === 0 ? "✅" : "❌"} (c) PAI / MÃE (FILIAÇÃO) — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
