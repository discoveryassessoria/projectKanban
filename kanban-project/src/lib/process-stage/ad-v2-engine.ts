// src/lib/process-stage/ad-v2-engine.ts
//
// ANÁLISE DOCUMENTAL v2 — FATIA 1: motor puro (sem React, sem Prisma).
// Portado fielmente do módulo `window.AD` + da camada de comparação (ad2*) do
// mockup Operacional_bom.html. É só lógica: normalização, equivalência linguística
// IT↔PT, classificação de divergência, dado canônico (doc-base), comparação campo a
// campo e o gate de prontidão (readiness). NÃO contém UI nem acesso a banco.
//
// Próximas fatias da AD2: (2) banco — structuredData/dataStatus/analysisStatus no
// Documento; (3) editores de dados por tipo (nascimento/casamento/óbito); (4) as 5
// subabas (Resumo, Auditoria, Fontes/Provas, Plano, Histórico); (5) rotas + montagem.

// ============================================================
// TIPOS
// ============================================================

export type DataStatus = "not_filled" | "ai_extracted" | "manual_filled" | "reviewed"
export type AnalysisStatus = "not_ready" | "ready"
export type DocTipo = "nascimento" | "casamento" | "obito"

// pessoa como vem da árvore real (backend) — «AJUSTE» os nomes ao seu schema
export interface TreePerson {
  id: number
  nome: string
  sobrenome?: string
  gen?: string                  // "G1".."Gn" | "Atual"
  isLinha?: boolean
  ehRequerente?: boolean
  ehAncestral?: boolean
  linhagem?: string             // "conjuge" = cônjuge de apoio
  estadoCivil?: string
  pais?: string
  nascimento?: string
  nacionalidade?: string
  sexo?: string
  dataCasamento?: string
  dataObito?: string
  docs?: TreeDoc[]
}
export interface TreeDoc {
  id: number
  tipo: DocTipo
  status?: string
  structuredData?: StructuredData | null
  dataStatus?: DataStatus
  analysisStatus?: AnalysisStatus
}

// dados estruturados por tipo (shape exato dos editores; campos opcionais)
export type StructuredData = {
  birth?: Record<string, any>
  marriage?: Record<string, any>
  death?: Record<string, any>
}

export interface CanonicalData {
  name?: string; birthDate?: string; birthPlace?: string; nationality?: string
  fatherName?: string; motherName?: string
}
export interface PersonModel {
  _src: TreePerson; id: number; fullName: string; generation: number | null
  branchId: string; branchName: string
  isInTransmissionLine: boolean; roleInLine: string
  isApplicant: boolean; spouseIds: number[]
  baseDocumentId: number | null; baseDocumentLabel?: string
  canonicalData: CanonicalData
}
export interface DocModel {
  _src: TreeDoc; id: number; personId: number; personName: string
  branchId: string; branchName: string; generation: number | null
  documentType: DocTipo; eventType: DocTipo; fileName: string; status?: string
  required: boolean; roleInAnalysis: "base_document" | "transmission" | "support"
  baseDocumentId: number | null
  structuredData: StructuredData | null; dataStatus: DataStatus; analysisStatus: AnalysisStatus
}
export interface ADModel { persons: PersonModel[]; documents: DocModel[] }

export interface Classification {
  type: string; severity: "leve" | "media" | "critica"
  confidence: "alta" | "media" | "baixa"; recommendation: string; difference: string
}
export interface Comparison {
  id: string; documentId: number; documentLabel: string; documentType: DocTipo
  personId: number; personName: string; personRoleInLine?: string
  groupLabel: string; fieldKey: string; fieldLabel: string
  valueInDocument: string; expectedValue: string; expectedValueSource: string
  comparisonStatus: string; divergenceType: string
  severity: string; confidence: string; operationalRecommendation: string; aiSuggestion: string
  userDecision: "pendente" | "sem_acao"; notes: string
}
export interface Pendency {
  kind: string; label: string; reason: string; action: string
  docId?: number; person?: string; gen?: number | null; role?: string
}
export interface Readiness { ready: boolean; empty?: boolean; pendencies: Pendency[] }

// ============================================================
// CONSTANTES (literais do mockup)
// ============================================================

export const AD2_DTYPE: Record<string, string> = {
  nascimento: "Certidão de Nascimento", casamento: "Certidão de Casamento", obito: "Certidão de Óbito",
}
export const AD2_ROLE_LBL: Record<string, string> = {
  base_foreign_ancestor: "Ancestral base", transmitter: "Transmissor", applicant: "Requerente",
  spouse_support: "Cônjuge de apoio", not_in_line: "Fora da linha",
}
export const AD2_SEV: Record<string, [string, string]> = {
  nenhuma: ["—", ""], leve: ["Baixa", "low"], baixa: ["Baixa", "low"],
  media: ["Média", "media"], alta: ["Alta", "media"], critica: ["Crítica", "critica"],
}
export const AD2_CONF: Record<string, [string, string]> = { alta: ["Alta", "ok"], media: ["Média", "med"], baixa: ["Baixa", "low"] }
export const AD2_REC: Record<string, string> = {
  nenhuma: "—", retificar: "Retificar", aceitar_variacao: "Aceitar variação",
  revisar_humano: "Revisão humana", descartar: "Descartar",
}
export const AD2_GRAV: Record<string, [string, string]> = {
  nenhuma: ["—", ""], baixa: ["Baixa", "low"], media: ["Média", "media"], alta: ["Alta", "media"], critica: ["Crítica", "critica"],
}
export const AD2_STAT: Record<string, [string, string]> = {
  correto: ["Correto", "ok"], divergente: ["Divergente", "div"], ausente_no_documento: ["Ausente", "abs"],
  ausente_na_base: ["Sem base", "na"], nao_comparado: ["Não comp.", "na"], precisa_revisao: ["Revisar", "rev"],
}
export const AD2_TABS: Array<[string, string]> = [
  ["resumo", "Resumo"], ["audit", "Auditoria Documental"], ["sources", "Fontes / Provas"],
  ["plano", "Plano de Retificação"], ["historico", "Histórico"],
]
export const SEV_LABEL: Record<string, string> = { baixa: "Leve", media: "Média", critica: "Crítica" }
export const SEV_DOT: Record<string, string> = { baixa: "amber", media: "orange", critica: "red" }

// selects dos editores (úteis na fatia dos formulários)
export const ST_SEX: Array<[string, string]> = [["", "—"], ["Masculino", "Masculino"], ["Feminino", "Feminino"]]
export const ST_BOOL: Array<[string, string]> = [["", "—"], ["sim", "Sim"], ["nao", "Não"]]
export const ST_CIVIL: Array<[string, string]> = [["", "—"], ["Solteiro", "Solteiro(a)"], ["Casado", "Casado(a)"], ["Viúvo", "Viúvo(a)"], ["Divorciado", "Divorciado(a)"]]
export const ST_TR: Array<[string, string]> = [["none", "Nenhum"], ["husband", "Cônjuge 1 (marido)"], ["wife", "Cônjuge 2 (esposa)"], ["both", "Ambos"]]

// ============================================================
// 1) NORMALIZAÇÃO E EQUIVALÊNCIA LINGUÍSTICA (§26)
// ============================================================

// pares de prenomes equivalentes IT <-> PT (nacionalização de prenome)
const EQUIV_GROUPS: string[][] = [
  ["giuseppe", "jose"], ["giovanni", "joao"], ["antonio", "antonio"], ["guglielmo", "guilherme"],
  ["pietro", "pedro"], ["francesco", "francisco"], ["luigi", "luis", "luiz"], ["teresa", "tereza"], ["maria", "maria"],
]

export function stripAccents(s: string): string {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}
// normalização canônica: sem acento, maiúsculas, espaços colapsados
export function norm(s: string): string {
  return stripAccents(s).toUpperCase().replace(/\s+/g, " ").trim()
}
export function tokens(s: string): string[] {
  return norm(s).split(" ").filter(Boolean)
}
// dois prenomes pertencem ao mesmo grupo de equivalência?
export function sameEquivGroup(a: string, b: string): boolean {
  const na = stripAccents(a).toLowerCase(), nb = stripAccents(b).toLowerCase()
  if (na === nb) return true
  return EQUIV_GROUPS.some((g) => g.includes(na) && g.includes(nb))
}
// distância de edição (Levenshtein) sobre nomes normalizados
export function levenshtein(a: string, b: string): number {
  a = norm(a); b = norm(b)
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => { const r = new Array(n + 1).fill(0); r[0] = i; return r })
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[m][n]
}

// ============================================================
// 2) CLASSIFICAÇÃO DE DIVERGÊNCIA (§16 + §26)
// ============================================================

function mk(type: string, severity: Classification["severity"], confidence: Classification["confidence"], recommendation: string, difference: string): Classification {
  return { type, severity, confidence, recommendation, difference }
}

// null quando idênticos; senão {type, severity, confidence, recommendation, difference}
export function classifyName(expected: string, found: string, opts: { onLine?: boolean } = {}): Classification | null {
  if (!expected || !found) return null
  const ne = norm(expected), nf = norm(found)
  if (ne === nf) {
    if (expected.trim() !== found.trim())
      return mk("grafia", "leve", "alta", "aceitar_variacao", `Variação de grafia/acentuação: "${found}" × "${expected}".`)
    return null
  }
  const te = tokens(expected), tf = tokens(found)
  const allEquiv = te.length === tf.length && te.every((t, i) => sameEquivGroup(t, tf[i]))
  if (allEquiv)
    return mk("traducao_nome", opts.onLine ? "critica" : "media", "alta",
      opts.onLine ? "retificar" : "aceitar_variacao", `Nacionalização/tradução de prenome: "${found}" × "${expected}".`)
  const incomplete = tf.every((t) => te.includes(t)) || te.every((t) => tf.includes(t))
  if (incomplete && te.length !== tf.length)
    return mk("nome_incompleto", "media", "media", "revisar_humano", `Nome possivelmente incompleto: "${found}" × "${expected}".`)
  const dist = levenshtein(expected, found)
  if (dist <= 2)
    return mk("grafia", opts.onLine ? "media" : "leve", "media", "revisar_humano", `Variação ortográfica próxima: "${found}" × "${expected}".`)
  return mk("nome_diferente", opts.onLine ? "critica" : "media", "baixa",
    opts.onLine ? "retificar" : "revisar_humano", `Nome divergente (não é variação linguística): "${found}" × "${expected}".`)
}

export function classifyPlainField(kind: string, expected: string, found: string): Classification | null {
  if (!expected || !found) return null
  if (norm(expected) === norm(found)) return null
  const map: Record<string, string> = { data: "data", local: "local", idade: "idade", nacionalidade: "nacionalidade", estado_civil: "estado_civil" }
  return mk(map[kind] || "outro", "media", "media", "revisar_humano", `Divergência de ${kind}: "${found}" × "${expected}".`)
}

// ============================================================
// 3) ÁRVORE REAL → MODELO DE ANÁLISE
// ============================================================

export function ad2GenNum(gen?: string): number | null {
  const m = /^G(\d+)$/.exec(gen || "")
  if (m) return +m[1]
  if (gen === "Atual") return 90
  return null
}
export function ad2Role(p: TreePerson): string {
  if (p.ehAncestral) return "base_foreign_ancestor"
  if (p.ehRequerente) return "applicant"
  if (p.linhagem === "conjuge") return "spouse_support"
  if (p.isLinha) return "transmitter"
  return "not_in_line"
}
export function ad2FullName(p: TreePerson): string {
  return (p.nome + " " + (p.sobrenome || "")).trim()
}
export function ad2DocRequired(p: TreePerson, tipo: DocTipo): boolean {
  if (!p.isLinha) return tipo === "casamento" && p.linhagem === "conjuge"
  if (tipo === "nascimento") return true
  if (tipo === "casamento") return (p.estadoCivil || "").toLowerCase().indexOf("solteiro") < 0
  return false // óbito = opcional
}

// constrói o modelo de análise a partir da árvore real — SEM dados fixos
export function buildADModelFromTree(people: TreePerson[]): ADModel {
  const persons: PersonModel[] = (people || []).map((p) => {
    return {
      _src: p, id: p.id, fullName: ad2FullName(p), generation: ad2GenNum(p.gen),
      branchId: "tronco", branchName: "Linha principal",
      isInTransmissionLine: !!p.isLinha, roleInLine: ad2Role(p),
      isApplicant: !!p.ehRequerente, spouseIds: [],
      baseDocumentId: ((p.docs || []).find((d) => d.tipo === "nascimento") || { id: null }).id,
      // canônico: fallback da árvore (sobrescrito pelo doc-base revisado em buildCanonical)
      canonicalData: { name: ad2FullName(p), birthDate: p.nascimento || undefined, birthPlace: p.pais || undefined, nationality: p.nacionalidade || undefined, fatherName: undefined, motherName: undefined },
    }
  })
  const documents: DocModel[] = []
  ;(people || []).forEach((p) => {
    ;(p.docs || []).forEach((d) => {
      const isBase = p.ehAncestral && d.tipo === "nascimento"
      // §7: infere o transmissor do casamento a partir da árvore (sem exigir preenchimento)
      if (d.tipo === "casamento" && p.isLinha && d.structuredData && d.structuredData.marriage) {
        const mar = d.structuredData.marriage
        mar.transmission = mar.transmission || {}
        if (!mar.transmission.transmissionRole || mar.transmission.transmissionRole === "none") {
          mar.transmission.transmissionRole = p.sexo === "Feminino" ? "wife" : "husband"
          mar.transmission.belongsToLine = "sim"
        }
        const role = mar.transmission.transmissionRole
        if (role === "husband" && mar.spouse1 && !mar.spouse1.personId) mar.spouse1.personId = p.id
        if (role === "wife" && mar.spouse2 && !mar.spouse2.personId) mar.spouse2.personId = p.id
        mar.transmission.transmissionPersonId = mar.transmission.transmissionPersonId || p.id
      }
      documents.push({
        _src: d, id: d.id, personId: p.id, personName: ad2FullName(p),
        branchId: "tronco", branchName: "Linha principal", generation: ad2GenNum(p.gen),
        documentType: d.tipo, eventType: d.tipo,
        fileName: AD2_DTYPE[d.tipo] || d.tipo, status: d.status,
        required: ad2DocRequired(p, d.tipo),
        roleInAnalysis: isBase ? "base_document" : (p.isLinha ? "transmission" : "support"),
        baseDocumentId: isBase ? null : (persons.find((x) => x.id === p.id) || { baseDocumentId: null }).baseDocumentId,
        structuredData: d.structuredData || null,
        dataStatus: d.dataStatus || "not_filled",
        analysisStatus: d.analysisStatus || "not_ready",
      })
    })
  })
  return { persons, documents }
}

// ============================================================
// 4) RAMOS + TRANSMISSÃO (§9 / §7)
// ============================================================

export function buildBranches(persons: PersonModel[]) {
  const branches: Record<string, { id: string; name: string; persons: PersonModel[]; generations: Record<number, PersonModel[]> }> = {}
  persons.forEach((p) => {
    if (!p.branchId) return
    if (!branches[p.branchId]) branches[p.branchId] = { id: p.branchId, name: p.branchName || p.branchId, persons: [], generations: {} }
    const b = branches[p.branchId]
    b.persons.push(p)
    const g = p.generation ?? -1
    ;(b.generations[g] = b.generations[g] || []).push(p)
  })
  return branches
}

export function resolveMarriageTransmission(marriageDoc: DocModel, persons: PersonModel[]) {
  const md = (marriageDoc.structuredData && marriageDoc.structuredData.marriage) || {}
  const find = (pid: number | undefined) => persons.find((p) => p.id === pid)
  const s1 = find(md.spouse1 && md.spouse1.personId)
  const s2 = find(md.spouse2 && md.spouse2.personId)
  const s1Line = s1 && s1.isInTransmissionLine, s2Line = s2 && s2.isInTransmissionLine
  let role = "none", transmitter: PersonModel | undefined, support: PersonModel | undefined
  if (s1Line && !s2Line) { role = "husband"; transmitter = s1; support = s2 }
  else if (s2Line && !s1Line) { role = "wife"; transmitter = s2; support = s1 }
  else if (s1Line && s2Line) { role = "both" }
  return { transmissionRole: role, transmitter, supportSpouse: support, belongsToLine: role !== "none" }
}

// ============================================================
// 5) DADO CANÔNICO (§4 / §17) — doc-base revisado tem prioridade; árvore é fallback
// ============================================================

export function buildCanonical(persons: PersonModel[], documents: DocModel[]): PersonModel[] {
  persons.forEach((p) => {
    const fromTree = p.canonicalData || {}
    let fromBase: CanonicalData = {}
    if (p.baseDocumentId) {
      const base = documents.find((d) => d.id === p.baseDocumentId)
      const reviewed = base && (base.dataStatus === "reviewed" || base.dataStatus === "manual_filled")
      if (base && reviewed && base.structuredData && base.structuredData.birth) {
        const b = base.structuredData.birth
        fromBase = {
          name: (b.registered && b.registered.fullName) || undefined,
          birthDate: (b.registered && b.registered.birthDate) || undefined,
          birthPlace: (b.registered && b.registered.birthPlace) || undefined,
          nationality: (b.registered && b.registered.nationality) || undefined,
          fatherName: (b.father && b.father.fullName) || undefined,
          motherName: (b.mother && b.mother.fullName) || undefined,
        }
        p.baseDocumentLabel = base.fileName || base.documentType
      }
    }
    const merged: CanonicalData = Object.assign({}, fromTree)
    ;(Object.keys(fromBase) as Array<keyof CanonicalData>).forEach((k) => { if (fromBase[k] != null) merged[k] = fromBase[k] })
    p.canonicalData = merged
  })
  return persons
}
export function canonicalOf(persons: PersonModel[], personId: number): CanonicalData | null {
  const p = persons.find((x) => x.id === personId)
  return (p && p.canonicalData) || null
}
export function personById(persons: PersonModel[], id: number): PersonModel | null {
  return persons.find((p) => p.id === id) || null
}

// inicializa o modelo (constrói da árvore + aplica canônico)
export function initADModel(people: TreePerson[]): ADModel {
  const model = buildADModelFromTree(people)
  buildCanonical(model.persons, model.documents)
  return model
}

// ============================================================
// 6) READINESS (§15) — devolve {ready, pendencies[]} sem inventar nada
// ============================================================

export function ad2Readiness(model: ADModel): Readiness {
  const pend: Pendency[] = []
  const linha = model.persons.filter((p) => p.isInTransmissionLine)
  if (!model.persons.length)
    return { ready: false, empty: true, pendencies: [{ kind: "tree", label: "Árvore genealógica vazia", reason: "Cadastre as pessoas na aba Árvore Genealógica.", action: "tree" }] }
  if (!linha.length) pend.push({ kind: "tree", label: "Nenhuma pessoa na linha de transmissão", reason: "Defina ao menos uma pessoa da linha.", action: "tree" })
  const base = model.persons.find((p) => p.roleInLine === "base_foreign_ancestor")
  if (base) {
    const bdoc = model.documents.find((d) => d.id === base.baseDocumentId)
    if (!bdoc) pend.push({ kind: "base", label: "Documento-base não definido", person: base.fullName, reason: "O nascimento estrangeiro do ancestral base não existe.", action: "tree" })
  }
  model.documents.filter((d) => d.required).forEach((d) => {
    if (d.dataStatus !== "reviewed")
      pend.push({
        kind: "data", docId: d.id, label: `${AD2_DTYPE[d.documentType] || d.documentType} — ${d.personName}`,
        person: d.personName, gen: d.generation, role: d.roleInAnalysis,
        reason: d.dataStatus === "not_filled" ? "Sem dados estruturados" : d.dataStatus === "manual_filled" ? "Rascunho não revisado" : "Aguardando revisão",
        action: "fill",
      })
  })
  model.documents.filter((d) => d.documentType === "casamento" && d.structuredData && d.structuredData.marriage).forEach((d) => {
    const t = d.structuredData!.marriage!.transmission
    const owner = model.persons.find((p) => p.id === d.personId)
    const inferivel = owner && owner.isInTransmissionLine
    const explicito = t && t.transmissionRole && t.transmissionRole !== "none"
    if (!explicito && !inferivel)
      pend.push({ kind: "transm", docId: d.id, label: `Transmissor não definido — ${d.personName}`, person: d.personName, reason: "Defina quem transmite neste casamento.", action: "fill" })
  })
  return { ready: pend.length === 0, pendencies: pend }
}

// ============================================================
// 7) COMPARAÇÃO CAMPO A CAMPO (camada da Auditoria) — ad2CompareValue / ad2CompareDoc
// ============================================================

const has = (v: unknown) => v != null && String(v).trim() !== ""

type CmpResult = Pick<Comparison, "comparisonStatus" | "divergenceType" | "severity" | "confidence" | "operationalRecommendation" | "aiSuggestion">
const S = (cs: string, dt: string, sev: string, conf: string, rec: string, sug = ""): CmpResult =>
  ({ comparisonStatus: cs, divergenceType: dt, severity: sev, confidence: conf, operationalRecommendation: rec, aiSuggestion: sug })

// classifica um campo comparado → status + gravidade + sugestão
export function ad2CompareValue(type: "name" | "date" | "place" | "text", docVal: string, expVal: string): CmpResult {
  if (!has(docVal) && !has(expVal)) return S("nao_comparado", "nenhuma", "nenhuma", "alta", "nenhuma")
  if (!has(docVal) && has(expVal)) return S("ausente_no_documento", "nenhuma", "media", "alta", "revisar_humano", "Valor esperado não consta no documento.")
  if (has(docVal) && !has(expVal)) return S("ausente_na_base", "nenhuma", "baixa", "media", "nenhuma", "Sem valor-base para comparar.")
  if (type === "name") {
    const cls = classifyName(expVal, docVal, { onLine: true })
    if (!cls) return S("correto", "nenhuma", "nenhuma", "alta", "nenhuma")
    const sev = ({ leve: "baixa", media: "media", critica: "critica" } as Record<string, string>)[cls.severity] || "media"
    return S("divergente", cls.type, sev, cls.confidence, cls.recommendation, cls.difference)
  }
  if (type === "date") {
    if (norm(docVal) === norm(expVal)) return S("correto", "nenhuma", "nenhuma", "alta", "nenhuma")
    return S("divergente", "data", "critica", "alta", "retificar", "Data divergente.")
  }
  if (type === "place") {
    if (norm(docVal) === norm(expVal)) return S("correto", "nenhuma", "nenhuma", "alta", "nenhuma")
    return S("divergente", "local", "media", "media", "revisar_humano", "Local divergente.")
  }
  if (norm(docVal) === norm(expVal)) return S("correto", "nenhuma", "nenhuma", "alta", "nenhuma")
  return S("divergente", "outro", "media", "media", "revisar_humano", "Valor divergente.")
}

// normalizedName é técnico interno: recalculado no save, nunca exibido.
// fullName→normalizedName; fatherFullName→fatherNormalizedName; grandfatherName→grandfatherNormalizedName
export function ad2ComputeNormalized(obj: any): void {
  if (!obj || typeof obj !== "object") return
  Object.keys(obj).forEach((k) => {
    const v = obj[k]
    if (v && typeof v === "object") { ad2ComputeNormalized(v); return }
    if (typeof v !== "string" || /[Nn]ormalizedName/.test(k)) return
    if (k === "fullName") obj.normalizedName = norm(v)
    else if (/FullName$/.test(k)) obj[k.replace(/FullName$/, "NormalizedName")] = norm(v)
    else if (/Name$/.test(k)) obj[k.replace(/Name$/, "NormalizedName")] = norm(v)
  })
}

let _fcSeq = 1
// gera TODAS as comparações de campo de um documento (não só divergências)
export function ad2CompareDoc(doc: DocModel, persons: PersonModel[]): Comparison[] {
  const sd = doc.structuredData || {}
  const person = personById(persons, doc.personId) || ({} as PersonModel)
  const can = person.canonicalData || {}
  const baseLabel = "Doc-base — " + (person.fullName || doc.personName || "")
  const tree = "Árvore genealógica"
  const rows: Comparison[] = []
  const add = (g: string, k: string, l: string, docVal: any, expVal: any, type: "name" | "date" | "place" | "text", src?: string) => {
    const r = ad2CompareValue(type, docVal, expVal)
    rows.push(Object.assign({
      id: "fc-" + (_fcSeq++), documentId: doc.id, documentLabel: doc.fileName || AD2_DTYPE[doc.documentType], documentType: doc.documentType,
      personId: doc.personId, personName: doc.personName, personRoleInLine: person.roleInLine,
      groupLabel: g, fieldKey: k, fieldLabel: l,
      valueInDocument: docVal || "", expectedValue: expVal || "", expectedValueSource: has(expVal) ? (src || baseLabel) : "",
      userDecision: (["divergente", "precisa_revisao", "ausente_no_documento"].includes(r.comparisonStatus) ? "pendente" : "sem_acao") as Comparison["userDecision"], notes: "",
    }, r) as Comparison)
  }

  if (doc.documentType === "nascimento" && sd.birth) {
    const b = sd.birth, reg = b.registered || {}, fa = b.father || {}, mo = b.mother || {}, pg = b.paternalGrandparents || {}, mg = b.maternalGrandparents || {}
    add("Dados do registrado", "reg.nome", "Nome completo", reg.fullName, can.name, "name")
    add("Dados do registrado", "reg.dn", "Data de nascimento", reg.birthDate, can.birthDate, "date")
    add("Dados do registrado", "reg.ln", "Local de nascimento", reg.birthPlace, can.birthPlace, "place")
    add("Dados do registrado", "reg.nac", "Nacionalidade", reg.nationality, can.nationality, "text")
    add("Pais", "pai.nome", "Nome do pai", fa.fullName, can.fatherName, "name")
    add("Pais", "mae.nome", "Nome da mãe", mo.fullName, can.motherName, "name")
    add("Avós paternos", "avp.avo", "Nome do avô paterno", pg.grandfatherName, null, "name")
    add("Avós paternos", "avp.ava", "Nome da avó paterna", pg.grandmotherName, null, "name")
    add("Avós maternos", "avm.avo", "Nome do avô materno", mg.grandfatherName, null, "name")
    add("Avós maternos", "avm.ava", "Nome da avó materna", mg.grandmotherName, null, "name")
  } else if (doc.documentType === "casamento" && sd.marriage) {
    const m = sd.marriage, ev = m.event || {}, s1 = m.spouse1 || {}, s2 = m.spouse2 || {}, p1 = m.spouse1Parents || {}, p2 = m.spouse2Parents || {}
    const role = (m.transmission || {}).transmissionRole
    const canOf = (pid: number | undefined) => (pid ? (canonicalOf(persons, pid) || {}) : {})
    const can1 = role === "husband" ? can : canOf(s1.personId)
    const can2 = role === "wife" ? can : canOf(s2.personId)
    const spouse = (g: string, pre: string, s: any, c: CanonicalData) => {
      add(g, pre + ".nome", "Nome completo", s.fullName, c.name, "name")
      add(g, pre + ".dn", "Data de nascimento", s.birthDate, c.birthDate, "date")
      add(g, pre + ".ln", "Local de nascimento", s.birthPlace, c.birthPlace, "place")
      add(g, pre + ".nac", "Nacionalidade", s.nationality, c.nationality, "text")
      add(g, pre + ".prof", "Profissão", s.profession, null, "text")
      add(g, pre + ".civil", "Estado civil anterior", s.previousCivilStatus, null, "text")
    }
    spouse("Dados do noivo", "s1", s1, can1)
    add("Pais do noivo", "p1.pai", "Nome do pai", p1.fatherFullName, can1.fatherName, "name")
    add("Pais do noivo", "p1.mae", "Nome da mãe", p1.motherFullName, can1.motherName, "name")
    spouse("Dados da noiva", "s2", s2, can2)
    add("Pais da noiva", "p2.pai", "Nome do pai", p2.fatherFullName, can2.fatherName, "name")
    add("Pais da noiva", "p2.mae", "Nome da mãe", p2.motherFullName, can2.motherName, "name")
    add("Evento", "ev.data", "Data do casamento", ev.marriageDate, (person._src && person._src.dataCasamento) || null, "date", tree)
    add("Evento", "ev.local", "Local do casamento", ev.marriagePlace, null, "place")
    add("Evento", "ev.pais", "País", ev.marriageCountry, null, "text")
  } else if (doc.documentType === "obito" && sd.death) {
    const d = sd.death, de = d.deceased || {}, pa = d.parents || {}, cj = d.spouse || {}, ob = d.deathEvent || {}, dec = d.declarant || {}
    add("Dados do falecido", "de.nome", "Nome completo", de.fullName, can.name, "name")
    add("Dados do falecido", "de.dn", "Data de nascimento", de.birthDate, can.birthDate, "date")
    add("Dados do falecido", "de.ln", "Local de nascimento", de.birthPlace, can.birthPlace, "place")
    add("Dados do falecido", "de.nac", "Nacionalidade", de.nationality, can.nationality, "text")
    add("Pais do falecido", "pa.pai", "Nome do pai", pa.fatherFullName, can.fatherName, "name")
    add("Pais do falecido", "pa.mae", "Nome da mãe", pa.motherFullName, can.motherName, "name")
    add("Cônjuge", "cj.nome", "Nome do cônjuge", cj.fullName, null, "name")
    add("Óbito", "ob.data", "Data do óbito", ob.deathDate, (person._src && person._src.dataObito) || null, "date", tree)
    add("Óbito", "ob.local", "Local do óbito", ob.deathPlace, null, "place")
    add("Declarante", "dec.nome", "Nome do declarante", dec.fullName, null, "text")
  }
  return rows
}

// resumo por documento das comparações (usado nos cabeçalhos da auditoria)
export function ad2SevRank(s: string): number {
  return ["nenhuma", "baixa", "media", "alta", "critica"].indexOf(s)
}
export function ad2PersonSummary(comps: Comparison[]) {
  const div = comps.filter((c) => c.comparisonStatus === "divergente").length
  const ok = comps.filter((c) => c.comparisonStatus === "correto").length
  const abs = comps.filter((c) => c.comparisonStatus === "ausente_no_documento").length
  const pend = comps.filter((c) => c.userDecision === "pendente").length
  const conf = comps.reduce((a, c) => Math.max(a, ad2SevRank(c.severity)), 0)
  return { total: comps.length, div, ok, abs, pend, conf }
}