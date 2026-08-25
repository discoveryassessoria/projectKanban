"use client"

// PROCURAÇÕES — geração de documento a partir de modelo publicado, no cadastro
// do cliente.
//
// Uma tela, um gerador. A mesma tela é usada pela ação "Gerar procuração" dentro
// do processo (só muda o que vem pré-preenchido). Ela não conhece o texto de
// nenhum documento e não sabe o nome de nenhum modelo: pergunta ao repositório
// o que está publicado e mostra o que voltar.

import { useMemo, useState } from "react"
import { useApi } from "@/src/lib/dados"
import {
  FileText, Download, Eye, Loader2, AlertTriangle, CheckCircle2, XCircle, MinusCircle, Link2, Ban,
} from "lucide-react"

export interface ModeloDisponivel {
  id: number
  codigo: string
  nome: string
  descricao: string | null
  categoria: string
  documentType: { id: number; name: string; publicCode: string | null }
  versaoPublicada: { id: number; numero: number; publicadoEm: string | null } | null
}

interface ItemChecklist {
  chave: string
  rotulo: string
  estado: "valido" | "ausente" | "invalido" | "nao_aplicavel"
  valor: string
  origem: string
  motivo?: string
}

interface VersaoGerada {
  id: number
  numero: number
  status: "GERADA" | "VIGENTE" | "SUBSTITUIDA" | "INVALIDADA"
  geradoEm: string
  docxNome: string
  pdfNome: string
  docxChecksum: string
  pdfChecksum: string
  motivoInvalidacao: string | null
  geradoPor?: { id: number; nome: string } | null
  modeloVersao: { id: number; numero: number; checksum: string }
}

interface DocumentoGerado {
  id: number
  status: "VIGENTE" | "INVALIDADO"
  createdAt: string
  modelo: { id: number; codigo: string; nome: string; categoria: string }
  documentType: { id: number; name: string; publicCode: string | null }
  contratante: { id: number; nome: string; publicCode: string | null } | null
  requerente: { id: number; nome: string; publicCode: string | null } | null
  processo: { id: number; codigo: string | null; nome: string; pais: string } | null
  criadoPor?: { id: number; nome: string } | null
  versoes: VersaoGerada[]
}

export interface DocumentosGeradosTabProps {
  papel: "contratante" | "requerente"
  clienteId: number
  clienteNome: string
  /** Processo sugerido (a ação dentro do processo já chega com ele). */
  processoIdInicial?: number | null
  /** Processos do cliente, para a seleção. */
  processos?: Array<{ id: number; codigo?: string | null; nome?: string; pais?: string }>
  /** Modelo sugerido pela origem da ação. */
  modeloIdInicial?: number | null
  podeGerar?: boolean
}

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t
    ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` }
    : { "Content-Type": "application/json" }
}

function hoje(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const ICONE_ESTADO = {
  valido: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
  ausente: <XCircle className="h-4 w-4 text-red-500" />,
  invalido: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  nao_aplicavel: <MinusCircle className="h-4 w-4 text-gray-300" />,
}

/** Identidade estável para ausência de dados — evita recomputar memos a cada render. */
const SEM_MODELOS: ModeloDisponivel[] = []
const SEM_DOCUMENTOS: DocumentoGerado[] = []

const CORES_VERSAO: Record<VersaoGerada["status"], string> = {
  VIGENTE: "bg-emerald-100 text-emerald-700",
  GERADA: "bg-blue-100 text-blue-700",
  SUBSTITUIDA: "bg-gray-100 text-gray-600",
  INVALIDADA: "bg-red-100 text-red-700",
}

export function DocumentosGeradosTab({
  papel,
  clienteId,
  clienteNome,
  processoIdInicial = null,
  processos = [],
  modeloIdInicial = null,
  podeGerar = true,
}: DocumentosGeradosTabProps) {
  // Camada oficial de dados: cache, deduplicação e estados derivados. Sem
  // `setState` em efeito de montagem — quem guarda o estado é o cache.
  const consultaModelos = useApi<{ modelos: ModeloDisponivel[] }>("/api/documentos-gerados/modelos")
  const consultaDocumentos = useApi<{ documentos: DocumentoGerado[] }>(
    `/api/documentos-gerados?${papel === "contratante" ? "contratanteId" : "requerenteId"}=${clienteId}`,
  )
  const modelos = consultaModelos.dados?.modelos ?? SEM_MODELOS
  const documentos = consultaDocumentos.dados?.documentos ?? SEM_DOCUMENTOS
  const carregando = consultaModelos.carregando || consultaDocumentos.carregando
  const erro =
    consultaModelos.erro || consultaDocumentos.erro
      ? "Não foi possível carregar as procurações deste cliente."
      : ""

  const [flash, setFlash] = useState("")

  const [modeloId, setModeloId] = useState<number | null>(modeloIdInicial)
  const [processoId, setProcessoId] = useState<number | null>(processoIdInicial)
  const [localEmissao, setLocalEmissao] = useState("")
  const [dataEmissao, setDataEmissao] = useState(hoje())

  // O checklist guarda a CHAVE do pedido que o produziu. Trocar de modelo, de
  // processo ou de data muda a chave e o resultado antigo simplesmente deixa de
  // valer — em vez de um efeito limpando estado depois do fato.
  const [checklist, setChecklist] = useState<{
    chave: string
    itens: ItemChecklist[]
    podeGerar: boolean
  } | null>(null)
  const [ocupado, setOcupado] = useState<"validando" | "previa" | "gerando" | null>(null)

  const modeloSelecionado = useMemo(
    () => modelos.find((m) => m.id === modeloId) ?? null,
    [modelos, modeloId],
  )

  const aviso = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 4000) }

  async function carregar() {
    await Promise.all([consultaModelos.recarregar(), consultaDocumentos.recarregar()])
  }

  const pedido = useMemo(
    () => ({
      modeloId,
      outorgantePapel: papel,
      outorganteId: clienteId,
      processoId,
      localEmissao,
      dataEmissao,
    }),
    [modeloId, papel, clienteId, processoId, localEmissao, dataEmissao],
  )
  const chavePedido = JSON.stringify(pedido)
  const corpoDoPedido = () => chavePedido

  // Checklist só vale para o pedido que o gerou.
  const checklistAtual = checklist?.chave === chavePedido ? checklist : null
  const podeGerarAgora = checklistAtual?.podeGerar ?? false

  const camposPreenchidos = modeloId != null && localEmissao.trim() !== "" && dataEmissao !== ""

  async function validar() {
    if (!camposPreenchidos) { aviso("Selecione o tipo, a cidade e a data da emissão."); return }
    setOcupado("validando")
    try {
      const res = await fetch("/api/documentos-gerados/validar", {
        method: "POST", headers: authHeaders(), body: corpoDoPedido(),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { aviso(j.error || "Não foi possível validar."); setChecklist(null); return }
      setChecklist({ chave: chavePedido, itens: j.checklist ?? [], podeGerar: Boolean(j.podeGerar) })
    } finally { setOcupado(null) }
  }

  async function previa() {
    if (!camposPreenchidos) { aviso("Selecione o tipo, a cidade e a data da emissão."); return }
    setOcupado("previa")
    try {
      const res = await fetch("/api/documentos-gerados/previa", {
        method: "POST", headers: authHeaders(), body: corpoDoPedido(),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        aviso(j.error || "Não foi possível gerar a prévia.")
        if (Array.isArray(j.detalhe)) {
          setChecklist({ chave: chavePedido, itens: j.detalhe as ItemChecklist[], podeGerar: false })
        }
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank", "noopener")
      // A prévia não é documento: o objeto local é descartado logo em seguida.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } finally { setOcupado(null) }
  }

  async function gerar() {
    if (!camposPreenchidos) { aviso("Selecione o tipo, a cidade e a data da emissão."); return }
    if (ocupado) return
    setOcupado("gerando")
    try {
      const res = await fetch("/api/documentos-gerados", {
        method: "POST", headers: authHeaders(), body: corpoDoPedido(),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        aviso(j.error || "Não foi possível gerar o documento.")
        if (Array.isArray(j.detalhe)) {
          setChecklist({ chave: chavePedido, itens: j.detalhe as ItemChecklist[], podeGerar: false })
        }
        return
      }
      aviso(j.criado ? `Documento gerado (versão ${j.versaoNumero}).` : "Este documento já havia sido gerado.")
      setChecklist(null)
      await carregar()
    } finally { setOcupado(null) }
  }

  async function abrirArquivo(docId: number, versaoId: number, formato: "docx" | "pdf", baixar: boolean) {
    const res = await fetch(
      `/api/documentos-gerados/${docId}/arquivo?versaoId=${versaoId}&formato=${formato}&download=${baixar ? 1 : 0}&redirect=0`,
      { headers: authHeaders() },
    )
    const j = await res.json().catch(() => ({}))
    if (res.ok && j.url) window.open(j.url, "_blank", "noopener")
    else aviso(j.error || "Não foi possível abrir o arquivo.")
  }

  async function vincularProcesso(docId: number, novoProcessoId: number) {
    const res = await fetch(`/api/documentos-gerados/${docId}`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ acao: "vincular-processo", processoId: novoProcessoId }),
    })
    const j = await res.json().catch(() => ({}))
    if (res.ok) { aviso("Vinculado ao processo."); await carregar() }
    else aviso(j.error || "Não foi possível vincular.")
  }

  async function invalidar(docId: number, versaoId: number) {
    const motivo = window.prompt("Motivo da invalidação:")
    if (!motivo?.trim()) return
    const res = await fetch(`/api/documentos-gerados/${docId}`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ acao: "invalidar", versaoId, motivo }),
    })
    const j = await res.json().catch(() => ({}))
    if (res.ok) { aviso("Versão invalidada."); await carregar() }
    else aviso(j.error || "Não foi possível invalidar.")
  }

  return (
    <div className="space-y-6">
      {flash && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">{flash}</div>
      )}

      {/* ── BLOCO 1 — GERAR NOVA PROCURAÇÃO ─────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-[var(--surface-primary)] p-6 shadow-sm">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <FileText className="h-4 w-4 text-indigo-600" />
          Gerar nova procuração
        </h3>

        {modelos.length === 0 && !carregando ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Nenhum modelo publicado. Publique uma versão em Gerenciamento › Sistema › Modelos.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Tipo *</label>
                <select
                  value={modeloId ?? ""}
                  onChange={(e) => setModeloId(e.target.value ? Number(e.target.value) : null)}
                  disabled={!podeGerar}
                  className="w-full rounded-xl border border-gray-300 bg-[var(--surface-primary)] px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
                >
                  <option value="">Selecione…</option>
                  {modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Outorgante</label>
                <input
                  value={clienteNome}
                  readOnly
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Processo relacionado</label>
                <select
                  value={processoId ?? ""}
                  onChange={(e) => setProcessoId(e.target.value ? Number(e.target.value) : null)}
                  disabled={!podeGerar}
                  className="w-full rounded-xl border border-gray-300 bg-[var(--surface-primary)] px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
                >
                  <option value="">Sem processo</option>
                  {processos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.codigo ?? `#${p.id}`}{p.nome ? ` — ${p.nome}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Versão do modelo</label>
                <input
                  value={
                    modeloSelecionado?.versaoPublicada
                      ? `v${modeloSelecionado.versaoPublicada.numero} (publicada)`
                      : "—"
                  }
                  readOnly
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Cidade da emissão *</label>
                <input
                  value={localEmissao}
                  onChange={(e) => setLocalEmissao(e.target.value)}
                  disabled={!podeGerar}
                  placeholder="Amparo"
                  className="w-full rounded-xl border border-gray-300 bg-[var(--surface-primary)] px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Data da emissão *</label>
                <input
                  type="date"
                  value={dataEmissao}
                  onChange={(e) => setDataEmissao(e.target.value)}
                  disabled={!podeGerar}
                  className="w-full rounded-xl border border-gray-300 bg-[var(--surface-primary)] px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
                />
              </div>
            </div>

            {checklistAtual && (
              <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Dados obrigatórios
                  </h4>
                  <span className={`text-xs font-medium ${podeGerarAgora ? "text-emerald-700" : "text-red-600"}`}>
                    {podeGerarAgora ? "Tudo pronto para gerar" : "Há pendências no cadastro"}
                  </span>
                </div>
                <ul className="grid grid-cols-1 gap-1 md:grid-cols-2">
                  {checklistAtual.itens
                    .filter((i) => i.estado !== "nao_aplicavel")
                    .map((i) => (
                      <li key={i.chave} className="flex items-start gap-2 text-sm">
                        {ICONE_ESTADO[i.estado]}
                        <span className="text-gray-700">
                          <span className="font-medium">{i.rotulo}</span>
                          {i.estado === "valido" ? (
                            <span className="text-gray-500"> · {i.valor}</span>
                          ) : (
                            <span className="text-red-600"> · {i.motivo ?? "pendente"}</span>
                          )}
                        </span>
                      </li>
                    ))}
                </ul>
                {!podeGerarAgora && (
                  <p className="mt-2 text-xs text-gray-500">
                    Corrija no cadastro do cliente (abas Dados Pessoais e Endereço) e valide de novo.
                    Nada é gerado com campo em branco.
                  </p>
                )}
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                onClick={() => void validar()}
                disabled={!podeGerar || ocupado != null}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-[var(--surface-primary)] px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {ocupado === "validando" && <Loader2 className="h-4 w-4 animate-spin" />}
                Validar dados
              </button>
              <button
                onClick={() => void previa()}
                disabled={!podeGerar || ocupado != null}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-[var(--surface-primary)] px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {ocupado === "previa" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                Visualizar prévia
              </button>
              <button
                onClick={() => void gerar()}
                disabled={!podeGerar || ocupado != null}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-[#fff] hover:bg-indigo-700 disabled:opacity-50"
              >
                {ocupado === "gerando" && <Loader2 className="h-4 w-4 animate-spin" />}
                Gerar DOCX e PDF
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── BLOCO 2 — DOCUMENTOS GERADOS ────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-[var(--surface-primary)] p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-gray-900">Documentos gerados</h3>

        {carregando ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : erro ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {erro}
            <button onClick={() => void carregar()} className="ml-2 underline">Tentar novamente</button>
          </div>
        ) : documentos.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">
            Nenhuma procuração gerada para este cliente.
          </p>
        ) : (
          <div className="space-y-4">
            {documentos.map((d) => (
              <div key={d.id} className="rounded-xl border border-gray-200">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-4 py-3">
                  <div>
                    <span className="text-sm font-semibold text-gray-900">{d.modelo.nome}</span>
                    <span className="ml-2 text-xs text-gray-500">
                      {d.documentType.publicCode ? `${d.documentType.publicCode} · ` : ""}
                      {d.processo
                        ? `Processo ${d.processo.codigo ?? d.processo.id}`
                        : "sem processo"}
                    </span>
                  </div>
                  {!d.processo && processos.length > 0 && (
                    <select
                      onChange={(e) => e.target.value && void vincularProcesso(d.id, Number(e.target.value))}
                      defaultValue=""
                      className="rounded-lg border border-gray-300 bg-[var(--surface-primary)] px-2 py-1 text-xs text-gray-700"
                    >
                      <option value="">Vincular ao processo…</option>
                      {processos.map((p) => (
                        <option key={p.id} value={p.id}>{p.codigo ?? `#${p.id}`}</option>
                      ))}
                    </select>
                  )}
                </div>

                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-gray-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Versão</th>
                      <th className="px-4 py-2 font-medium">Modelo</th>
                      <th className="px-4 py-2 font-medium">Data</th>
                      <th className="px-4 py-2 font-medium">Gerado por</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 text-right font-medium">Arquivos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.versoes.map((v) => (
                      <tr key={v.id} className="border-t border-gray-100">
                        <td className="px-4 py-2 text-gray-900">v{v.numero}</td>
                        <td className="px-4 py-2 text-gray-600">v{v.modeloVersao.numero}</td>
                        <td className="px-4 py-2 text-gray-600">
                          {new Date(v.geradoEm).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="px-4 py-2 text-gray-600">{v.geradoPor?.nome ?? "—"}</td>
                        <td className="px-4 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] ${CORES_VERSAO[v.status]}`}>
                            {v.status}
                          </span>
                          {v.motivoInvalidacao && (
                            <span className="ml-1 text-[10px] text-gray-400">{v.motivoInvalidacao}</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center justify-end gap-1 text-xs text-gray-500">
                            <button
                              onClick={() => void abrirArquivo(d.id, v.id, "pdf", false)}
                              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-gray-100 hover:text-gray-800"
                            >
                              <Eye className="h-3.5 w-3.5" /> PDF
                            </button>
                            <button
                              onClick={() => void abrirArquivo(d.id, v.id, "docx", true)}
                              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-gray-100 hover:text-gray-800"
                            >
                              <Download className="h-3.5 w-3.5" /> DOCX
                            </button>
                            {v.status !== "INVALIDADA" && (
                              <button
                                onClick={() => void invalidar(d.id, v.id)}
                                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-red-500 hover:bg-red-50"
                              >
                                <Ban className="h-3.5 w-3.5" /> Invalidar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="border-t border-gray-100 px-4 py-2 text-[10px] text-gray-400">
                  <Link2 className="mr-1 inline h-3 w-3" />
                  O mesmo arquivo é referenciado no cliente e no processo — nunca copiado.
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default DocumentosGeradosTab
