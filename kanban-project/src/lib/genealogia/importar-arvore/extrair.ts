// src/lib/genealogia/importar-arvore/extrair.ts
// ============================================================================
// EXTRAÇÃO POR VISÃO — a única porta do sistema para a IA.
//
// Tudo à volta (rota, prévia, gravação) não sabe que este arquivo existe: fala
// só com a assinatura `ExtratorDeArvore` de `tipos.ts`. Trocar de modelo, de
// prompt ou de fornecedor acontece aqui dentro.
//
// O PROMPT é o que muda em relação à tentativa anterior (revertida em 71e70e51).
// Lá a IA investigava certidões manuscritas e inferia vínculos — caro e frágil.
// Aqui a entrada já vem organizada em cards, então a instrução é TRANSCREVER:
//   • ler cada card e devolver os campos como estão escritos;
//   • NÃO inferir dado ausente — campo ilegível ou cortado é OMITIDO;
//   • NÃO analisar robustez do caso (elo sem documento etc.) — fora de escopo;
//   • o vínculo pai/mãe vem das LINHAS entre os cards, não de dedução por
//     sobrenome ou idade;
//   • `ref` é local à extração e só serve para ligar paiRef/maeRef/pessoaNRef.
//
// TRÊS CAMADAS contêm o custo, e nenhuma substitui a outra:
//   1. `visao-cliente.ts` — teto de US$ por chamada conferido ANTES de gastar,
//      teto de tokens de saída, teto de bytes da imagem e da resposta;
//   2. o ESQUEMA abaixo — a API constrange a saída ao formato, então o modelo
//      não gasta tokens escrevendo prosa, justificativa ou análise;
//   3. `sanear()` — o que volta é conferido campo a campo antes de virar
//      prévia. Resposta bem-formada mas absurda (500 pessoas, nome de 4 KB)
//      não passa: seria custo de banco em cima de custo de token.
// ============================================================================
import {
  blocoDaImagem,
  chamarVisao,
  chaveConfigurada,
  configVisao,
  situacaoDaVisao,
} from "./visao-cliente"
import type { EntradaExtracao, ExtracaoArvore, ExtratorDeArvore, PessoaExtraida, UniaoExtraida } from "./tipos"

export { situacaoDaVisao }

/** Lançada quando a leitura por IA não está disponível. A rota traduz em 501. */
export class ExtracaoNaoImplementada extends Error {
  readonly codigo = "EXTRACAO_NAO_IMPLEMENTADA"
  constructor(motivo?: string) {
    super(
      motivo ??
        "A leitura por IA ainda não está ligada: falta a chave ANTHROPIC_API_KEY. " +
          "O restante do fluxo (upload, prévia, gravação) já funciona.",
    )
    this.name = "ExtracaoNaoImplementada"
  }
}

/** Lançada quando a chamada existiu mas não deu resultado utilizável. Rota traduz em 502. */
export class FalhaNaLeitura extends Error {
  readonly codigo = "FALHA_NA_LEITURA"
  constructor(motivo: string) {
    super(motivo)
    this.name = "FalhaNaLeitura"
  }
}

// ---------------------------------------------------------------- tetos de saneamento

/**
 * Tetos da validação de saída. Não são preferência estética: cada um fecha uma
 * porta por onde uma resposta anômala viraria custo — de banco, de tela ou de
 * uma segunda chamada.
 */
export const LIMITES = {
  /** Uma árvore importada de um print não tem centenas de pessoas. */
  pessoas: 150,
  unioes: 150,
  avisos: 40,
  aviso: 300,
  /** Espelham as colunas do Prisma: passar disso estouraria no INSERT. */
  nome: 50,
  sobrenome: 40,
  sexo: 10,
  local: 100,
  regiao: 50,
  ref: 20,
} as const

// ---------------------------------------------------------------- esquema de saída

// COMO "NÃO DEU PARA LER" É EXPRESSO: string VAZIA, em campo obrigatório.
//
// Duas tentativas foram recusadas com 400 "Schema is too complex", e o custo do
// erro não é trivial: a API gasta o tempo de compilação ANTES de recusar (181s
// na 1ª versão, 31s na 2ª), o que o timeout de 45s do cliente registrava como
// falha de rede.
//
//   1ª — `anyOf: [tipo, {type:"null"}]` em 18 campos.
//   2ª — sem anyOf, mas com 18 campos OPCIONAIS. Ainda recusado.
//
// O que pesa é a OPCIONALIDADE. Numa decodificação restrita, N propriedades
// opcionais obrigam a gramática a aceitar qualquer subconjunto em qualquer
// ordem — o espaço de estados cresce com 2^N. Com tudo obrigatório a gramática
// vira uma sequência fixa, e o compilador aceita.
//
// Custo: o modelo emite as 14 chaves por pessoa mesmo vazias. É token de saída
// a mais, e é o preço de a chamada funcionar.
//
// `sanear()` já trata "" como ausente (`texto()` devolve null), então nada muda
// para quem consome.
const TEXTO = { type: "string", description: 'Vazio ("") se não estiver legível.' }
const DATA = { type: "string", description: 'ISO 8601 (YYYY-MM-DD) só se dia, mês e ano estiverem legíveis; senão "".' }

/**
 * JSON Schema da resposta. A API constrange a saída a ele (`output_config.format`),
 * o que faz duas coisas ao mesmo tempo: garante o formato e impede o modelo de
 * gastar tokens com texto livre.
 *
 * TODOS os campos são obrigatórios — ver o bloco acima sobre complexidade. O
 * modelo diz "não estava legível" com string vazia, nunca omitindo a chave.
 *
 * `numeroLinhagem` é string, não integer, pelo mesmo motivo: um número
 * obrigatório não teria como expressar "ausente" sem inventar um valor. O
 * `inteiro()` de `sanear()` converte.
 */
export const ESQUEMA_EXTRACAO = {
  type: "object",
  additionalProperties: false,
  required: ["pessoas", "unioes", "avisos"],
  properties: {
    pessoas: {
      type: "array",
      description: "Uma entrada por card de pessoa visível na imagem.",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "ref", "nome", "sobrenome", "sexo", "data_nasc", "local_nasc", "estado_nasc",
          "pais_nasc", "nacionalidade", "data_obito", "local_obito", "numeroLinhagem",
          "paiRef", "maeRef",
        ],
        properties: {
          ref: { type: "string", description: 'Identificador local que você cria: "p1", "p2", ... Único por pessoa.' },
          nome: { type: "string", description: "Primeiro nome / nome próprio, como escrito no card." },
          sobrenome: TEXTO,
          sexo: {
            type: "string",
            enum: ["masculino", "feminino", ""],
            description: 'Só quando o card marca explicitamente (M/F, símbolo, rótulo). Nunca deduzir pelo nome; senão "".',
          },
          data_nasc: DATA,
          local_nasc: { type: "string", description: 'Cidade de nascimento; "" se ilegível.' },
          estado_nasc: TEXTO,
          pais_nasc: TEXTO,
          nacionalidade: TEXTO,
          data_obito: DATA,
          local_obito: TEXTO,
          numeroLinhagem: { type: "string", description: 'Número de linhagem/geração se o card mostrar; senão "".' },
          paiRef: { type: "string", description: '`ref` do pai, quando houver LINHA ligando os cards; senão "".' },
          maeRef: { type: "string", description: '`ref` da mãe, quando houver LINHA ligando os cards; senão "".' },
        },
      },
    },
    unioes: {
      type: "array",
      description: "Um casamento/união por par explicitamente marcado na imagem.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pessoa1Ref", "pessoa2Ref", "data_inicio", "local", "estado", "pais"],
        properties: {
          pessoa1Ref: { type: "string" },
          pessoa2Ref: { type: "string" },
          data_inicio: DATA,
          local: TEXTO,
          estado: TEXTO,
          pais: TEXTO,
        },
      },
    },
    avisos: {
      type: "array",
      description: "Uma linha curta por leitura duvidosa, citando o `ref`. Sem dúvidas, devolva [].",
      items: { type: "string" },
    },
  },
} as const

// ---------------------------------------------------------------- prompt

const SISTEMA = `Você transcreve uma ÁRVORE GENEALÓGICA JÁ MONTADA a partir da imagem enviada.

A imagem NÃO é uma certidão nem um documento manuscrito: é o print de uma árvore
já organizada, com uma pessoa por card e linhas ligando os cards. Sua tarefa é
LER e COPIAR o que está escrito. Não investigue, não deduza, não complete.

REGRAS

1. TRANSCREVA LITERALMENTE. Nome, sobrenome, datas e locais saem exatamente como
   estão escritos no card: sem corrigir grafia, sem traduzir, sem expandir
   abreviação, sem padronizar acento.

2. O QUE NÃO DÁ PARA LER SAI COMO STRING VAZIA (""). Todas as chaves são
   obrigatórias: sempre inclua todas, e use "" no que estiver ausente, cortado
   pela borda, borrado, coberto ou ambíguo. Nunca invente, estime, arredonde nem
   complete a partir do contexto. "" é a resposta certa, não uma falha.

3. DATA só sai preenchida se der para ler dia, mês e ano, no formato YYYY-MM-DD.
   Data parcial ("1890", "c. 1902", "19??", "mar/1930") sai como "" e entra em
   'avisos' dizendo o que estava escrito.

4. FILIAÇÃO VEM DAS LINHAS entre os cards — nunca de dedução por sobrenome
   igual, diferença de idade ou posição na página. Sem linha ligando o card do
   filho ao do pai/mãe, 'paiRef' e 'maeRef' saem como "".

5. CASAMENTO ('unioes') só quando a imagem marca o par explicitamente: linha de
   casal, símbolo de união, rótulo "casado com", moldura de casal. Duas pessoas
   no mesmo nível, ou lado a lado, NÃO são um casal.

6. NÃO ANALISE O CASO. Robustez do vínculo, documento faltante, viabilidade de
   cidadania, qualidade da árvore e qualquer juízo de valor estão FORA de escopo.
   Você transcreve; quem decide é o operador que vai revisar a prévia.

7. 'ref' é um identificador local que você inventa ("p1", "p2", ...), único por
   pessoa. Serve só para 'paiRef', 'maeRef', 'pessoa1Ref' e 'pessoa2Ref'
   apontarem entre si. Toda ref citada tem que existir na lista 'pessoas'.

8. 'avisos': uma linha curta por leitura duvidosa (card cortado, data ambígua,
   nome parcialmente legível, linha de filiação que não dá para seguir), citando
   a 'ref'. Sem dúvidas, devolva lista vazia. Avisos não são análise do caso.

Se a imagem não for uma árvore genealógica, devolva 'pessoas' e 'unioes' vazios
e um aviso dizendo o que a imagem parece ser.`

// ---------------------------------------------------------------- implementação

export const extrairArvoreDaImagem: ExtratorDeArvore = async (entrada: EntradaExtracao): Promise<ExtracaoArvore> => {
  const credencial = chaveConfigurada()
  if (!credencial.ok) throw new ExtracaoNaoImplementada(credencial.motivo)

  const cfg = configVisao()
  const imagem = blocoDaImagem(entrada.imagemBase64, entrada.mimeType, cfg)
  if (!imagem.ok) throw new FalhaNaLeitura(imagem.motivo)

  const blocos: Parameters<typeof chamarVisao>[0]["blocos"] = [imagem.bloco]

  // O texto do operador entra DEPOIS da imagem e rotulado como complemento —
  // ele desambigua o que está no print, não substitui o que está no print.
  const complemento = entrada.textoComplementar?.trim()
  if (complemento) {
    blocos.push({
      type: "text",
      text:
        "Texto complementar digitado pelo operador para desambiguar a leitura. " +
        "Use-o apenas para resolver dúvidas sobre o que está na imagem; ele não " +
        "acrescenta pessoas que não aparecem nos cards.\n\n" +
        complemento.slice(0, 4_000),
    })
  }

  blocos.push({ type: "text", text: "Transcreva a árvore desta imagem seguindo as regras." })

  const resposta = await chamarVisao(
    { sistema: SISTEMA, blocos, esquema: ESQUEMA_EXTRACAO, referencia: "importar-arvore" },
    cfg,
  )

  if (!resposta.ok) throw new FalhaNaLeitura(resposta.motivo)

  const saneada = sanear(resposta.json)
  saneada.avisos.push(
    `Leitura por IA (${cfg.modelo}): ${saneada.pessoas.length} pessoa(s), ${saneada.unioes.length} união(ões). ` +
      `Custo desta leitura: US$ ${resposta.custo.custoUsd.toFixed(4)}. Confira tudo antes de gravar.`,
  )
  return saneada
}

// ---------------------------------------------------------------- saneamento

/**
 * Confere o que voltou, campo a campo, e devolve algo que a prévia e o INSERT
 * aguentam. Nada aqui confia no esquema: o esquema é do fornecedor, e um
 * fornecedor que mude de comportamento não pode derrubar a gravação.
 *
 * Toda correção vira aviso. Corrigir em silêncio faria o operador aprovar na
 * prévia uma coisa e gravar outra.
 */
export function sanear(bruto: unknown): ExtracaoArvore {
  const avisos: string[] = []
  const raiz = (bruto ?? {}) as Record<string, unknown>

  const brutasPessoas = Array.isArray(raiz.pessoas) ? raiz.pessoas : []
  const brutasUnioes = Array.isArray(raiz.unioes) ? raiz.unioes : []

  if (brutasPessoas.length > LIMITES.pessoas) {
    avisos.push(`A leitura devolveu ${brutasPessoas.length} pessoas; só as ${LIMITES.pessoas} primeiras foram mantidas.`)
  }

  // ── 1ª passada: campos de cada pessoa, e as refs que de fato existem ──────
  const pessoas: PessoaExtraida[] = []
  const refsVistas = new Set<string>()

  for (const item of brutasPessoas.slice(0, LIMITES.pessoas)) {
    if (!item || typeof item !== "object") continue
    const p = item as Record<string, unknown>

    const nome = corta(texto(p.nome), LIMITES.nome, avisos, "nome")
    if (!nome) continue // pessoa sem nome não tem como virar Pessoa nem ser revisada

    let ref = corta(texto(p.ref), LIMITES.ref, avisos, "ref") ?? ""
    if (!ref || refsVistas.has(ref)) {
      const gerada = `p${pessoas.length + 1}_${refsVistas.size}`
      avisos.push(ref ? `Ref repetida "${ref}" em "${nome}" — renomeada para "${gerada}".` : `Pessoa "${nome}" veio sem ref — recebeu "${gerada}".`)
      ref = gerada
    }
    refsVistas.add(ref)

    pessoas.push({
      ref,
      nome,
      sobrenome: corta(texto(p.sobrenome), LIMITES.sobrenome, avisos, `sobrenome de ${nome}`),
      sexo: sexo(p.sexo),
      data_nasc: data(p.data_nasc, avisos, `data de nascimento de ${nome}`),
      local_nasc: corta(texto(p.local_nasc), LIMITES.local, avisos, `local de nascimento de ${nome}`),
      estado_nasc: corta(texto(p.estado_nasc), LIMITES.regiao, avisos, `estado de nascimento de ${nome}`),
      pais_nasc: corta(texto(p.pais_nasc), LIMITES.regiao, avisos, `país de nascimento de ${nome}`),
      nacionalidade: corta(texto(p.nacionalidade), LIMITES.regiao, avisos, `nacionalidade de ${nome}`),
      data_obito: data(p.data_obito, avisos, `data de falecimento de ${nome}`),
      local_obito: corta(texto(p.local_obito), LIMITES.local, avisos, `local de falecimento de ${nome}`),
      numeroLinhagem: inteiro(p.numeroLinhagem),
      // Resolvidos na 2ª passada: o pai pode aparecer depois do filho na lista.
      paiRef: texto(p.paiRef),
      maeRef: texto(p.maeRef),
    })
  }

  // ── 2ª passada: filiação — ref que não existe é elo inventado, não elo ────
  for (const p of pessoas) {
    p.paiRef = refValida(p.paiRef ?? null, p.ref, refsVistas, avisos, `pai de ${p.nome}`)
    p.maeRef = refValida(p.maeRef ?? null, p.ref, refsVistas, avisos, `mãe de ${p.nome}`)
  }

  // ── 3ª passada: uniões ───────────────────────────────────────────────────
  if (brutasUnioes.length > LIMITES.unioes) {
    avisos.push(`A leitura devolveu ${brutasUnioes.length} uniões; só as ${LIMITES.unioes} primeiras foram mantidas.`)
  }

  const unioes: UniaoExtraida[] = []
  const paresVistos = new Set<string>()

  for (const item of brutasUnioes.slice(0, LIMITES.unioes)) {
    if (!item || typeof item !== "object") continue
    const u = item as Record<string, unknown>
    const r1 = texto(u.pessoa1Ref)
    const r2 = texto(u.pessoa2Ref)

    if (!r1 || !r2 || !refsVistas.has(r1) || !refsVistas.has(r2)) {
      avisos.push(`União descartada: aponta para pessoa que não está na leitura (${r1 ?? "?"}–${r2 ?? "?"}).`)
      continue
    }
    if (r1 === r2) {
      avisos.push(`União descartada: os dois lados são a mesma pessoa (${r1}).`)
      continue
    }
    const chave = [r1, r2].sort().join("|")
    if (paresVistos.has(chave)) {
      avisos.push(`União repetida ignorada (${r1}–${r2}).`)
      continue
    }
    paresVistos.add(chave)

    unioes.push({
      pessoa1Ref: r1,
      pessoa2Ref: r2,
      data_inicio: data(u.data_inicio, avisos, `data do casamento ${r1}–${r2}`),
      local: corta(texto(u.local), LIMITES.local, avisos, `local do casamento ${r1}–${r2}`),
      estado: corta(texto(u.estado), LIMITES.regiao, avisos, `estado do casamento ${r1}–${r2}`),
      pais: corta(texto(u.pais), LIMITES.regiao, avisos, `país do casamento ${r1}–${r2}`),
    })
  }

  // ── avisos vindos do modelo, depois dos nossos ───────────────────────────
  if (Array.isArray(raiz.avisos)) {
    for (const a of raiz.avisos) {
      const t = texto(a)
      if (t) avisos.push(t.slice(0, LIMITES.aviso))
    }
  }

  if (pessoas.length === 0) {
    avisos.push("Nenhuma pessoa foi lida da imagem. Confira se o print está legível e mostra a árvore inteira.")
  }

  const cortados = avisos.length - LIMITES.avisos
  const finais = avisos.slice(0, LIMITES.avisos)
  if (cortados > 0) finais.push(`(+${cortados} aviso(s) omitido(s))`)

  return { pessoas, unioes, avisos: finais }
}

function texto(v: unknown): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  return t && t.toLowerCase() !== "null" ? t : null
}

/** Corta no tamanho da coluna e avisa. Estourar o VarChar mataria a transação. */
function corta(v: string | null, max: number, avisos: string[], campo: string): string | null {
  if (!v) return null
  if (v.length <= max) return v
  avisos.push(`Campo "${campo}" veio com ${v.length} caracteres e foi cortado em ${max}.`)
  return v.slice(0, max)
}

function sexo(v: unknown): string | null {
  const t = texto(v)?.toLowerCase()
  if (!t) return null
  if (t.startsWith("masc") || t === "m") return "masculino"
  if (t.startsWith("fem") || t === "f") return "feminino"
  return null // valor fora do combinado é descartado, não repassado ao banco
}

/** Só data completa e real. "2024-02-31" parece ISO mas não existe. */
function data(v: unknown, avisos: string[], campo: string): string | null {
  const t = texto(v)
  if (!t) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t.slice(0, 10))
  if (!m) {
    avisos.push(`Campo "${campo}" não veio como data completa ("${t.slice(0, 40)}") e ficou vazio.`)
    return null
  }
  const [, a, mes, dia] = m
  const d = new Date(`${a}-${mes}-${dia}T00:00:00.000Z`)
  const valida =
    !Number.isNaN(d.getTime()) &&
    d.getUTCFullYear() === Number(a) &&
    d.getUTCMonth() + 1 === Number(mes) &&
    d.getUTCDate() === Number(dia) &&
    Number(a) >= 1500 &&
    Number(a) <= new Date().getUTCFullYear()
  if (!valida) {
    avisos.push(`Campo "${campo}" veio com data inexistente ou fora de faixa ("${t.slice(0, 40)}") e ficou vazio.`)
    return null
  }
  return `${a}-${mes}-${dia}`
}

/**
 * Cuidado com o vazio: `Number(null)` é 0, então tratar "" pela via numérica
 * transformaria "não legível" em "linhagem 0" — um dado inventado. O texto é
 * conferido ANTES da conversão.
 */
function inteiro(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(texto(v) ?? NaN)
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : null
}

function refValida(alvo: string | null, propria: string, existentes: Set<string>, avisos: string[], rotulo: string): string | null {
  if (!alvo) return null
  if (alvo === propria) {
    avisos.push(`Vínculo descartado: ${rotulo} apontava para a própria pessoa.`)
    return null
  }
  if (!existentes.has(alvo)) {
    avisos.push(`Vínculo descartado: ${rotulo} aponta para "${alvo}", que não está na leitura.`)
    return null
  }
  return alvo
}

// ---------------------------------------------------------------- mock

/**
 * Extração FALSA, para exercitar prévia e gravação sem gastar token.
 *
 * Só é usada quando `IMPORTAR_ARVORE_MOCK=1` — nunca por acidente, nunca em
 * produção sem alguém ter ligado explicitamente. Devolve uma família de três
 * gerações com o mesmo formato que a real devolve.
 */
export const extrairArvoreMock: ExtratorDeArvore = async (): Promise<ExtracaoArvore> => ({
  pessoas: [
    {
      ref: "p1", nome: "Giuseppe", sobrenome: "Rossi", sexo: "masculino",
      data_nasc: "1901-03-14", local_nasc: "Vicenza", pais_nasc: "Itália",
      nacionalidade: "italiana", data_obito: "1968-11-02", numeroLinhagem: 1,
    },
    {
      ref: "p2", nome: "Maria", sobrenome: "Bianchi", sexo: "feminino",
      data_nasc: "1905-07-22", local_nasc: "Vicenza", pais_nasc: "Itália",
      nacionalidade: "italiana",
    },
    {
      ref: "p3", nome: "Antonio", sobrenome: "Rossi", sexo: "masculino",
      data_nasc: "1930-01-09", local_nasc: "São Paulo", estado_nasc: "SP",
      pais_nasc: "Brasil", nacionalidade: "brasileira",
      numeroLinhagem: 2, paiRef: "p1", maeRef: "p2",
    },
  ],
  unioes: [
    { pessoa1Ref: "p1", pessoa2Ref: "p2", data_inicio: "1928-05-30", local: "Vicenza", pais: "Itália" },
  ],
  avisos: [
    "MOCK — nenhuma imagem foi lida. Ligue IMPORTAR_ARVORE_MOCK=0 para usar a leitura real.",
  ],
})

/** Escolhe o extrator. O mock exige opt-in explícito por variável de ambiente. */
export function obterExtrator(): ExtratorDeArvore {
  return process.env.IMPORTAR_ARVORE_MOCK === "1" ? extrairArvoreMock : extrairArvoreDaImagem
}
