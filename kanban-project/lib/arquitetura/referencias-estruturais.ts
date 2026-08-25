// lib/arquitetura/referencias-estruturais.ts
// ============================================================================
// INSPEÇÃO ARQUITETURAL — referência estrutural nunca é texto.
//
// Regra que este módulo faz cumprir: um cadastro mestre, entidade oficial ou
// classificação estrutural só pode ser referenciado por CHAVE ESTRANGEIRA. Nome,
// código exibido, slug, enum local, CSV, array textual e JSON não relacionam
// nada — eles no máximo EXIBEM.
//
// O que é texto legítimo: conteúdo próprio do registro (nome, título, descrição,
// observação, instrução, comentário). O que é proibido: usar esse texto para
// representar ou LOCALIZAR outra entidade.
//
// Duas superfícies são varridas:
//   1. SCHEMA — campo `String` cujo nome designa uma entidade mestre;
//   2. CÓDIGO — resolução de entidade por nome (`findFirst({ where: { nome } })`),
//      comparação entre cadastros por nome e vínculo carregado em JSON.
//
// A lista de entidades mestres é EXTENSÍVEL e as exceções são JUSTIFICADAS uma a
// uma — nunca uma regra desligada em bloco.
//
// Módulo PURO: sem Prisma, sem I/O (scripts/arquitetura-referencias.test.ts).
// ============================================================================

/** Uma entidade mestre do domínio e como ela deve ser referenciada. */
export interface EntidadeMestre {
  /** Conceito, em uma palavra. */
  conceito: string
  /** Model oficial no Prisma — a fonte única. */
  model: string
  /** Campo FK esperado em quem a referencia. */
  fk: string
  /**
   * Nomes de campo que, sendo `String`, denunciam referência textual. Não é
   * casamento por substring: o nome do campo tem de ser exatamente um destes.
   */
  camposSuspeitos: string[]
}

/**
 * REGISTRO das entidades mestres. Acrescentar aqui é como o guard cresce —
 * nenhuma regra é embutida no scanner.
 */
export const ENTIDADES_MESTRES: EntidadeMestre[] = [
  { conceito: 'categoria de serviço', model: 'CategoriaServico', fk: 'categoriaId', camposSuspeitos: ['category', 'categoria', 'categoryName', 'categoriaNome'] },
  { conceito: 'país', model: 'CatalogoPais', fk: 'paisId', camposSuspeitos: ['country', 'pais', 'countryName', 'nationality', 'nacionalidade'] },
  { conceito: 'modalidade', model: 'ModalidadePais', fk: 'modalidadeId', camposSuspeitos: ['modality', 'modalidade'] },
  { conceito: 'tipo de processo', model: 'TipoProcessoNacionalidade', fk: 'tipoProcessoId', camposSuspeitos: ['processType', 'tipoProcesso'] },
  { conceito: 'fase', model: 'CatalogoFase', fk: 'faseId', camposSuspeitos: ['phase', 'fase'] },
  { conceito: 'documento mestre', model: 'ItemCatalogo', fk: 'itemCatalogoId', camposSuspeitos: ['documento', 'document'] },
  { conceito: 'organização', model: 'Organizacao', fk: 'organizacaoId', camposSuspeitos: ['organizacao', 'organization', 'fornecedor'] },
  { conceito: 'usuário', model: 'Usuario', fk: 'usuarioId', camposSuspeitos: ['usuario', 'user', 'responsavel'] },
  { conceito: 'equipe', model: 'GrupoUsuario', fk: 'equipeId', camposSuspeitos: ['equipe', 'team'] },
  { conceito: 'departamento', model: 'Departamento', fk: 'departamentoId', camposSuspeitos: ['departamento', 'department'] },
  { conceito: 'cargo', model: 'Cargo', fk: 'cargoId', camposSuspeitos: ['cargo', 'role'] },
  { conceito: 'perfil', model: 'Perfil', fk: 'perfilId', camposSuspeitos: ['perfil', 'profile'] },
  { conceito: 'moeda', model: 'MoedaCadastro', fk: 'moedaId', camposSuspeitos: ['currency', 'moeda'] },
  { conceito: 'conta contábil', model: 'ContaContabil', fk: 'contaContabilId', camposSuspeitos: ['contaContabil'] },
]

/**
 * ATRIBUTO CADASTRAL — o campo DESCREVE o próprio registro, não aponta para outro.
 *
 * ─── A DISTINÇÃO QUE FALTAVA ────────────────────────────────────────────────
 * A regra do guard casa nome de campo com conceito mestre e acusa todo `String`.
 * Ela acerta na maioria e erra numa classe inteira: campo de FICHA.
 *
 * `OrgaoProtocolo.moeda` ("moeda praticada pela entidade") fica ao lado de `idioma`,
 * `horario` e `telefone`. Diz que o cartório italiano cobra em euro — do mesmo jeito
 * que `idioma` diz que ele atende em italiano. Nenhuma decisão do sistema depende
 * dele: o preço vem da Tabela de Preços, o custo vem de `Fornecedor.moedaPadrao`, e o
 * motor financeiro nunca pergunta a moeda ao órgão.
 *
 * Chamar isso de dívida faria o inventário prometer uma migração que não deve
 * acontecer — e, pior, apontar o campo para `MoedaCadastro` o limitaria aos códigos
 * que o financeiro usa, perdendo os que a ficha registra.
 *
 * ─── NÃO É AFROUXAMENTO ─────────────────────────────────────────────────────
 * Continua exigindo declaração explícita, alvo por alvo, com motivo escrito. O que
 * muda é a NATUREZA da declaração: "isto não é o que a regra supôs", em vez de "isto
 * é dívida e um dia migra".
 *
 * E a declaração cria uma obrigação nova que antes não existia: um modelo que declara
 * atributo cadastral e TAMBÉM tem a FK do conceito está mantendo duas fontes para o
 * mesmo fato — e isso passa a ser violação. Como exceção comum, essa dupla fonte
 * entraria calada.
 */
export interface AtributoCadastral {
  /** `Model.campo`. */
  alvo: string
  /** Por que este campo descreve o registro em vez de referenciar outro. */
  motivo: string
}

/** Exceção JUSTIFICADA. Sem motivo escrito, não entra. */
export interface Excecao {
  /** `Model.campo` (schema) ou caminho do arquivo (código). */
  alvo: string
  motivo: string
}

export interface Achado {
  tipo: 'schema' | 'codigo'
  /** `Model.campo` ou `arquivo:linha`. */
  onde: string
  conceito: string
  detalhe: string
}

// ── 1) Varredura do schema ─────────────────────────────────────────────────

interface CampoSchema { model: string; nome: string; tipoBruto: string; linha: string }

/** Campos declarados por model, na ordem do arquivo. */
export function camposDoSchema(schema: string): CampoSchema[] {
  const out: CampoSchema[] = []
  let model: string | null = null
  for (const bruta of schema.split('\n')) {
    const linha = bruta.trim()
    const abre = /^model\s+(\w+)\s*\{/.exec(linha)
    if (abre) { model = abre[1]; continue }
    if (linha === '}') { model = null; continue }
    if (!model || linha.startsWith('//') || linha.startsWith('@@')) continue
    const campo = /^(\w+)\s+(\S+)/.exec(linha)
    if (!campo) continue
    out.push({ model, nome: campo[1], tipoBruto: campo[2], linha })
  }
  return out
}

const ehTipoTexto = (t: string) => /^String(\[\])?\??$/.test(t)
const ehTipoJson = (t: string) => /^Json(\[\])?\??$/.test(t)

/**
 * Campos do schema que representam entidade mestre como texto, ou que guardam
 * vínculo em JSON/array textual.
 */
export function analisarSchema(
  schema: string,
  excecoes: Excecao[] = [],
  cadastrais: AtributoCadastral[] = [],
): Achado[] {
  const isento = new Set(excecoes.map((e) => e.alvo))
  const ficha = new Set(cadastrais.map((a) => a.alvo))
  const campos = camposDoSchema(schema)
  const achados: Achado[] = []

  // A FICHA NÃO PODE CONVIVER COM A FK. Declarar `moeda` como atributo cadastral e
  // ter `moedaId` no mesmo modelo é manter duas fontes para o mesmo fato — exatamente
  // o que este guard existe para impedir. A declaração de ficha compra a isenção e
  // paga com esta verificação.
  for (const a of cadastrais) {
    const [model, nome] = a.alvo.split('.')
    const mestre = ENTIDADES_MESTRES.find((m) => m.camposSuspeitos.includes(nome))
    if (!mestre) continue
    const temFk = campos.some((c) => c.model === model && c.nome === mestre.fk)
    if (temFk) {
      achados.push({
        tipo: 'schema', onde: a.alvo, conceito: mestre.conceito,
        detalhe: `declarado como atributo cadastral, mas ${model} também tem ${mestre.fk}. ` +
          `Duas fontes para ${mestre.conceito}: ou o campo é ficha (e a FK sobra), ou é referência (e o texto sai).`,
      })
    }
  }

  for (const c of campos) {
    const alvo = `${c.model}.${c.nome}`
    if (isento.has(alvo) || ficha.has(alvo)) continue

    const mestre = ENTIDADES_MESTRES.find((m) => m.camposSuspeitos.includes(c.nome))
    if (mestre && ehTipoTexto(c.tipoBruto)) {
      achados.push({
        tipo: 'schema', onde: alvo, conceito: mestre.conceito,
        detalhe: `${c.tipoBruto} representando ${mestre.conceito}. Use ${mestre.fk} → ${mestre.model}.`,
      })
      continue
    }
    // Array textual de referências (`String[]` com nome no plural de entidade).
    if (/^String\[\]$/.test(c.tipoBruto)) {
      const plural = ENTIDADES_MESTRES.find((m) => m.camposSuspeitos.some((s) => c.nome === `${s}s`))
      if (plural) {
        achados.push({
          tipo: 'schema', onde: alvo, conceito: plural.conceito,
          detalhe: `array textual de ${plural.conceito}. Use tabela associativa com ${plural.fk}.`,
        })
        continue
      }
    }
    // JSON cujo nome anuncia vínculo.
    if (ehTipoJson(c.tipoBruto) && /vinculo|vinculos|relacao|relacionamento|refs?$/i.test(c.nome)) {
      achados.push({
        tipo: 'schema', onde: alvo, conceito: 'vínculo',
        detalhe: 'JSON usado como relacionamento. Use tabela associativa com chaves estrangeiras.',
      })
    }
  }
  return achados
}

/**
 * Nem todo `*Id` textual é referência a cadastro. Estes são identificadores
 * OPACOS de evento/transação — correlação, causalidade, idempotência —, que por
 * natureza são strings e não apontam para linha de tabela nenhuma. Reconhecê-los
 * é o que mantém o guard preciso: alarme falso treina a equipe a ignorar o guard.
 */
const IDS_OPACOS = /^(correlation|causation|correlacao|transacao|idempotencia|chave|external|externo|target|request|trace|session|sessao)/i

/**
 * Campos `*Id` do tipo `String` cujo PREFIXO designa uma entidade mestre — aí
 * sim o id deveria ser a chave estrangeira numérica, não texto.
 */
export function idsTextuais(schema: string, excecoes: Excecao[] = []): Achado[] {
  const isento = new Set(excecoes.map((e) => e.alvo))
  const achados: Achado[] = []
  for (const c of camposDoSchema(schema)) {
    if (!/Id$/.test(c.nome) || !ehTipoTexto(c.tipoBruto)) continue
    if (isento.has(`${c.model}.${c.nome}`)) continue
    const prefixo = c.nome.slice(0, -2)
    if (IDS_OPACOS.test(prefixo)) continue
    // Só acusa quando o prefixo casa com uma entidade mestre conhecida.
    const mestre = ENTIDADES_MESTRES.find(
      (m) => m.camposSuspeitos.some((sus) => prefixo.toLowerCase().includes(sus.toLowerCase()))
        || prefixo.toLowerCase().includes(m.model.toLowerCase()),
    )
    if (!mestre) continue
    achados.push({
      tipo: 'schema', onde: `${c.model}.${c.nome}`, conceito: mestre.conceito,
      detalhe: `${c.tipoBruto} no lugar da FK de ${mestre.conceito}. Use ${mestre.fk} → ${mestre.model}.`,
    })
  }
  return achados
}

// ── 2) Varredura do código ─────────────────────────────────────────────────

/**
 * Resolução de entidade por NOME: `findFirst/findUnique({ where: { nome... } })`.
 * É o join simulado por texto — o padrão que faz dois cadastros homônimos
 * colidirem em silêncio.
 */
const PADROES_CODIGO: { nome: string; re: RegExp; detalhe: string }[] = [
  {
    nome: 'busca de entidade por nome',
    re: /\.(?:findFirst|findUnique)\(\{\s*where:\s*\{\s*(?:nome|name|label|descricao|description)\s*:/g,
    detalhe: 'entidade localizada por texto. Busque por id (ou por chave única imutável declarada).',
  },
  {
    // `err.name`/`error.name` é o nome da CLASSE do erro, não um cadastro —
    // acusá-lo seria ruído, e ruído é o que faz um guard ser ignorado.
    nome: 'comparação de cadastro por nome',
    re: /\bif\s*\((?![^)]*\b(?:err|error|e|ex|exception)\.name\b)[^)]*\.(?:nome|name)\s*(?:===|==)\s*['"`]/g,
    detalhe: 'regra decidindo por nome de cadastro. Decida por id/enum estrutural.',
  },
  {
    nome: 'inferência por conteúdo textual',
    re: /\.(?:nome|name|categoria|category|nacionalidade|nationality)\s*\.\s*includes\(\s*['"`]/g,
    detalhe: 'classificação inferida do texto. Classifique por chave estrutural.',
  },
]

export function analisarCodigo(arquivo: string, conteudo: string, excecoes: Excecao[] = []): Achado[] {
  if (excecoes.some((e) => e.alvo === arquivo)) return []
  // Teste afirma sobre TEXTO RENDERIZADO por natureza ("o rótulo não contém —").
  // Isso não é resolver entidade por nome; varrer testes só geraria alarme falso.
  if (/\.test\.tsx?$/.test(arquivo)) return []
  const achados: Achado[] = []
  const linhas = conteudo.split('\n')
  for (const p of PADROES_CODIGO) {
    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i]
      if (linha.trim().startsWith('//') || linha.trim().startsWith('*')) continue
      p.re.lastIndex = 0
      if (p.re.test(linha)) {
        achados.push({ tipo: 'codigo', onde: `${arquivo}:${i + 1}`, conceito: p.nome, detalhe: p.detalhe })
      }
    }
  }
  return achados
}

/** Relatório legível — é o que sai no log do CI. */
export function formatar(achados: Achado[]): string {
  if (achados.length === 0) return 'Nenhuma referência estrutural em texto.'
  return achados.map((a) => `  ✗ ${a.onde} — ${a.detalhe}`).join('\n')
}
