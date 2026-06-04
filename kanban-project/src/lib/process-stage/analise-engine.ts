// src/lib/process-stage/analise-engine.ts
//
// ENGINE DE COMPARAÇÃO DA ANÁLISE DOCUMENTAL (a "IA" do HTML do Marco).
// Compara os dados da ÁRVORE (verdade cadastrada) com os dados REGISTRADOS
// nos documentos e gera a lista de divergências.
//
// PURA: não toca no banco. Recebe os dados já carregados e devolve os objetos
// de divergência prontos pra inserir. A rota (Fase 3) faz o fetch e a gravação.

// ── Tipos de entrada ──────────────────────────────────────────────────────
export interface DocumentoParaAnalise {
  id: number
  tipo: string                 // valor do enum TipoDocumento
  titulo: string               // rótulo amigável ("Certidão de Nascimento (IT)")
  nomeRegistrado: string | null
  paiRegistrado: string | null
  maeRegistrada: string | null
  conjugeRegistrado: string | null
  cidadeRegistro: string | null
  dataDocumento: string | null
}

export interface PessoaParaAnalise {
  id: number
  nome: string                 // nome completo (nome + sobrenome)
  geracao: number | null
  linhaReta: boolean
  paiNome: string | null       // nome completo do pai (resolvido da árvore)
  maeNome: string | null
  conjugeNome: string | null   // nome completo do cônjuge (se houver)
  localNasc: string | null
  documentos: DocumentoParaAnalise[]
}

// ── Saída: 1 divergência pronta pra gravar ──────────────────────────────────
export interface DivergenciaInput {
  pessoaId: number
  pessoaNome: string
  geracao: number | null
  linhaReta: boolean
  documentoId: number
  documentoTitulo: string
  dataDocumento: string | null
  campo: string
  campoLabel: string
  valorArvore: string | null
  valorDocumento: string | null
  tipo: string
  severidade: string
  sugestaoIA: string
  motivoIA: string
  impacto: string
  requerRetificacaoIA: boolean
}

// ── Helpers de comparação ────────────────────────────────────────────────
function normalize(s: string): string {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase()
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}

const IMPACTO: Record<string, string> = {
  baixa: "Baixo · não quebra a linha de transmissão.",
  media: "Médio · pode exigir ressalva ou documento de apoio.",
  critica: "Crítico · pode quebrar a prova da linhagem.",
}

interface Classificacao {
  severidade: string
  sugestaoIA: string
  motivoIA: string
  impacto: string
  requerRetificacaoIA: boolean
}

// Compara dois valores. null = iguais OU falta um dos lados (não dá pra comparar).
function classificar(treeVal: string | null, docVal: string | null): Classificacao | null {
  const t = (treeVal || "").trim()
  const d = (docVal || "").trim()
  if (!t || !d) return null

  const nt = normalize(t), nd = normalize(d)

  // Iguais depois de normalizar → variação ortográfica (acento/maiúscula)
  if (nt === nd) {
    if (t !== d) {
      return { severidade: "baixa", sugestaoIA: "Aceitar variação ortográfica (acentuação).",
        motivoIA: `Mesma grafia com diferença de acento/maiúsculas entre "${t}" e "${d}".`,
        impacto: IMPACTO.baixa, requerRetificacaoIA: false }
    }
    return null
  }

  // Só diferença de espaços → também variação ortográfica
  if (nt.replace(/\s/g, "") === nd.replace(/\s/g, "")) {
    return { severidade: "baixa", sugestaoIA: "Aceitar variação ortográfica.",
      motivoIA: `Mesma grafia com diferença de espaçamento entre "${t}" e "${d}".`,
      impacto: IMPACTO.baixa, requerRetificacaoIA: false }
  }

  // 1-2 letras de diferença → média
  const dist = levenshtein(nt, nd)
  if (dist <= 2) {
    return { severidade: "media", sugestaoIA: "Revisar documentos de apoio.",
      motivoIA: `Pequena diferença (${dist} letra(s)) entre "${t}" e "${d}".`,
      impacto: IMPACTO.media, requerRetificacaoIA: false }
  }

  // Muito diferente → crítica
  return { severidade: "critica", sugestaoIA: "Avaliar retificação.",
    motivoIA: `Diferença significativa entre "${t}" (árvore) e "${d}" (documento).`,
    impacto: IMPACTO.critica, requerRetificacaoIA: true }
}

// Quais campos comparar conforme o tipo do documento.
interface CampoComparavel {
  campo: string
  campoLabel: string
  tipo: string
  treeVal: (p: PessoaParaAnalise) => string | null
  docVal: (d: DocumentoParaAnalise) => string | null
}

const CAMPO_NOME: CampoComparavel = { campo: "nome", campoLabel: "Nome", tipo: "nome", treeVal: (p) => p.nome, docVal: (d) => d.nomeRegistrado }
const CAMPO_PAI: CampoComparavel = { campo: "pai", campoLabel: "Nome do pai", tipo: "filiacao", treeVal: (p) => p.paiNome, docVal: (d) => d.paiRegistrado }
const CAMPO_MAE: CampoComparavel = { campo: "mae", campoLabel: "Nome da mãe", tipo: "filiacao", treeVal: (p) => p.maeNome, docVal: (d) => d.maeRegistrada }
const CAMPO_CIDADE: CampoComparavel = { campo: "cidade_nascimento", campoLabel: "Cidade de nascimento", tipo: "localidade", treeVal: (p) => p.localNasc, docVal: (d) => d.cidadeRegistro }
const CAMPO_CONJUGE: CampoComparavel = { campo: "conjuge", campoLabel: "Nome do cônjuge", tipo: "conjuge", treeVal: (p) => p.conjugeNome, docVal: (d) => d.conjugeRegistrado }

function camposDoDocumento(tipo: string): CampoComparavel[] {
  if (tipo.includes("NASCIMENTO")) return [CAMPO_NOME, CAMPO_PAI, CAMPO_MAE, CAMPO_CIDADE]
  if (tipo.includes("CASAMENTO")) return [CAMPO_NOME, CAMPO_CONJUGE]
  if (tipo.includes("OBITO")) return [CAMPO_NOME]
  return [CAMPO_NOME]
}

// ── Função principal ──────────────────────────────────────────────────────
export function gerarDivergencias(pessoas: PessoaParaAnalise[]): DivergenciaInput[] {
  const out: DivergenciaInput[] = []
  for (const p of pessoas) {
    if (!p.linhaReta) continue          // só linha reta entra na análise (regra do carro)
    for (const doc of p.documentos) {
      for (const campo of camposDoDocumento(doc.tipo)) {
        const treeVal = campo.treeVal(p)
        const docVal = campo.docVal(doc)
        const c = classificar(treeVal, docVal)
        if (!c) continue
        out.push({
          pessoaId: p.id, pessoaNome: p.nome, geracao: p.geracao, linhaReta: p.linhaReta,
          documentoId: doc.id, documentoTitulo: doc.titulo, dataDocumento: doc.dataDocumento,
          campo: campo.campo, campoLabel: campo.campoLabel,
          valorArvore: treeVal, valorDocumento: docVal,
          tipo: campo.tipo, severidade: c.severidade, sugestaoIA: c.sugestaoIA,
          motivoIA: c.motivoIA, impacto: c.impacto, requerRetificacaoIA: c.requerRetificacaoIA,
        })
      }
    }
  }
  return out
}