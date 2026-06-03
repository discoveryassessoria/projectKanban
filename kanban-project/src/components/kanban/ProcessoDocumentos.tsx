// src/components/kanban/ProcessoDocumentos.tsx

"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2 } from "lucide-react"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import type { ProcessoWithStatus, Processo } from "@/src/types/kanban"
import { DocumentoOperationalDrawer } from "./DocumentoOperationalDrawer"
import { PessoaOperacionalDrawer } from "./PessoaOperacionalDrawer"
import {
  ProcessoDocumentosBiblioteca,
  type BibPersonGroup,
  type BibDocItem,
  type BibKpis,
} from "./ProcessoDocumentosBiblioteca"

// ============================================================
// TIPOS (espelho do endpoint)
// ============================================================

interface DocCompact {
  id: number
  tipo: string
  tipoShort: string
  status: string
  statusShort: string
  statusClass: string
  isRecebido: boolean
}

interface Impediment {
  label: string
  severity: "crit" | "warn"
  detail?: string
}

interface PersonRow {
  pessoaId: number
  nome: string
  iniciais: string
  geracao: number | null
  isDirectLine: boolean
  papel: string
  transmissao: {
    state: "TRANSMITE" | "RISCO" | "BLOQUEADA" | "JUDICIAL" | "NA"
    label: string
    detail?: string
  }
  docs: DocCompact[]
  received: number
  total: number
  progressPct: number
  impedimentos: Impediment[]
  proximaAcao: {
    label: string
    severity: "info" | "warn" | "crit"
  } | null
  agingDays: number | null
  agingCls: "ok" | "warn" | "crit" | null
  ultimaMov: string | null
}

interface ProcessoDocumentosData {
  stats: {
    total: number
    recebidos: number
    emOperacao: number
    pendentes: number
  }
  linhaPrincipal: PersonRow[]
  conjuges: PersonRow[]
  outros: PersonRow[]
}

interface ProcessoDocumentosProps {
  processo: ProcessoWithStatus | Processo
}

// ============================================================
// MAPEAMENTO: data da rota -> props da Biblioteca
// ============================================================

// status genérico do doc -> estágio "certidão" da biblioteca
function certStatusFromDoc(
  status: string,
  isRecebido: boolean
): "validada" | "recebida" | "pendente" {
  if (isRecebido) return "validada"
  const s = status.toLowerCase()
  if (s === "recebido" || s === "entregue") return "recebida"
  return "pendente"
}

function mapearBiblioteca(data: ProcessoDocumentosData) {
  const toGroup = (row: PersonRow): BibPersonGroup => {
    const docs: BibDocItem[] = row.docs.map((d) => {
      const certSt = certStatusFromDoc(d.status, d.isRecebido)
      const finalStatus: "pronta_protocolo" | "pendente" | "aguardando" =
        certSt === "validada" ? "pronta_protocolo" : "pendente"
      return {
        id: d.id,
        documentType: d.tipoShort,
        documentFormat: "Inteiro teor",
        personName: row.nome,
        certificate: { status: certSt },
        retifiedCertificate: { status: "nao_aplica" }, // backend ainda não separa
        translation: { status: "nao_aplica" },         // idem
        apostille: { status: "nao_aplica" },            // idem
        finalStatus,
      }
    })
    const ready = docs.filter((x) => x.finalStatus === "pronta_protocolo").length
    const pend = docs.filter((x) => x.finalStatus === "pendente").length
    return {
      personId: row.pessoaId,
      personName: row.nome,
      role: row.papel,
      lineage: row.isDirectLine ? "Linha reta" : "Fora da linha",
      generation: row.geracao ?? "—",
      stats: { totalDocuments: docs.length, readyForProtocol: ready, pending: pend },
      documents: docs,
    }
  }

  const linhaPrincipal = data.linhaPrincipal.map(toGroup)
  const foraDaLinha = [...data.conjuges, ...data.outros].map(toGroup)

  // KPIs (derivados)
  const todos = [...linhaPrincipal, ...foraDaLinha]
  const allDocs = todos.flatMap((g) => g.documents)
  const kpis: BibKpis = {
    pessoas: todos.filter((g) => g.documents.length > 0).length,
    obrig: allDocs.length,
    certRec: allDocs.filter((d) => d.certificate.status === "recebida" || d.certificate.status === "validada").length,
    certRetif: allDocs.filter((d) => d.retifiedCertificate.status === "validada").length,
    trad: allDocs.filter((d) => d.translation.status === "recebida" || d.translation.status === "validada").length,
    apost: allDocs.filter((d) => d.apostille.status === "recebida" || d.apostille.status === "validada").length,
    pronto: allDocs.filter((d) => d.finalStatus === "pronta_protocolo").length,
    pend: allDocs.filter((d) => d.finalStatus === "pendente").length,
  }

  return { kpis, linhaPrincipal, foraDaLinha }
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export function ProcessoDocumentos({ processo }: ProcessoDocumentosProps) {
  const { pode } = usePermissoes()
  const [data, setData] = useState<ProcessoDocumentosData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [drawerDocId, setDrawerDocId] = useState<number | null>(null)
  const [drawerPessoaId, setDrawerPessoaId] = useState<number | null>(null)
  const [voltarParaPessoa, setVoltarParaPessoa] = useState<{ id: number; nome: string } | null>(null)

  const carregar = useCallback(
    async (modoSilencioso = false) => {
      if (!modoSilencioso) setLoading(true)
      else setRefreshing(true)
      setErro(null)

      try {
        const res = await fetch(`/api/processos/${processo.id}/documentos`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("authToken")}`,
          },
        })

        if (res.status === 404) {
          setErro("Endpoint /api/processos/[id]/documentos ainda não existe.")
          return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const json: ProcessoDocumentosData = await res.json()
        setData(json)
      } catch (e) {
        console.warn("[ProcessoDocumentos] falha:", e)
        setErro("Erro ao carregar Pasta Documental.")
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [processo.id]
  )

  useEffect(() => {
    carregar()
  }, [carregar])

  // -- Renderização

  if (loading && !data) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (erro && !data) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          ⚠ {erro}
        </div>
      </div>
    )
  }

  if (!data) return null

  const bib = mapearBiblioteca(data)

  return (
    <>
      <ProcessoDocumentosBiblioteca
        kpis={bib.kpis}
        linhaPrincipal={bib.linhaPrincipal}
        foraDaLinha={bib.foraDaLinha}
        onAbrirDetalhes={(docId) => setDrawerDocId(docId)}
      />

      {/* Drawer da pessoa */}
      <PessoaOperacionalDrawer
        pessoaId={drawerPessoaId}
        isOpen={drawerPessoaId !== null}
        onClose={() => {
          setDrawerPessoaId(null)
          setVoltarParaPessoa(null)
        }}
        onClickDoc={(docId) => {
          setDrawerPessoaId(null)
          setDrawerDocId(docId)
        }}
      />

      {/* Drawer do documento */}
      <DocumentoOperationalDrawer
        documentoId={drawerDocId}
        isOpen={drawerDocId !== null}
        onClose={() => {
          setDrawerDocId(null)
          setVoltarParaPessoa(null)
        }}
        onSave={() => carregar(true)}
        onBack={
          voltarParaPessoa
            ? () => {
                const p = voltarParaPessoa
                setDrawerDocId(null)
                setDrawerPessoaId(p.id)
              }
            : undefined
        }
        backLabel={voltarParaPessoa?.nome}
      />
    </>
  )
}