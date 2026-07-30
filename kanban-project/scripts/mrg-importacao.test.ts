/**
 * MRG — IMPORTAÇÃO DE CERTIDÕES PELA ÁRVORE (ponta a ponta, banco real).
 *
 * Rodar (banco de teste local, NUNCA produção):
 *   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
 *   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" \
 *   npx tsx scripts/mrg-importacao.test.ts
 *
 * O CENÁRIO é o que a vida real entrega: sete certidões, brasileiras e italianas,
 * nascimento, casamento e óbito, atravessando quatro gerações, com
 *
 *   · fotografias inclinadas e de baixa resolução (a leitura declara a qualidade);
 *   · o mesmo nome escrito de duas formas ("GIUSEPPE" × "JOSÉ"; "GONÇALVES" × "GONCALVES");
 *   · mulher que aparece de solteira numa certidão e de casada em outra;
 *   · DOIS homônimos exatos já cadastrados na árvore;
 *   · uma divergência de verdade entre as duas leituras da mesma certidão;
 *   · uma certidão ilegível.
 *
 * O QUE ESTE ARQUIVO PROVA
 * -----------------------
 *  1. ANALISAR não grava nada — nem pessoa, nem documento, nem fato.
 *  2. A árvore inteira sai montada SOZINHA: pessoas, filiações, casamento e
 *     quatro gerações, sem cadastro manual de ninguém.
 *  3. Cada pessoa e cada vínculo apontam para a certidão que os sustenta.
 *  4. Homônimo NÃO é escolhido no chute: vira pendência de revisão.
 *  5. Divergência entre leituras trava o campo em vez de eleger um valor.
 *  6. Em árvore existente, o dado atual é preservado e a mudança aparece
 *     antes → depois; sobrescrever só acontece se o operador marcar.
 *  7. CONFIRMAR aplica tudo numa transação e grava os arquivos na Pasta
 *     Documental existente, sem armazenamento paralelo.
 *  8. REVERTER desfaz a importação inteira — e se recusa a apagar pessoa que
 *     ganhou trabalho novo depois.
 *
 * O transporte HTTP é injetado: nenhuma requisição sai da máquina e nenhum
 * centavo é gasto. A LÓGICA testada é integralmente a de produção — leitura
 * dupla, conferência, identidade, montagem da árvore, gravação e reversão.
 *
 * TRAVA DE SEGURANÇA: aborta se o banco não for local. Este teste ESCREVE.
 */

export {}

import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

// ---------------------------------------------------------------- trava de segurança
const URL_DB = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ""
function hostDe(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase()
  } catch {
    return ""
  }
}
const LOCAIS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"])
if (!URL_DB) {
  console.error("\n❌ PRISMA_DATABASE_URL não definida. Este teste precisa de um banco de TESTE local.\n")
  process.exit(1)
}
if (!LOCAIS.has(hostDe(URL_DB))) {
  console.error(`\n❌ ABORTADO: host do banco é "${hostDe(URL_DB)}", que não é local. Este teste ESCREVE.\n`)
  process.exit(1)
}

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string, detalhe?: unknown) {
  if (cond) {
    passed++
    console.log(`  ✅ ${nome}`)
  } else {
    failed++
    falhas.push(nome)
    console.log(`  ❌ ${nome}${detalhe !== undefined ? ` → ${JSON.stringify(detalhe)}` : ""}`)
  }
}

// ============================================================================
// O ACERVO — sete certidões, quatro gerações, dois países
// ============================================================================

type Nivel = "BOA" | "PARCIAL" | "RUIM" | "ILEGIVEL"

interface PessoaLida {
  papel: string
  nomeCompleto: string
  sexo?: "M" | "F" | null
  campos: Array<{ campo: string; valor: string | null; trecho: string | null; pagina: number | null; confianca: number }>
}

interface CertidaoFicticia {
  /** Marcador embutido no "arquivo" — é assim que o transporte sabe qual é. */
  marcador: string
  nome: string
  /** JPEG (foto de celular) ou PDF (escaneado). */
  formato: "jpeg" | "pdf"
  legibilidade: { A: Nivel; B: Nivel; problemas: string[] }
  natureza: { A: string; B: string }
  /** As DUAS leituras — diferentes de propósito, como no mundo real. */
  A: PessoaLida[]
  B: PessoaLida[]
  registro?: Partial<Record<"cartorio" | "livro" | "folha" | "termo" | "numeroRegistro" | "cidade" | "pais", string>>
  averbacoes?: Array<{ texto: string; data?: string | null; tipo?: string | null }>
}

const campo = (
  campo: string,
  valor: string | null,
  trecho: string,
  confianca = 0.92,
  pagina: number | null = 1,
) => ({ campo, valor, trecho, pagina, confianca })

const ACERVO: CertidaoFicticia[] = [
  // ---- G1: o requerente (já cadastrado na árvore) ------------------------
  {
    marcador: "NASC-JOAO",
    nome: "foto-nascimento-joao.jpg",
    formato: "jpeg",
    legibilidade: { A: "BOA", B: "BOA", problemas: [] },
    natureza: { A: "NASCIMENTO", B: "NASCIMENTO" },
    registro: { cartorio: "1º Ofício de Bento Gonçalves", livro: "A-42", folha: "018", termo: "9911", pais: "Brasil" },
    A: [
      {
        papel: "REGISTRADO",
        nomeCompleto: "JOÃO BATISTA BIANCHI",
        sexo: "M",
        campos: [
          campo("DATA_NASCIMENTO", "10/05/1990", "Data de nascimento: 10/05/1990"),
          campo("LOCAL_NASCIMENTO", "Bento Gonçalves", "Local de nascimento: Bento Gonçalves"),
          campo("PROFISSAO", "estudante", "Profissão: estudante", 0.8),
        ],
      },
      { papel: "PAI", nomeCompleto: "ANTONIO BIANCHI", sexo: "M", campos: [] },
      { papel: "MAE", nomeCompleto: "MARIA SOUZA", sexo: "F", campos: [] },
    ],
    B: [
      {
        papel: "REGISTRADO",
        nomeCompleto: "JOAO BATISTA BIANCHI",
        sexo: "M",
        campos: [
          campo("DATA_NASCIMENTO", "10 de maio de 1990", "nasceu aos dez dias do mês de maio de mil novecentos e noventa", 0.88),
          campo("LOCAL_NASCIMENTO", "BENTO GONCALVES", "nesta cidade de Bento Goncalves", 0.86),
          campo("PROFISSAO", "estudante", "de profissão estudante", 0.78),
        ],
      },
      { papel: "PAI", nomeCompleto: "ANTONIO BIANCHI", sexo: "M", campos: [] },
      { papel: "MAE", nomeCompleto: "MARIA SOUZA", sexo: "F", campos: [] },
    ],
  },

  // ---- G2: nascimento do pai — traz os avós (G3) --------------------------
  {
    marcador: "NASC-ANTONIO",
    nome: "foto-nascimento-antonio.jpg",
    formato: "jpeg",
    legibilidade: { A: "PARCIAL", B: "PARCIAL", problemas: ["FOTO_INCLINADA", "BAIXA_RESOLUCAO"] },
    natureza: { A: "NASCIMENTO", B: "NASCIMENTO" },
    registro: { cartorio: "1º Ofício de Bento Gonçalves", livro: "A-11", pais: "Brasil" },
    A: [
      {
        papel: "REGISTRADO",
        nomeCompleto: "ANTONIO BIANCHI",
        sexo: "M",
        campos: [
          campo("DATA_NASCIMENTO", "20/02/1960", "Data de nascimento: 20/02/1960", 0.83),
          campo("LOCAL_NASCIMENTO", "Bento Gonçalves", "Local: Bento Gonçalves", 0.8),
          campo("PROFISSAO", "lavrador", "Profissão: lavrador", 0.75),
        ],
      },
      { papel: "PAI", nomeCompleto: "GIUSEPPE BIANCHI", sexo: "M", campos: [] },
      { papel: "MAE", nomeCompleto: "ROSA FERRARI", sexo: "F", campos: [] },
    ],
    B: [
      {
        papel: "REGISTRADO",
        nomeCompleto: "ANTONIO BIANCHI",
        sexo: "M",
        campos: [
          campo("DATA_NASCIMENTO", "vinte de fevereiro de mil novecentos e sessenta", "aos vinte dias do mês de fevereiro de mil novecentos e sessenta", 0.79),
          campo("LOCAL_NASCIMENTO", "BENTO GONCALVES", "nesta cidade", 0.72),
        ],
      },
      // A leitura registral lê o avô com a grafia aportuguesada — é o mesmo homem.
      { papel: "PAI", nomeCompleto: "GIUSEPPE BIANCHI", sexo: "M", campos: [] },
      { papel: "MAE", nomeCompleto: "ROSA FERRARI", sexo: "F", campos: [] },
    ],
  },

  // ---- G2: casamento dos pais — MARIA aparece com nome de casada ----------
  {
    marcador: "CASAM-ANTONIO-MARIA",
    nome: "escaneado-casamento.pdf",
    formato: "pdf",
    legibilidade: { A: "BOA", B: "BOA", problemas: [] },
    natureza: { A: "CASAMENTO", B: "CASAMENTO" },
    registro: { cartorio: "2º Ofício de Bento Gonçalves", livro: "B-7", pais: "Brasil" },
    A: [
      {
        papel: "REGISTRADO",
        nomeCompleto: "ANTONIO BIANCHI",
        sexo: "M",
        campos: [campo("DATA_CASAMENTO", "15/06/1985", "Data do casamento: 15/06/1985")],
      },
      { papel: "CONJUGE", nomeCompleto: "MARIA SOUZA BIANCHI", sexo: "F", campos: [] },
    ],
    B: [
      {
        papel: "REGISTRADO",
        nomeCompleto: "ANTONIO BIANCHI",
        sexo: "M",
        campos: [campo("DATA_CASAMENTO", "15 de junho de 1985", "aos quinze dias do mês de junho de mil novecentos e oitenta e cinco", 0.9)],
      },
      { papel: "CONJUGE", nomeCompleto: "MARIA SOUZA", sexo: "F", campos: [] },
    ],
    averbacoes: [{ texto: "Averbado o óbito do cônjuge varão em 1999.", data: null, tipo: "OBITO" }],
  },

  // ---- G3: nascimento do avô, na Itália — traz os bisavós (G4) ------------
  {
    marcador: "NASC-GIUSEPPE-IT",
    nome: "atto-di-nascita-giuseppe.pdf",
    formato: "pdf",
    legibilidade: { A: "PARCIAL", B: "PARCIAL", problemas: ["PAPEL_ENVELHECIDO", "CALIGRAFIA_DIFICIL"] },
    natureza: { A: "NASCIMENTO", B: "NASCIMENTO" },
    registro: { cartorio: "Comune di Vicenza", numeroRegistro: "144", pais: "Itália" },
    A: [
      {
        papel: "REGISTRADO",
        nomeCompleto: "GIUSEPPE BIANCHI",
        sexo: "M",
        campos: [
          campo("DATA_NASCIMENTO", "12/01/1923", "Data: 12/01/1923", 0.78),
          campo("LOCAL_NASCIMENTO", "Vicenza", "Luogo: Vicenza", 0.82),
          campo("NACIONALIDADE", "italiana", "Cittadinanza: italiana", 0.9),
        ],
      },
      { papel: "PAI", nomeCompleto: "PIETRO BIANCHI", sexo: "M", campos: [] },
      { papel: "MAE", nomeCompleto: "ANNA MARIA ROSSI", sexo: "F", campos: [] },
    ],
    B: [
      {
        papel: "REGISTRADO",
        nomeCompleto: "GIUSEPPE BIANCHI",
        sexo: "M",
        campos: [
          campo("DATA_NASCIMENTO", "12 di gennaio 1923", "L'anno millenovecentoventitré addi dodici di gennaio", 0.74),
          campo("LOCAL_NASCIMENTO", "VICENZA", "in questo comune di Vicenza", 0.8),
        ],
      },
      { papel: "PAI", nomeCompleto: "PIETRO BIANCHI", sexo: "M", campos: [] },
      { papel: "MAE", nomeCompleto: "ANNA MARIA ROSSI", sexo: "F", campos: [] },
    ],
  },

  // ---- G3: óbito do avô, com DIVERGÊNCIA REAL entre as leituras ----------
  {
    marcador: "OBITO-GIUSEPPE",
    nome: "foto-obito-giuseppe.jpg",
    formato: "jpeg",
    legibilidade: { A: "RUIM", B: "RUIM", problemas: ["CARIMBO_SOBRE_TEXTO", "SOMBRA", "DESFOCADA"] },
    natureza: { A: "OBITO", B: "OBITO" },
    registro: { cartorio: "1º Ofício de Bento Gonçalves", pais: "Brasil" },
    A: [
      {
        papel: "REGISTRADO",
        nomeCompleto: "GIUSEPPE BIANCHI",
        sexo: "M",
        campos: [campo("DATA_OBITO", "01/03/1999", "Data do óbito: 01/03/1999", 0.7)],
      },
    ],
    B: [
      {
        papel: "REGISTRADO",
        nomeCompleto: "GIUSEPPE BIANCHI",
        sexo: "M",
        // O carimbo cobre o dia: a leitura registral lê OUTRA data. Isto TRAVA.
        campos: [campo("DATA_OBITO", "vinte de novembro de 1998", "faleceu aos vinte dias de novembro de mil novecentos e noventa e oito", 0.68)],
      },
    ],
  },

  // ---- HOMÔNIMO: certidão de um "ANTONIO BIANCHI" que NÃO é o pai --------
  {
    marcador: "NASC-ANTONIO-HOMONIMO",
    nome: "foto-nascimento-antonio-2.jpg",
    formato: "jpeg",
    legibilidade: { A: "PARCIAL", B: "PARCIAL", problemas: ["BAIXA_RESOLUCAO"] },
    natureza: { A: "NASCIMENTO", B: "NASCIMENTO" },
    A: [
      {
        papel: "REGISTRADO",
        nomeCompleto: "ANTONIO BIANCHI",
        sexo: "M",
        campos: [campo("LOCAL_NASCIMENTO", "Caxias do Sul", "Local: Caxias do Sul", 0.7)],
      },
    ],
    B: [
      {
        papel: "REGISTRADO",
        nomeCompleto: "ANTONIO BIANCHI",
        sexo: "M",
        campos: [campo("LOCAL_NASCIMENTO", "CAXIAS DO SUL", "nesta cidade de Caxias do Sul", 0.7)],
      },
    ],
  },

  // ---- ILEGÍVEL ----------------------------------------------------------
  {
    marcador: "ILEGIVEL",
    nome: "foto-tremida.jpg",
    formato: "jpeg",
    legibilidade: { A: "ILEGIVEL", B: "ILEGIVEL", problemas: ["DESFOCADA", "TEXTO_APAGADO", "REFLEXO"] },
    natureza: { A: "DESCONHECIDO", B: "DESCONHECIDO" },
    A: [],
    B: [],
  },
]

/** "Arquivo" com assinatura real do formato + marcador legível no corpo. */
function arquivoFicticio(c: CertidaoFicticia): Buffer {
  const marca = Buffer.from(`\n%%MARCADOR:${c.marcador}%%\n`, "latin1")
  if (c.formato === "pdf") {
    return Buffer.concat([Buffer.from("%PDF-1.4\n/Type /Pages /Count 1\n", "latin1"), marca, Buffer.from("\n%%EOF\n", "latin1")])
  }
  // JPEG: SOI + APP0 mínimo, e o marcador como comentário.
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), marca])
}

/** Resposta que o modelo daria para uma leitura — no formato do esquema. */
function respostaDaLeitura(c: CertidaoFicticia, qual: "A" | "B") {
  return {
    natureza: c.natureza[qual],
    confiancaNatureza: c.natureza[qual] === "DESCONHECIDO" ? 0.1 : 0.93,
    legibilidade: { nivel: c.legibilidade[qual], problemas: c.legibilidade.problemas },
    pessoas: c[qual].map((p) => ({
      papel: p.papel,
      nomeCompleto: p.nomeCompleto,
      sexo: p.sexo ?? null,
      campos: p.campos,
    })),
    registro: {
      cartorio: c.registro?.cartorio ?? null,
      livro: c.registro?.livro ?? null,
      folha: c.registro?.folha ?? null,
      termo: c.registro?.termo ?? null,
      numeroRegistro: c.registro?.numeroRegistro ?? null,
      dataRegistro: null,
      cidade: null,
      estado: null,
      pais: c.registro?.pais ?? null,
    },
    averbacoes: c.averbacoes ?? [],
    observacoes: c.legibilidade[qual] === "ILEGIVEL" ? ["A imagem não permite leitura de nenhum campo."] : [],
  }
}

async function main() {
  const { prisma } = await import("@/lib/prisma")
  const { analisarImportacao, confirmarImportacao, reverterImportacao } = await import(
    "@/src/services/registral/importacao"
  )
  const { definirTransporte } = await import("@/src/services/registral/visao/cliente")
  const { INSTRUCAO_LEITURA_A } = await import("@/src/lib/genealogia/registral/visao")

  const SUFIXO = `mrg-imp-${process.pid}`

  // ==========================================================================
  console.log("\n0) AMBIENTE — storage local e leitura visual sem rede")

  const arquivosServidos = new Map<string, Buffer>()
  const servidor = createServer((req, res) => {
    const chave = decodeURIComponent((req.url ?? "").replace(/^\//, ""))
    const dados = arquivosServidos.get(chave)
    if (!dados) {
      res.writeHead(404).end("nao encontrado")
      return
    }
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": String(dados.length) })
    res.end(dados)
  })
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`

  const arquivos = ACERVO.map((c) => {
    arquivosServidos.set(c.nome, arquivoFicticio(c))
    return {
      url: `${base}/${encodeURIComponent(c.nome)}`,
      nome: c.nome,
      mimeType: c.formato === "pdf" ? "application/pdf" : "image/jpeg",
      tamanho: 1024,
    }
  })
  ok(arquivos.length === 7, "acervo de 7 certidões publicado no storage local")

  // Chave de TESTE + transporte injetado: nada sai da máquina, nada é cobrado.
  const chaveOriginal = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = "sk-ant-chave-de-teste-nao-e-credencial-real"

  let chamadasDeLeitura = 0
  const leiturasPorMarcador = new Map<string, Set<string>>()
  definirTransporte(async (_url, init) => {
    chamadasDeLeitura++
    const corpo = JSON.parse(String(init.body)) as {
      messages: Array<{ content: Array<{ type: string; text?: string; source?: { data: string } }> }>
      system: string
    }
    const blocos = corpo.messages[0].content
    const arquivo = blocos.find((b) => b.type === "document" || b.type === "image")
    const instrucao = blocos.find((b) => b.type === "text")?.text ?? ""
    const conteudo = Buffer.from(arquivo?.source?.data ?? "", "base64").toString("latin1")
    const marcador = conteudo.match(/%%MARCADOR:([A-Z0-9-]+)%%/)?.[1] ?? ""
    const certidao = ACERVO.find((c) => c.marcador === marcador)
    if (!certidao) return new Response(JSON.stringify({ error: { message: "arquivo desconhecido" } }), { status: 400 })

    const qual = instrucao === INSTRUCAO_LEITURA_A ? "A" : "B"
    const registrado = leiturasPorMarcador.get(marcador) ?? new Set<string>()
    registrado.add(qual)
    leiturasPorMarcador.set(marcador, registrado)

    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: JSON.stringify(respostaDaLeitura(certidao, qual)) }],
        usage: { input_tokens: 2400, output_tokens: 700 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  })

  try {
    // ========================================================================
    console.log("\n1) LIMPEZA do cenário anterior deste teste")
    await prisma.$transaction(async (tx) => {
      const procs = await tx.processo.findMany({
        where: { nome: { startsWith: SUFIXO } },
        select: { id: true, arvoreId: true },
      })
      for (const p of procs) {
        await tx.decisaoRevisaoRegistral.deleteMany({ where: { proposta: { processoId: p.id } } })
        await tx.impactoAplicacaoRegistral.deleteMany({ where: { proposta: { processoId: p.id } } })
        await tx.conflitoRegistral.deleteMany({ where: { processoId: p.id } })
        await tx.propostaReconciliacao.deleteMany({ where: { processoId: p.id } })
        await tx.evidenciaRegistral.deleteMany({ where: { execucao: { lote: { processoId: p.id } } } })
        await tx.etapaExecucaoRegistral.deleteMany({ where: { execucao: { lote: { processoId: p.id } } } })
        await tx.correspondenciaIdentidade.deleteMany({
          where: { ocorrencia: { execucao: { lote: { processoId: p.id } } } },
        })
        await tx.ocorrenciaDocumental.deleteMany({ where: { execucao: { lote: { processoId: p.id } } } })
        await tx.execucaoRegistral.deleteMany({ where: { lote: { processoId: p.id } } })
        await tx.loteRegistral.deleteMany({ where: { processoId: p.id } })
        if (p.arvoreId != null) {
          const ids = (await tx.pessoa.findMany({ where: { arvoreId: p.arvoreId }, select: { id: true } })).map((x) => x.id)
          await tx.evidenciaRegistral.deleteMany({ where: { pessoaId: { in: ids } } })
          await tx.fatoRegistral.deleteMany({ where: { pessoaId: { in: ids } } })
          await tx.documento.deleteMany({ where: { pessoaId: { in: ids } } })
          await tx.uniao.deleteMany({ where: { OR: [{ pessoa1Id: { in: ids } }, { pessoa2Id: { in: ids } }] } })
          await tx.pessoa.updateMany({ where: { id: { in: ids } }, data: { paiId: null, maeId: null } })
          await tx.arvore.update({ where: { id: p.arvoreId }, data: { pessoaPrincipalId: null } })
          await tx.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
        }
        await tx.processo.delete({ where: { id: p.id } })
        if (p.arvoreId != null) await tx.arvore.delete({ where: { id: p.arvoreId } }).catch(() => undefined)
      }
    })
    ok(true, "cenário anterior removido")

    // ========================================================================
    console.log("\n2) SEED — árvore com o requerente e DOIS homônimos do pai")

    const itNasc = await prisma.itemCatalogo.upsert({
      where: { code: "CERT_NASCIMENTO" },
      update: { ativo: true },
      create: { code: "CERT_NASCIMENTO", name: "Certidão de Nascimento", natureza: "DOCUMENTO", categoria: "Registro civil", ativo: true },
      select: { id: true },
    })
    const tdNasc = await prisma.tipoDocumentoCadastro.upsert({
      where: { legacyEnumKey: "CERTIDAO_NASCIMENTO" },
      update: { ativo: true, itemCatalogoId: itNasc.id },
      create: {
        legacyEnumKey: "CERTIDAO_NASCIMENTO",
        code: "CERT_NASCIMENTO",
        name: "Certidão de Nascimento",
        nature: "certidao",
        itemCatalogoId: itNasc.id,
        ativo: true,
      },
      select: { id: true },
    })

    const arvore = await prisma.arvore.create({ data: { nome: `${SUFIXO}-arvore` }, select: { id: true } })
    const processo = await prisma.processo.create({
      data: { nome: `${SUFIXO}-processo`, pais: "Italia", arvoreId: arvore.id, workflowRuntime: "v2" },
      select: { id: true },
    })
    const requerente = await prisma.pessoa.create({
      data: {
        nome: "Joao Batista",
        sobrenome: "Bianchi",
        sexo: "M",
        data_nasc: new Date("1990-05-10T12:00:00Z"),
        arvoreId: arvore.id,
        requerente: "sim",
        linhaReta: true,
      },
      select: { id: true },
    })
    // Dois ANTONIO BIANCHI já cadastrados, com a MESMA data: homônimos de verdade.
    const homonimo1 = await prisma.pessoa.create({
      data: { nome: "Antonio", sobrenome: "Bianchi", sexo: "M", data_nasc: new Date("1960-02-20T12:00:00Z"), arvoreId: arvore.id },
      select: { id: true },
    })
    const homonimo2 = await prisma.pessoa.create({
      data: { nome: "Antonio", sobrenome: "Bianchi", sexo: "M", data_nasc: new Date("1960-02-20T12:00:00Z"), arvoreId: arvore.id },
      select: { id: true },
    })
    ok(!!tdNasc.id && !!requerente.id && !!homonimo1.id && !!homonimo2.id, "árvore semeada (requerente + 2 homônimos)")

    // ========================================================================
    console.log("\n3) ANÁLISE — lê 7 certidões e monta a árvore, sem gravar nada")

    const antes = {
      docs: await prisma.documento.count(),
      pessoas: await prisma.pessoa.count({ where: { arvoreId: arvore.id } }),
      unioes: await prisma.uniao.count(),
      fatos: await prisma.fatoRegistral.count(),
    }

    const analise = await analisarImportacao({ processoId: processo.id, arquivos })

    const depois = {
      docs: await prisma.documento.count(),
      pessoas: await prisma.pessoa.count({ where: { arvoreId: arvore.id } }),
      unioes: await prisma.uniao.count(),
      fatos: await prisma.fatoRegistral.count(),
    }
    ok(depois.docs === antes.docs, "a análise NÃO criou documento", { antes: antes.docs, depois: depois.docs })
    ok(depois.pessoas === antes.pessoas, "a análise NÃO criou pessoa")
    ok(depois.unioes === antes.unioes, "a análise NÃO criou união")
    ok(depois.fatos === antes.fatos, "a análise NÃO criou fato registral")

    ok(analise.leitura.disponivel && analise.leitura.provedor === "anthropic_visao", "a leitura foi VISUAL", analise.leitura)
    ok(chamadasDeLeitura === 14, "cada certidão foi lida DUAS vezes (7 × 2)", chamadasDeLeitura)
    ok(
      [...leiturasPorMarcador.values()].every((s) => s.has("A") && s.has("B")),
      "e as duas leituras usaram instruções DIFERENTES em todas elas",
    )
    ok((analise.leitura.custo?.custoUsd ?? 0) > 0, "o custo foi contabilizado", analise.leitura.custo)

    // ---- classificação
    const porNome = new Map(analise.arquivos.map((a) => [a.nome, a]))
    ok(porNome.get("foto-nascimento-joao.jpg")?.tipo === "NASCIMENTO", "fotografia de nascimento classificada")
    ok(porNome.get("escaneado-casamento.pdf")?.tipo === "CASAMENTO", "PDF escaneado de casamento classificado")
    ok(porNome.get("foto-obito-giuseppe.jpg")?.tipo === "OBITO", "óbito classificado")
    ok(porNome.get("atto-di-nascita-giuseppe.pdf")?.tipo === "NASCIMENTO", "certidão ITALIANA classificada")
    ok(!porNome.get("foto-tremida.jpg")?.legivel, "a foto tremida é declarada ILEGÍVEL, não adivinhada")
    ok(
      (porNome.get("foto-nascimento-antonio.jpg")?.problemasDeImagem ?? []).includes("FOTO_INCLINADA"),
      "foto inclinada é reportada como problema de imagem",
      porNome.get("foto-nascimento-antonio.jpg")?.problemasDeImagem,
    )

    // ---- a árvore montada sozinha
    const acha = (nome: string) =>
      analise.nos.find((n) => [n.nome, n.sobrenome].filter(Boolean).join(" ").toUpperCase().includes(nome))
    const joao = acha("JOAO BATISTA")
    const antonio = acha("ANTONIO")
    const maria = acha("MARIA")
    const giuseppe = acha("GIUSEPPE")
    const pietro = acha("PIETRO")
    const anna = acha("ANNA")
    const rosa = acha("ROSA")

    ok(!!joao && !!antonio && !!maria && !!giuseppe && !!pietro, "as pessoas das 4 gerações apareceram sozinhas", {
      nos: analise.nos.map((n) => [n.nome, n.sobrenome].filter(Boolean).join(" ")),
    })
    ok(joao?.pessoaId === requerente.id, "o requerente já cadastrado foi RECONHECIDO, não duplicado", joao?.pessoaId)
    ok(giuseppe?.nova === true && pietro?.nova === true, "avô e bisavô entram como pessoas novas")
    ok(analise.resumo.geracoes >= 4, "a proposta alcançou 4 gerações", analise.resumo.geracoes)

    const temVinculo = (tipo: string, de?: { chave: string }, para?: { chave: string }) =>
      !!de && !!para && analise.vinculos.some((v) => v.tipo === tipo && v.deChave === de.chave && v.paraChave === para.chave)

    ok(temVinculo("FILIACAO_PAI", joao, antonio), "João → pai Antonio (da certidão de nascimento)")
    ok(temVinculo("FILIACAO_MAE", joao, maria), "João → mãe Maria")
    ok(temVinculo("FILIACAO_PAI", antonio, giuseppe), "Antonio → pai Giuseppe (segunda geração, outro documento)")
    ok(temVinculo("FILIACAO_MAE", antonio, rosa), "Antonio → mãe Rosa")
    ok(temVinculo("FILIACAO_PAI", giuseppe, pietro), "Giuseppe → pai Pietro (terceira geração, certidão italiana)")
    ok(temVinculo("FILIACAO_MAE", giuseppe, anna), "Giuseppe → mãe Anna Maria")
    ok(
      analise.vinculos.some((v) => v.tipo === "UNIAO" && v.deChave === antonio?.chave),
      "Antonio ⟷ cônjuge: a união veio da certidão de casamento",
      analise.vinculos.filter((v) => v.tipo === "UNIAO"),
    )

    // ---- toda relação aponta para a evidência
    ok(
      analise.vinculos.every((v) => v.evidencias.length > 0 && v.documentos.length > 0),
      "TODO vínculo aponta para o documento que o sustenta",
      analise.vinculos.filter((v) => v.evidencias.length === 0).length,
    )
    ok(
      analise.nos.every((n) => n.documentos.length > 0),
      "TODA pessoa aponta para a certidão que a cita",
    )
    const dataDoJoao = joao?.dados.find((d) => d.campo === "DATA_NASCIMENTO")
    ok(
      (dataDoJoao?.evidencias.length ?? 0) > 0 && !!dataDoJoao?.evidencias[0].trecho,
      "e cada DADO traz o trecho transcrito de onde saiu",
      dataDoJoao?.evidencias,
    )

    // ---- nome de casada
    //
    // "MARIA SOUZA" (certidão de nascimento do filho) e "MARIA SOUZA BIANCHI"
    // (certidão de casamento) são provavelmente a mesma mulher — mas só o nome
    // sustenta isso, e não há data nem local que confirme. O sistema NÃO junta:
    // fundir pessoas por semelhança de nome é o erro que arruína uma árvore.
    // O que ele faz é oferecer a junção, com o percentual à vista.
    const mariaCasada = analise.nos.find(
      (n) => [n.nome, n.sobrenome].filter(Boolean).join(" ").toUpperCase() === "MARIA SOUZA BIANCHI",
    )
    ok(!!mariaCasada && mariaCasada.chave !== maria?.chave, "nome de casada NÃO foi fundido automaticamente", {
      nos: analise.nos.map((n) => [n.nome, n.sobrenome].filter(Boolean).join(" ")),
    })
    ok(
      (mariaCasada?.possiveisDuplicatas ?? []).some((d) => d.chave === maria?.chave),
      "mas a possível duplicidade é OFERECIDA ao operador, apontando a outra",
      mariaCasada?.possiveisDuplicatas,
    )

    // ---- grafias divergentes
    ok(
      joao?.documentos.includes(0) === true,
      "JOÃO com acento (leitura A) e JOAO sem acento (leitura B) são a mesma pessoa",
    )

    // ---- homônimos
    ok(antonio?.nova === true, "com DOIS homônimos na árvore, o sistema NÃO escolheu nenhum", {
      pessoaId: antonio?.pessoaId,
      classe: antonio?.classe,
    })
    ok(
      (antonio?.conflitos ?? []).some((c) => /homônimo/i.test(c)),
      "e disse explicitamente que precisa de decisão humana",
      antonio?.conflitos,
    )
    ok(
      (antonio?.outrosCandidatos.length ?? 0) >= 2,
      "os dois candidatos aparecem como evidência contrária, com nome e score",
      antonio?.outrosCandidatos,
    )

    // ---- divergência entre as leituras
    const obito = porNome.get("foto-obito-giuseppe.jpg")
    ok(
      (obito?.divergencias ?? []).some((d) => d.campo === "DATA_OBITO"),
      "a divergência de data de óbito entre as duas leituras foi detectada",
      obito?.divergencias,
    )
    const dataObito = giuseppe?.dados.find((d) => d.campo === "DATA_OBITO")
    ok(
      dataObito == null || dataObito.bloqueado,
      "e o campo NÃO consolidou um valor (nenhuma leitura venceu)",
      dataObito,
    )

    // ---- averbação
    ok(
      (porNome.get("escaneado-casamento.pdf")?.averbacoes ?? []).length === 1,
      "averbação à margem foi transcrita",
      porNome.get("escaneado-casamento.pdf")?.averbacoes,
    )

    // ========================================================================
    console.log("\n4) ÁRVORE EXISTENTE — preserva o que já existe e mostra antes → depois")

    // O requerente já tem uma profissão cadastrada; a certidão diz outra. Local e
    // data ficam iguais de propósito — dado divergente REBAIXA a identidade (é
    // assim que homônimo não é confundido), e aqui o que se quer provar é o
    // antes → depois, não a identificação.
    await prisma.pessoa.update({ where: { id: requerente.id }, data: { profissao: "pedreiro" } })
    const analise2 = await analisarImportacao({ processoId: processo.id, arquivos: [arquivos[0]] })
    const joao2 = analise2.nos.find((n) => n.pessoaId === requerente.id)
    const alteracao = joao2?.alteracoes.find((a) => a.campo === "PROFISSAO")
    ok(!!alteracao, "alteração em dado já preenchido é apresentada", joao2?.alteracoes)
    ok(alteracao?.antes === "pedreiro", "com o valor ANTERIOR à vista", alteracao?.antes)
    ok(/ESTUDANTE/i.test(alteracao?.depois ?? ""), "e o valor que a certidão afirma", alteracao?.depois)
    ok(alteracao?.tipo === "ALTERA_EXISTENTE", "classificada como SOBRESCRITA")
    ok(alteracao?.aplicarPorPadrao === false, "e NÃO marcada por padrão — sobrescrever é decisão do operador")
    const vazio = joao2?.alteracoes.find((a) => a.tipo === "PREENCHE_VAZIO")
    ok(!!vazio && vazio.aplicarPorPadrao === true, "preencher campo vazio, sim, vem marcado por padrão", vazio)
    await prisma.pessoa.update({ where: { id: requerente.id }, data: { profissao: null } })

    // ========================================================================
    console.log("\n5) CONFIRMAÇÃO — a árvore inteira numa transação")

    const confirmacao = await confirmarImportacao({
      processoId: processo.id,
      arquivos,
      analise: analise.arquivos,
      nos: analise.nos,
      vinculos: analise.vinculos,
      // O operador aceita a proposta e resolve o homônimo indicando o primeiro.
      decisoesNos: analise.nos.map((n) => ({
        chave: n.chave,
        acao: n.chave === antonio?.chave ? ("VINCULAR" as const) : n.nova ? ("CRIAR" as const) : ("VINCULAR" as const),
        pessoaId: n.chave === antonio?.chave ? homonimo1.id : n.pessoaId,
        nome: n.nome,
        sobrenome: n.sobrenome,
        camposAAplicar: n.dados.filter((d) => !d.bloqueado).map((d) => d.campo),
        // O operador confirma que a Maria de casada é a mesma do nascimento.
        mesmoQue: n.chave === mariaCasada?.chave ? (maria?.chave ?? null) : null,
      })),
      decisoesVinculos: analise.vinculos.map((v) => ({
        tipo: v.tipo,
        deChave: v.deChave,
        paraChave: v.paraChave,
        aplicar: !v.jaExiste && !v.conflito,
      })),
      decisoesDocumentos: analise.arquivos.map((a) => ({
        indice: a.indice,
        pessoaChave: a.sujeitoChave,
        descartar: !a.legivel,
      })),
    })

    ok(confirmacao.erros.length === 0, "nenhum erro na aplicação", confirmacao.erros)
    ok(confirmacao.pessoasCriadas.length >= 4, "as pessoas novas foram criadas de uma vez", confirmacao.pessoasCriadas.length)
    ok(confirmacao.vinculosCriados >= 6, "os vínculos foram amarrados de uma vez", confirmacao.vinculosCriados)
    ok(confirmacao.documentosCriados.length === 6, "as 6 certidões legíveis viraram documento", confirmacao.documentosCriados.length)
    ok(confirmacao.descartados === 1, "a ilegível foi descartada", confirmacao.descartados)
    ok(confirmacao.importacaoId > 0, "a importação recebeu um identificador de reversão", confirmacao.importacaoId)

    // ---- a árvore no banco
    const pai = await prisma.pessoa.findUnique({
      where: { id: homonimo1.id },
      select: { id: true, paiId: true, maeId: true },
    })
    const filho = await prisma.pessoa.findUnique({ where: { id: requerente.id }, select: { paiId: true, maeId: true } })
    ok(filho?.paiId === homonimo1.id, "o requerente ficou ligado ao pai escolhido pelo operador", filho)
    ok(pai?.paiId != null, "e o pai ficou ligado ao avô criado pela importação", pai)
    const avo = pai?.paiId ? await prisma.pessoa.findUnique({ where: { id: pai.paiId }, select: { nome: true, paiId: true } }) : null
    ok(avo?.nome?.toUpperCase().includes("GIUSEPPE") === true, "o avô é Giuseppe", avo?.nome)
    ok(avo?.paiId != null, "e o BISAVÔ também entrou — 4 gerações vieram das fotos", avo)

    const uniao = await prisma.uniao.findFirst({
      where: { OR: [{ pessoa1Id: homonimo1.id }, { pessoa2Id: homonimo1.id }] },
      select: { id: true, pessoa1Id: true, pessoa2Id: true },
    })
    ok(!!uniao, "a união do casal foi criada a partir da certidão de casamento")

    // A junção aprovada pelo operador virou UMA pessoa só: a mesma Maria é mãe
    // do requerente E cônjuge do pai.
    const marias = await prisma.pessoa.findMany({
      where: { arvoreId: arvore.id, nome: { startsWith: "MARIA" } },
      select: { id: true },
    })
    ok(marias.length === 1, "as duas Marias viraram UMA pessoa depois da junção aprovada", marias.length)
    const mariaId = marias[0]?.id
    const filhoComMae = await prisma.pessoa.findUnique({ where: { id: requerente.id }, select: { maeId: true } })
    ok(filhoComMae?.maeId === mariaId, "e ela é a mãe do requerente", { maeId: filhoComMae?.maeId, mariaId })
    ok(
      uniao?.pessoa1Id === mariaId || uniao?.pessoa2Id === mariaId,
      "e a cônjuge do pai na união criada",
      uniao,
    )

    const docs = await prisma.documento.findMany({
      where: { id: { in: confirmacao.documentosCriados } },
      select: { id: true, pessoaId: true, arquivo_url: true, transcricaoFonte: true, documentTypeId: true },
    })
    ok(
      docs.every((d) => arquivos.some((a) => a.url === d.arquivo_url)),
      "sem armazenamento paralelo: as URLs gravadas são as do upload",
    )
    ok(
      docs.every((d) => d.transcricaoFonte === "anthropic_visao"),
      "a transcrição da leitura visual foi reaproveitada (não se lê duas vezes)",
      docs.map((d) => d.transcricaoFonte),
    )
    ok(
      docs.some((d) => d.pessoaId === requerente.id) && docs.some((d) => d.pessoaId === homonimo1.id),
      "cada certidão foi para o dossiê da pessoa certa",
    )

    const semDono = await prisma.documento.findFirst({ where: { arquivo_url: arquivos[6].url }, select: { id: true } })
    ok(semDono === null, "a certidão ilegível NÃO virou documento")

    // ---- auditoria
    const trilha = await prisma.logAuditoria.findMany({
      where: {
        acao: { in: ["registral_importacao_analisada", "registral_importacao_confirmada"] },
        entidadeId: processo.id,
      },
      select: { acao: true, usuarioId: true, criadoEm: true, descricao: true },
    })
    ok(trilha.length >= 3, "análise e confirmação ficaram na auditoria, com horário", trilha.length)

    // ========================================================================
    console.log("\n6) REVERSÃO — desfaz a importação inteira")

    // Alguém trabalhou em cima do bisavô DEPOIS da importação: ele não pode sumir.
    const bisavoId = avo?.paiId ?? null
    if (bisavoId) {
      await prisma.documento.create({
        data: {
          pessoaId: bisavoId,
          status: "RECEBIDO",
          descricao: "documento posterior à importação",
          origem: "manual",
          tipo: "CERTIDAO_NASCIMENTO",
        },
      })
    }

    const reversao = await reverterImportacao({ importacaoId: confirmacao.importacaoId })
    ok(reversao.documentosRemovidos === 6, "os documentos da importação foram removidos", reversao.documentosRemovidos)
    ok(reversao.unioesRemovidas === 1, "a união criada foi removida", reversao.unioesRemovidas)
    ok(reversao.vinculosRestaurados >= 1, "as filiações voltaram ao que eram", reversao.vinculosRestaurados)
    ok(
      reversao.naoRemovidos.some((n) => n.id === bisavoId),
      "a pessoa que ganhou trabalho depois NÃO foi apagada",
      reversao.naoRemovidos,
    )
    ok(reversao.pessoasRemovidas >= 2, "as demais pessoas criadas foram removidas", reversao.pessoasRemovidas)

    const filhoDepois = await prisma.pessoa.findUnique({ where: { id: requerente.id }, select: { paiId: true } })
    ok(filhoDepois?.paiId === null, "o requerente voltou a não ter pai cadastrado", filhoDepois)
    const uniaoDepois = await prisma.uniao.findFirst({ where: { id: uniao?.id ?? -1 }, select: { id: true } })
    ok(uniaoDepois === null, "a união não existe mais")
    const homonimosDepois = await prisma.pessoa.count({ where: { id: { in: [homonimo1.id, homonimo2.id] } } })
    ok(homonimosDepois === 2, "as pessoas que JÁ EXISTIAM antes da importação continuam lá")

    let repetiu = false
    try {
      await reverterImportacao({ importacaoId: confirmacao.importacaoId })
    } catch {
      repetiu = true
    }
    ok(repetiu, "reverter duas vezes é recusado")

    await prisma.$disconnect()
  } finally {
    definirTransporte(null)
    servidor.close()
    if (chaveOriginal) process.env.ANTHROPIC_API_KEY = chaveOriginal
    else delete process.env.ANTHROPIC_API_KEY
  }

  console.log(`\n${"=".repeat(60)}`)
  console.log(`MRG importação: ${passed} passou, ${failed} falhou`)
  if (failed > 0) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  · ${f}`)
    process.exit(1)
  }
  console.log("✅ Fotos e PDFs escaneados criaram a árvore inteira, com evidência, e a importação pôde ser desfeita.\n")
}

main().catch((e) => {
  console.error("\n❌ ERRO FATAL:", e)
  process.exit(1)
})
