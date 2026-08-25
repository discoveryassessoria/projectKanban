"use client"

// REPOSITÓRIO OFICIAL DE MODELOS DOCUMENTAIS — Sistema › Modelos.
//
// Substitui o cadastro genérico de "modelos de texto" que guardava o conteúdo
// numa coluna do banco. O texto jurídico agora vive no DOCX versionado; esta
// tela administra IDENTIDADE, VERSÕES e ESTADO — nunca o texto.
//
// A tela não conhece "Procuração Judicial" por nome: ela lista o que existe no
// repositório. Um modelo novo aparece aqui sem tocar nesta linha de código.

import { useState } from "react"
import { useApi } from "@/src/lib/dados"

type StatusVersao = "RASCUNHO" | "PUBLICADA" | "REVOGADA"

interface Versao {
  id: number
  numero: number
  status: StatusVersao
  checksum: string
  arquivoNome: string
  criadoEm: string
  publicadoEm: string | null
  observacao: string | null
  placeholders: string[]
  obrigatorios: string[]
  opcionais: string[]
  dadosFixosDeclarados: string[] | null
  criadoPor?: { id: number; nome: string } | null
  publicadoPor?: { id: number; nome: string } | null
  _count?: { geracoes: number }
}

interface Modelo {
  id: number
  codigo: string
  nome: string
  descricao: string | null
  categoria: string
  ativo: boolean
  documentType: { id: number; name: string; publicCode: string | null }
  versaoPublicada: { id: number; numero: number; publicadoEm: string | null } | null
  totalVersoes: number
  ultimaPublicacao: string | null
  versoes?: Versao[]
}

interface Variavel {
  chave: string
  rotulo: string
  campo: string
  exigidaQuandoUsada: boolean
  descricao: string
}

interface Achado {
  codigo: string
  severidade: "erro" | "aviso"
  mensagem: string
  detalhe?: string
}

interface Validacao {
  ok: boolean
  achados: Achado[]
  placeholders: string[]
  obrigatorios: string[]
  opcionais: string[]
  literais: Array<{ tipo: string; valor: string; digitos: string }>
  naoDeclarados: Array<{ tipo: string; valor: string; digitos: string }>
}

const CATEGORIAS = [
  "PROCURACAO", "CONTRATO", "DECLARACAO", "REQUERIMENTO",
  "FORMULARIO", "AUTORIZACAO", "NOTIFICACAO", "OUTRO",
] as const

const ROTULO_CATEGORIA: Record<string, string> = {
  PROCURACAO: "Procuração", CONTRATO: "Contrato", DECLARACAO: "Declaração",
  REQUERIMENTO: "Requerimento", FORMULARIO: "Formulário", AUTORIZACAO: "Autorização",
  NOTIFICACAO: "Notificação", OUTRO: "Outro",
}

function authHeaders(json = true): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  const base: Record<string, string> = json ? { "Content-Type": "application/json" } : {}
  if (t) base.Authorization = `Bearer ${t}`
  return base
}

const inputCls =
  "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-[var(--action-primary-ink)] placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-[var(--action-primary-ink)]/60"

const SEM_ITENS: never[] = Object.freeze([]) as never[]

const CORES_STATUS: Record<StatusVersao, string> = {
  RASCUNHO: "bg-amber-50 text-amber-700",
  PUBLICADA: "bg-green-50 text-green-700",
  REVOGADA: "bg-[var(--surface-primary)] text-[var(--action-primary-ink)]/50",
}

export default function ModelosDocumentaisTab() {
  const [flash, setFlash] = useState("")
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<Partial<Modelo> | null>(null)
  const [abertoId, setAbertoId] = useState<number | null>(null)

  const lista = useApi<{ modelos: Modelo[]; variaveis: Variavel[] }>("/api/gerenciamento/modelos")
  const tipos = useApi<{ tipos?: Array<{ id: number; name: string; publicCode: string | null }> }>(
    "/api/gerenciamento/tipos-documento",
  )
  const modelos = lista.dados?.modelos ?? SEM_ITENS
  const variaveis = lista.dados?.variaveis ?? SEM_ITENS

  const aviso = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 4000) }

  async function salvar() {
    if (!form?.nome?.trim() || !form?.codigo?.trim() || !form?.documentType?.id) {
      aviso("Código, nome e tipo documental são obrigatórios.")
      return
    }
    setBusy(true)
    try {
      const url = form.id ? `/api/gerenciamento/modelos/${form.id}` : "/api/gerenciamento/modelos"
      const res = await fetch(url, {
        method: form.id ? "PUT" : "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          codigo: form.codigo,
          nome: form.nome,
          descricao: form.descricao ?? null,
          categoria: form.categoria ?? "OUTRO",
          documentTypeId: form.documentType.id,
          ativo: form.ativo ?? true,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok) { setForm(null); aviso("Modelo salvo."); void lista.recarregar() }
      else aviso(j.error || "Erro ao salvar.")
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      {flash && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-100">{flash}</div>
      )}

      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-5 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Modelos</h2>
            <p className="mt-1 max-w-3xl text-sm text-[var(--text-secondary)]">
              Repositório oficial dos <strong className="text-[var(--text-secondary)]">templates</strong> do sistema.
              O modelo não é um documento: é o molde. O texto oficial mora dentro do DOCX
              versionado — o banco guarda identidade, versão, checksum e autoria.
              Todo documento inteligente do Discovery é gerado a partir daqui.
            </p>
          </div>
          <button
            onClick={() => setForm({ codigo: "", nome: "", descricao: "", categoria: "PROCURACAO", ativo: true })}
            className="flex-none rounded-lg bg-[var(--action-primary)] px-3 py-2 text-xs font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)]"
          >
            + Novo modelo
          </button>
        </div>
      </div>

      {lista.erro && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Falha ao carregar os modelos.
          <button onClick={() => void lista.recarregar()} className="ml-2 underline">Tentar novamente</button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Código</th>
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">Categoria</th>
              <th className="px-4 py-3 font-medium">Tipo documental</th>
              <th className="px-4 py-3 font-medium">Versão publicada</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Última publicação</th>
              <th className="px-4 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {lista.carregando ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">Carregando…</td></tr>
            ) : modelos.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">Nenhum modelo cadastrado.</td></tr>
            ) : modelos.map((m) => (
              <tr key={m.id} className="border-b border-[var(--border-subtle)] last:border-0">
                <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">{m.codigo}</td>
                <td className="px-4 py-2.5 text-[var(--text-primary)]">{m.nome}</td>
                <td className="px-4 py-2.5 text-[var(--text-secondary)]">{ROTULO_CATEGORIA[m.categoria] ?? m.categoria}</td>
                <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                  {m.documentType.name}
                  {m.documentType.publicCode && (
                    <span className="ml-1.5 rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[9px] text-[var(--text-muted)]">{m.documentType.publicCode}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                  {m.versaoPublicada ? `v${m.versaoPublicada.numero}` : <span className="text-amber-700/80">nenhuma</span>}
                  <span className="ml-1 text-[var(--text-muted)]">de {m.totalVersoes}</span>
                </td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${m.ativo ? "bg-green-50 text-green-700" : "bg-[var(--surface-primary)] text-[var(--action-primary-ink)]/50"}`}>
                    {m.ativo ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-[var(--text-muted)]">
                  {m.ultimaPublicacao ? new Date(m.ultimaPublicacao).toLocaleDateString("pt-BR") : "—"}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-1 text-xs text-[var(--text-muted)]">
                    <button onClick={() => setAbertoId(m.id)} className="rounded px-1.5 py-0.5 hover:bg-[var(--surface-hover)] hover:text-[var(--action-primary-ink)]">Versões</button>
                    <button onClick={() => setForm(m)} className="rounded px-1.5 py-0.5 hover:bg-[var(--surface-hover)] hover:text-[var(--action-primary-ink)]">Editar</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {variaveis.length > 0 && (
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-5 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Variáveis reconhecidas</h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Use estas chaves entre chaves duplas dentro do DOCX. Qualquer outra reprova a publicação.
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {variaveis.map((v) => (
              <div key={v.chave} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2">
                <code className="text-[11px] text-blue-700">{`{{${v.chave}}}`}</code>
                <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{v.rotulo}</div>
                <div className="text-[10px] text-[var(--text-muted)]">
                  {v.exigidaQuandoUsada ? "Obrigatória quando usada" : "Opcional"} · cadastro: {v.campo}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {form && (
        <FormularioModelo
          form={form}
          setForm={setForm}
          salvar={salvar}
          busy={busy}
          tipos={tipos.dados?.tipos ?? SEM_ITENS}
        />
      )}

      {abertoId != null && (
        <PainelVersoes
          modeloId={abertoId}
          fechar={() => { setAbertoId(null); void lista.recarregar() }}
          aviso={aviso}
        />
      )}
    </div>
  )
}

function FormularioModelo({
  form, setForm, salvar, busy, tipos,
}: {
  form: Partial<Modelo>
  setForm: (f: Partial<Modelo> | null) => void
  salvar: () => void
  busy: boolean
  tipos: Array<{ id: number; name: string; publicCode: string | null }>
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm" onClick={() => setForm(null)}>
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-[var(--border-default)] px-6 py-4">
          <h3 className="font-semibold text-[var(--text-primary)]">{form.id ? "Editar" : "Novo"} modelo</h3>
        </div>
        <div className="space-y-3 px-6 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Código *</label>
              <input value={form.codigo ?? ""} onChange={(e) => setForm({ ...form, codigo: e.target.value })} className={inputCls} placeholder="PROC-JUD" />
            </div>
            <div>
              <label className={labelCls}>Categoria *</label>
              <select value={form.categoria ?? "OUTRO"} onChange={(e) => setForm({ ...form, categoria: e.target.value })} className={inputCls}>
                {CATEGORIAS.map((c) => <option key={c} value={c} className="bg-zinc-900">{ROTULO_CATEGORIA[c]}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Nome *</label>
            <input value={form.nome ?? ""} onChange={(e) => setForm({ ...form, nome: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Descrição</label>
            <input value={form.descricao ?? ""} onChange={(e) => setForm({ ...form, descricao: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Tipo documental (Cadastro Mestre) *</label>
            <select
              value={form.documentType?.id ?? ""}
              onChange={(e) => {
                const t = tipos.find((x) => x.id === Number(e.target.value))
                setForm({ ...form, documentType: t ?? undefined })
              }}
              className={inputCls}
            >
              <option value="" className="bg-zinc-900">Selecione…</option>
              {tipos.map((t) => (
                <option key={t.id} value={t.id} className="bg-zinc-900">
                  {t.publicCode ? `${t.publicCode} — ` : ""}{t.name}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" checked={form.ativo ?? true} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
            Ativo
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border-default)] px-6 py-4">
          <button onClick={() => setForm(null)} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">Cancelar</button>
          <button disabled={busy} onClick={salvar} className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)] disabled:opacity-50">Salvar</button>
        </div>
      </div>
    </div>
  )
}

function PainelVersoes({
  modeloId, fechar, aviso,
}: {
  modeloId: number
  fechar: () => void
  aviso: (m: string) => void
}) {
  const detalhe = useApi<{ modelo: Modelo }>(`/api/gerenciamento/modelos/${modeloId}`)
  const modelo = detalhe.dados?.modelo
  const [busy, setBusy] = useState(false)
  const [validacao, setValidacao] = useState<{ versaoId: number; resultado: Validacao } | null>(null)
  const [declarados, setDeclarados] = useState<Record<number, string[]>>({})

  async function enviarDocx(arquivo: File) {
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append("arquivo", arquivo)
      const res = await fetch(`/api/gerenciamento/modelos/${modeloId}/versoes`, {
        method: "POST",
        headers: authHeaders(false),
        body: fd,
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok) { aviso("Versão criada em rascunho."); void detalhe.recarregar() }
      else aviso(j.error || "Não foi possível criar a versão.")
    } finally { setBusy(false) }
  }

  async function agir(versaoId: number, acao: "validar" | "publicar" | "revogar") {
    setBusy(true)
    try {
      const res = await fetch(`/api/gerenciamento/modelos/${modeloId}/versoes/${versaoId}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ acao, dadosFixosDeclarados: declarados[versaoId] }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        aviso(j.error || "Ação recusada.")
        if (Array.isArray(j.detalhe)) {
          setValidacao({
            versaoId,
            resultado: { ok: false, achados: j.detalhe as Achado[], placeholders: [], obrigatorios: [], opcionais: [], literais: [], naoDeclarados: [] },
          })
        }
        return
      }
      if (acao === "validar") setValidacao({ versaoId, resultado: j.validacao as Validacao })
      else { aviso(acao === "publicar" ? "Versão publicada." : "Versão revogada."); void detalhe.recarregar() }
    } finally { setBusy(false) }
  }

  async function baixar(versaoId: number) {
    const res = await fetch(`/api/gerenciamento/modelos/${modeloId}/versoes/${versaoId}?acao=arquivo`, {
      headers: authHeaders(false),
    })
    const j = await res.json().catch(() => ({}))
    if (res.ok && j.url) window.open(j.url, "_blank", "noopener")
    else aviso("Não foi possível gerar o link do arquivo.")
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--overlay-modal)] p-4 backdrop-blur-sm" onClick={fechar}>
      <div className="my-8 w-full max-w-5xl rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-[var(--border-default)] px-6 py-4">
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">{modelo?.nome ?? "Modelo"}</h3>
            <p className="text-xs text-[var(--text-muted)]">
              {modelo?.codigo} · {modelo ? (ROTULO_CATEGORIA[modelo.categoria] ?? modelo.categoria) : ""} ·{" "}
              {modelo?.documentType.name}
            </p>
          </div>
          <button onClick={fechar} className="rounded px-2 py-1 text-[var(--action-primary-ink)]/50 hover:bg-[var(--surface-hover)] hover:text-white">Fechar</button>
        </div>

        <div className="border-b border-[var(--border-default)] px-6 py-4">
          <label className={labelCls}>Nova versão (DOCX)</label>
          <input
            type="file"
            accept=".docx"
            disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void enviarDocx(f); e.target.value = "" }}
            className="text-xs text-[var(--action-primary-ink)]/70 file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--action-primary)] file:px-3 file:py-1.5 file:text-xs file:text-[var(--action-primary-ink)] hover:file:bg-[var(--action-primary)]"
          />
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            A versão nasce em rascunho. Publicada nunca é editada — alteração de redação exige versão nova.
          </p>
        </div>

        <div className="px-6 py-4">
          {detalhe.carregando ? (
            <div className="py-8 text-center text-xs text-[var(--text-muted)]">Carregando…</div>
          ) : !modelo?.versoes?.length ? (
            <div className="py-8 text-center text-xs text-[var(--text-muted)]">Nenhuma versão enviada.</div>
          ) : (
            <div className="space-y-3">
              {modelo.versoes.map((v) => (
                <div key={v.id} className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--text-primary)]">Versão {v.numero}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${CORES_STATUS[v.status]}`}>{v.status}</span>
                      {(v._count?.geracoes ?? 0) > 0 && (
                        <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                          {v._count!.geracoes} documento(s) gerado(s)
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                      <button onClick={() => void baixar(v.id)} className="rounded px-1.5 py-0.5 hover:bg-[var(--surface-hover)] hover:text-[var(--action-primary-ink)]">Baixar</button>
                      <button disabled={busy} onClick={() => void agir(v.id, "validar")} className="rounded px-1.5 py-0.5 hover:bg-[var(--surface-hover)] hover:text-[var(--action-primary-ink)] disabled:opacity-40">Validar</button>
                      {v.status === "RASCUNHO" && (
                        <button disabled={busy} onClick={() => void agir(v.id, "publicar")} className="rounded bg-green-600/80 px-2 py-0.5 text-[var(--action-primary-ink)] hover:bg-green-800 disabled:opacity-40">Publicar</button>
                      )}
                      {v.status !== "REVOGADA" && (
                        <button disabled={busy} onClick={() => void agir(v.id, "revogar")} className="rounded px-1.5 py-0.5 text-red-700/70 hover:bg-red-50 hover:text-red-700 disabled:opacity-40">Revogar</button>
                      )}
                    </div>
                  </div>

                  <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-[var(--text-muted)] sm:grid-cols-2 lg:grid-cols-4">
                    <div><dt className="inline text-[var(--text-muted)]">Arquivo: </dt><dd className="inline text-white/70">{v.arquivoNome}</dd></div>
                    <div><dt className="inline text-[var(--text-muted)]">Criada: </dt><dd className="inline text-white/70">{new Date(v.criadoEm).toLocaleString("pt-BR")}</dd></div>
                    <div><dt className="inline text-[var(--text-muted)]">Autor: </dt><dd className="inline text-white/70">{v.criadoPor?.nome ?? "—"}</dd></div>
                    <div><dt className="inline text-[var(--text-muted)]">Publicada: </dt><dd className="inline text-white/70">{v.publicadoEm ? `${new Date(v.publicadoEm).toLocaleString("pt-BR")} · ${v.publicadoPor?.nome ?? "—"}` : "—"}</dd></div>
                    <div className="sm:col-span-2 lg:col-span-4">
                      <dt className="inline text-[var(--text-muted)]">Checksum: </dt>
                      <dd className="inline break-all font-mono text-[10px] text-[var(--text-secondary)]">{v.checksum}</dd>
                    </div>
                  </dl>

                  <div className="mt-3 flex flex-wrap gap-1">
                    {(v.placeholders ?? []).map((p) => (
                      <span
                        key={p}
                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                          (v.obrigatorios ?? []).includes(p) ? "bg-blue-50 text-blue-700" : "bg-[var(--surface-primary)] text-[var(--action-primary-ink)]/50"
                        }`}
                      >
                        {p}
                      </span>
                    ))}
                  </div>

                  {validacao?.versaoId === v.id && (
                    <div className="mt-3 rounded-lg border border-[var(--border-default)] bg-black/30 p-3">
                      <div className={`text-xs font-medium ${validacao.resultado.ok ? "text-green-700" : "text-red-700"}`}>
                        {validacao.resultado.ok ? "Validação aprovada — pode publicar." : "Validação reprovada."}
                      </div>
                      <ul className="mt-2 space-y-1 text-[11px] text-[var(--text-secondary)]">
                        {validacao.resultado.achados.map((a, i) => (
                          <li key={i}>
                            <span className={a.severidade === "erro" ? "text-red-700" : "text-amber-700"}>■</span>{" "}
                            {a.mensagem} {a.detalhe && <span className="text-[var(--text-muted)]">{a.detalhe}</span>}
                          </li>
                        ))}
                        {validacao.resultado.achados.length === 0 && <li className="text-[var(--text-muted)]">Nenhum achado.</li>}
                      </ul>

                      {validacao.resultado.naoDeclarados.length > 0 && (
                        <div className="mt-3">
                          <p className="text-[11px] text-[var(--text-muted)]">
                            Confirme quais números são <strong className="text-[var(--text-secondary)]">dados fixos do outorgado</strong> e
                            devem permanecer no texto:
                          </p>
                          <div className="mt-1 space-y-1">
                            {validacao.resultado.naoDeclarados.map((l) => {
                              const marcado = (declarados[v.id] ?? []).includes(l.digitos)
                              return (
                                <label key={l.digitos} className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                                  <input
                                    type="checkbox"
                                    checked={marcado}
                                    onChange={(e) =>
                                      setDeclarados((d) => ({
                                        ...d,
                                        [v.id]: e.target.checked
                                          ? [...(d[v.id] ?? []), l.digitos]
                                          : (d[v.id] ?? []).filter((x) => x !== l.digitos),
                                      }))
                                    }
                                  />
                                  <span className="uppercase text-[var(--text-muted)]">{l.tipo}</span> {l.valor}
                                </label>
                              )
                            })}
                          </div>
                          <button
                            disabled={busy}
                            onClick={() => void agir(v.id, "validar")}
                            className="mt-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-40"
                          >
                            Revalidar com as declarações
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
