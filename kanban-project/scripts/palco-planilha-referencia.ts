// scripts/palco-planilha-referencia.ts
// ============================================================================
// PALCO DE COMPARAÇÃO VISUAL — monta, NO BANCO DE TESTE, uma família com a
// mesma FORMA da pasta documental de referência: 4 gerações em linha reta, dois
// cônjuges fora da linhagem, três tipos de certidão e quatro colunas
// econômicas. Sem isso não há o que comparar: produção tem uma pessoa só.
//
// Os nomes são fictícios e o dinheiro é o da Tabela de Preços do próprio palco.
// Nada aqui vira dado de produção — o `exigirBancoDeTeste()` recusa a rodar
// contra qualquer outro alvo.
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" \
//   npx tsx scripts/palco-planilha-referencia.ts
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { adicionarColuna, listarColunasConfiguradas, removerColuna } from "@/lib/financeiro/leitura/planilha-colunas"

const MARCA = "GM"
const FASE = "gm_fase"

/** Uma pessoa da linhagem: nome, ano de nascimento, cônjuge, cidade. */
interface Perfil {
  nome: string
  nasc: string
  local: string
  casamento?: { data: string; local: string; conjuge: string }
  obito?: { data: string; local: string }
}

const LINHAGEM: Perfil[] = [
  { nome: "Francisco Lazaro Perez", nasc: "1868-07-14", local: "La Iruela, Jaén, ESPANHA",
    casamento: { data: "1899-04-02", local: "Jaú - SP", conjuge: "CASSIANA GUSMÃO ASNOL" },
    obito: { data: "1941-01-26", local: "Poloni - SP" } },
  { nome: "Francisco Lazaro Gusmão", nasc: "1917-03-01", local: "Jaú - SP",
    casamento: { data: "1940-10-05", local: "Polini - SP", conjuge: "MARIA JOSE CASTELANI" },
    obito: { data: "1986-07-25", local: "Campinas - Barão Geraldo - SP" } },
  { nome: "Moacir Gusmão Castelane", nasc: "1946-07-01", local: "Monções - SP",
    casamento: { data: "1975-03-01", local: "Santo Amaro - 29 - SP", conjuge: "LUCINDA SCHORR" },
    obito: { data: "2023-04-26", local: "Campinas 1 - SP" } },
  { nome: "Ronie Gusmão Castelane", nasc: "1978-06-18", local: "Santo Amaro - 29 SP",
    casamento: { data: "1999-11-13", local: "Campinas 1 - SP", conjuge: "ROSANA APARECIDA GON ROCHA" } },
]

const CONJUGES: Perfil[] = [
  { nome: "Lucinda Schorr", nasc: "1948-11-04", local: "Porto União - SC",
    casamento: { data: "1975-03-01", local: "Santo Amaro - 29 - SP", conjuge: "MOACIR GUSMÃO CASTELANE" } },
  { nome: "Rosana Aparecida Gon Rocha", nasc: "1973-01-24", local: "Cerqueira César - SP",
    casamento: { data: "1999-11-13", local: "Campinas 1 - SP", conjuge: "RONIE GUSMÃO CASTELANE" } },
]

/** As quatro colunas econômicas da referência, com os preços dela. */
const SERVICOS: Array<[string, number]> = [
  ["Certidão Inteiro Teor", 154.55],
  ["Apostilamento certidão", 151.05],
  ["Tradução juramentada", 185.45],
  ["Apostilamento Tradução", 151.05],
]

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  for (const p of procs) {
    await prisma.documento.deleteMany({ where: { pessoa: { arvoreId: p.arvoreId ?? -1 } } })
    await prisma.processoRequerente.deleteMany({ where: { processoId: p.id } })
  }
  const arvores = await prisma.arvore.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  for (const a of arvores) {
    await prisma.uniao.deleteMany({ where: { pessoa1: { arvoreId: a.id } } })
    await prisma.pessoa.updateMany({ where: { arvoreId: a.id }, data: { paiId: null, maeId: null } })
    await prisma.pessoa.deleteMany({ where: { arvoreId: a.id } })
  }
  await prisma.processo.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.requerente.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.matrizDocumental.deleteMany({ where: { documentTypeCode: { startsWith: MARCA } } })
  await prisma.phaseEconomicRule.deleteMany({ where: { componentKey: { startsWith: MARCA } } })
  await prisma.tabelaValor.deleteMany({ where: { name: { startsWith: MARCA } } })
  for (const c of await listarColunasConfiguradas()) await removerColuna(c.id)
  await prisma.produtoFinanceiro.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.tipoDocumentoCadastro.deleteMany({ where: { name: { startsWith: MARCA } } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { code: { startsWith: MARCA } } })
}

async function main() {
  exigirBancoDeTeste("monta a família de comparação visual da Planilha Documental")
  await limpar()
  // O palco divide o banco com os testes de integração, e a configuração de
  // colunas é GLOBAL. Deixá-lo montado faria o teste de projeção enxergar as
  // colunas e os tipos daqui como se fossem do sistema. Depois de capturar,
  // derrube-o:  npx tsx scripts/palco-planilha-referencia.ts --limpar
  if (process.argv.includes("--limpar")) {
    console.log("palco derrubado.")
    return
  }

  const tipo = await prisma.tipoProcessoNacionalidade.create({
    data: {
      code: MARCA, name: `${MARCA} espanhola`, countryKey: "espanha", countryLabel: "Espanha",
      nationalityKey: "espanhola", nationalityLabel: "Espanhola",
      modalityKey: "descendencia", modalityLabel: "Descendência",
    },
    select: { id: true },
  })

  // Três tipos documentais participando da planilha — as três linhas por pessoa.
  const tipos: Array<{ id: number; code: string }> = []
  for (const [i, nome] of ["Nascimento", "Casamento", "Óbito"].entries()) {
    const t = await prisma.tipoDocumentoCadastro.create({
      data: { code: `${MARCA}-T${i}`, name: `${MARCA} ${nome}`, participaPlanilha: true, ativo: true },
      select: { id: true, code: true },
    })
    tipos.push({ id: t.id, code: t.code! })
    await prisma.matrizDocumental.create({
      data: {
        tipoProcessoId: tipo.id, phaseKey: FASE, documentTypeCode: t.code!,
        status: "PUBLICADA", createsCost: true, createsTask: false, arquivado: false,
      },
    })
  }

  // Quatro colunas econômicas, cada uma com preço de custo na Tabela de Preços.
  for (const [i, [nome, valor]] of SERVICOS.entries()) {
    const { id: cfgId } = await prisma.produtoFinanceiro.create({
      data: { codigo: `${MARCA}-S${i}`, nome: `${MARCA} ${nome}`, moedaPadrao: "BRL", possuiCusto: true },
      select: { id: true },
    })
    await prisma.tabelaValor.create({
      data: {
        name: `${MARCA} preço ${i}`, configuracaoFinanceiraItemId: cfgId, natureza: "CUSTO",
        moeda: "BRL", modoCalculo: "fixed", valor, prioridade: 10,
      },
    })
    await prisma.phaseEconomicRule.create({
      data: {
        tipoProcessoId: tipo.id, phaseKey: FASE, componentKey: `${MARCA}-C${i}`,
        componentName: `${MARCA} ${nome}`, custoConfigId: cfgId, ativo: true, ordem: i,
      },
    })
    await adicionarColuna({ origem: "SERVICO", itemId: cfgId })
  }

  const arvore = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const processo = await prisma.processo.create({
    data: { nome: `${MARCA} Juarez`, pais: "espanha", arvoreId: arvore.id, faseAtualKey: FASE, tipoProcessoMotorId: tipo.id },
    select: { id: true },
  })

  /** Cria a pessoa e as três certidões — a de óbito só quando houve óbito. */
  const criar = async (p: Perfil, paiId: number | null, maeId: number | null, requerente: boolean, linhaReta: boolean) => {
    const partes = p.nome.split(" ")
    const pessoa = await prisma.pessoa.create({
      data: {
        arvoreId: arvore.id, nome: partes[0], sobrenome: partes.slice(1).join(" "),
        paiId, maeId, requerente: requerente ? "sim" : null, linhaReta,
      },
      select: { id: true },
    })
    const eventos: Array<[number, string, string, string | null]> = [
      [0, p.nasc, p.local, null],
      ...(p.casamento ? [[1, p.casamento.data, p.casamento.local, p.casamento.conjuge] as [number, string, string, string]] : []),
      ...(p.obito ? [[2, p.obito.data, p.obito.local, null] as [number, string, string, null]] : []),
    ]
    for (const [i, data, local, conjuge] of eventos) {
      await prisma.documento.create({
        data: {
          pessoaId: pessoa.id, documentTypeId: tipos[i].id, descricao: `${MARCA} ${p.nome} ${i}`,
          data_registro: new Date(`${data}T00:00:00Z`),
          cidade_registro: local, estado_registro: null,
          cartorio: local, livro: `A ${100 + i}`, folha: `${40 + i}`, termo: `${1000 + i}`,
          conjuge_registrado: conjuge,
        },
      })
    }
    return pessoa.id
  }

  const conjugeId = new Map<string, number>()
  for (const c of CONJUGES) conjugeId.set(c.nome, await criar(c, null, null, false, false))

  let paiId: number | null = null
  for (const [i, perfil] of LINHAGEM.entries()) {
    // A mãe é a cônjuge do pai, quando ela existe como pessoa da árvore.
    const maeNome = i === 0 ? null : LINHAGEM[i - 1].casamento?.conjuge ?? null
    const mae = maeNome ? [...conjugeId.entries()].find(([n]) => n.toUpperCase() === maeNome)?.[1] ?? null : null
    paiId = await criar(perfil, paiId, mae, i === LINHAGEM.length - 1, true)
  }

  const req = await prisma.requerente.create({ data: { nome: `${MARCA} Ronie` }, select: { id: true } })
  await prisma.processoRequerente.create({ data: { processoId: processo.id, requerenteId: req.id } })

  // O capturador precisa de um admin para autenticar. Ele é do palco, não do
  // sistema: nasce aqui e morre com o banco de teste.
  await prisma.usuario.upsert({
    where: { email: "gm@teste.local" },
    update: {},
    create: { nome: `${MARCA} Admin`, email: "gm@teste.local", senha: "x", tipo: "admin" },
  })

  console.log(`PROCESSO=${processo.id}`)
}

main().catch((e) => { console.error("falhou:", e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
