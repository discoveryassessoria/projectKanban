"use client"

// src/components/arvore/importar-arvore-modal.tsx
// ============================================================================
// IMPORTAR ÁRVORE POR IMAGEM — upload → prévia → gravação.
//
// A prévia NÃO é confirmação decorativa: o que o operador vê aqui é o que vai
// para o banco. Ele pode remover pessoas antes de gravar, e a lista enviada na
// confirmação é a lista revisada — não a original lida da imagem.
//
// Se `ANTHROPIC_API_KEY` não estiver configurada no ambiente, a rota devolve
// 501 com `codigo: EXTRACAO_NAO_IMPLEMENTADA` e a tela explica isso em vez de
// mostrar erro genérico.
// ============================================================================
import { useState } from "react"
import { X, Upload, Loader2, AlertTriangle, Users, Link2 } from "lucide-react"
import type { ExtracaoArvore, PessoaExtraida } from "@/src/lib/genealogia/importar-arvore/tipos"

/**
 * Fetch autenticado — mesma convenção de `arvore-genealogica-view.tsx` e
 * `requerente-selector.tsx`.
 *
 * NÃO é opcional: `extrairUsuarioKanban` lê o token do header `Authorization`,
 * nunca de cookie. Um `fetch` puro sai sem credencial nenhuma e a rota responde
 * 401 antes de olhar permissão — que foi exatamente o bug aqui. O sintoma engana
 * porque parece falta de permissão, mas permissão negada seria 403.
 */
function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

interface Props {
  arvoreId: number
  aberto: boolean
  onFechar: () => void
  /** Chamado após gravar, para a árvore recarregar. */
  onImportado?: () => void
}

type Etapa = "upload" | "analisando" | "previa" | "gravando"

const LIMITE_MB = 8

export function ImportarArvoreModal({ arvoreId, aberto, onFechar, onImportado }: Props) {
  const [etapa, setEtapa] = useState<Etapa>("upload")
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [textoComplementar, setTextoComplementar] = useState("")
  const [extracao, setExtracao] = useState<ExtracaoArvore | null>(null)
  const [removidas, setRemovidas] = useState<Set<string>>(new Set())
  const [erro, setErro] = useState<string | null>(null)
  const [naoImplementado, setNaoImplementado] = useState(false)

  if (!aberto) return null

  function reiniciar() {
    setEtapa("upload"); setArquivo(null); setPreviewUrl(null); setTextoComplementar("")
    setExtracao(null); setRemovidas(new Set()); setErro(null); setNaoImplementado(false)
  }

  function fechar() { reiniciar(); onFechar() }

  function escolherArquivo(f: File | null) {
    setErro(null); setNaoImplementado(false)
    if (!f) return
    if (!/^image\/(png|jpe?g|webp)$/i.test(f.type)) {
      setErro("Formato aceito: PNG, JPEG ou WebP."); return
    }
    if (f.size > LIMITE_MB * 1024 * 1024) {
      setErro(`Imagem acima de ${LIMITE_MB} MB. Reduza antes de enviar.`); return
    }
    setArquivo(f)
    setPreviewUrl(URL.createObjectURL(f))
  }

  /** File → base64 puro (sem o prefixo `data:...;base64,`). */
  function lerBase64(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result).split(",")[1] ?? "")
      r.onerror = () => reject(new Error("Não consegui ler o arquivo"))
      r.readAsDataURL(f)
    })
  }

  async function analisar() {
    if (!arquivo) return
    setEtapa("analisando"); setErro(null); setNaoImplementado(false)
    try {
      const imagemBase64 = await lerBase64(arquivo)
      const res = await authFetch("/api/genealogy/arvore/importar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          acao: "analisar", arvoreId, imagemBase64, mimeType: arquivo.type,
          textoComplementar: textoComplementar.trim() || null,
        }),
      })
      const dados = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (dados?.codigo === "EXTRACAO_NAO_IMPLEMENTADA") setNaoImplementado(true)
        setErro(dados?.error ?? "Falha ao analisar a imagem.")
        setEtapa("upload"); return
      }
      setExtracao(dados.extracao as ExtracaoArvore)
      setEtapa("previa")
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao analisar a imagem.")
      setEtapa("upload")
    }
  }

  async function confirmar() {
    if (!extracao) return
    setEtapa("gravando"); setErro(null)
    // Só o que sobrou na prévia. Vínculos que apontam para pessoa removida
    // caem junto — senão o banco receberia paiRef órfão.
    const pessoas = extracao.pessoas.filter((p) => !removidas.has(p.ref))
    const vivos = new Set(pessoas.map((p) => p.ref))
    const limpas: PessoaExtraida[] = pessoas.map((p) => ({
      ...p,
      paiRef: p.paiRef && vivos.has(p.paiRef) ? p.paiRef : null,
      maeRef: p.maeRef && vivos.has(p.maeRef) ? p.maeRef : null,
    }))
    const unioes = extracao.unioes.filter((u) => vivos.has(u.pessoa1Ref) && vivos.has(u.pessoa2Ref))

    try {
      const res = await authFetch("/api/genealogy/arvore/importar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acao: "confirmar", arvoreId, extracao: { ...extracao, pessoas: limpas, unioes } }),
      })
      const dados = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(dados?.error ?? "Falha ao gravar."); setEtapa("previa"); return }
      onImportado?.()
      fechar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gravar.")
      setEtapa("previa")
    }
  }

  const restantes = extracao ? extracao.pessoas.filter((p) => !removidas.has(p.ref)) : []
  const ocupado = etapa === "analisando" || etapa === "gravando"
  // "gravando" é a prévia com o botão em curso — não é uma tela à parte. Sem
  // isto o rodapé voltava a oferecer "Analisar" no meio da gravação.
  const naPrevia = etapa === "previa" || etapa === "gravando"

  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-[var(--overlay-modal)] p-4">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-popover)] text-white/95 shadow-[var(--elev-3)]">
        <header className="flex flex-shrink-0 items-center justify-between border-b border-[var(--border-default)] px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Importar Árvore</h2>
            <p className="text-sm text-white/70">Envie o print de uma árvore já montada — os cards são transcritos automaticamente.</p>
          </div>
          <button onClick={fechar} disabled={ocupado} className="rounded p-1 text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-white disabled:opacity-40" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {erro && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-700" />
              <div>
                <p className="text-red-700">{erro}</p>
                {naoImplementado && (
                  <p className="mt-1 text-red-700/70">
                    A leitura por IA ainda não foi ligada neste ambiente. O restante do fluxo já funciona —
                    a prévia e a gravação podem ser exercitadas com <code className="rounded bg-black/30 px-1">IMPORTAR_ARVORE_MOCK=1</code>.
                  </p>
                )}
              </div>
            </div>
          )}

          {(etapa === "upload" || etapa === "analisando") && (
            <div className="space-y-5">
              <div>
                <label className="mb-2 block text-sm font-medium">Print da árvore <span className="text-red-700">*</span></label>
                <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-popover)] px-6 py-10 text-center transition hover:border-[var(--border-strong)]">
                  {previewUrl ? (
                    // <img> e não next/image: a origem é um blob: URL local do
                    // arquivo escolhido, que o otimizador do Next não processa.
                    <img src={previewUrl} alt="Prévia do print enviado" className="max-h-56 rounded-lg object-contain" />
                  ) : (
                    <>
                      <Upload className="h-8 w-8 text-[var(--text-muted)]" />
                      <span className="text-sm text-white/70">Clique para escolher uma imagem</span>
                      <span className="text-xs text-[var(--text-secondary)]">PNG, JPEG ou WebP · até {LIMITE_MB} MB</span>
                    </>
                  )}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                    onChange={(e) => escolherArquivo(e.target.files?.[0] ?? null)} disabled={ocupado} />
                </label>
                {arquivo && <p className="mt-2 text-xs text-[var(--text-secondary)]">{arquivo.name} · {(arquivo.size / 1024 / 1024).toFixed(1)} MB</p>}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Texto complementar <span className="font-normal text-[var(--text-secondary)]">(opcional)</span>
                </label>
                <textarea value={textoComplementar} onChange={(e) => setTextoComplementar(e.target.value)}
                  disabled={ocupado} rows={4}
                  placeholder="Lista ou resumo escrito para desambiguar o que ficar cortado ou pouco legível na imagem."
                  className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] px-3 py-2 text-sm placeholder:text-[var(--text-muted)] focus:border-white/30 focus:outline-none" />
              </div>
            </div>
          )}

          {etapa === "previa" && extracao && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1.5"><Users className="h-4 w-4 text-[var(--text-secondary)]" />{restantes.length} pessoa(s)</span>
                <span className="flex items-center gap-1.5"><Link2 className="h-4 w-4 text-[var(--text-secondary)]" />{extracao.unioes.length} união(ões)</span>
              </div>

              {extracao.avisos.length > 0 && (
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3 text-sm text-amber-700">
                  <p className="mb-1 font-medium">Pontos de atenção da leitura</p>
                  <ul className="list-inside list-disc space-y-0.5 text-amber-700/80">
                    {extracao.avisos.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}

              <div className="divide-y divide-white/10 overflow-hidden rounded-lg border border-[var(--border-default)]">
                {extracao.pessoas.map((p) => {
                  const fora = removidas.has(p.ref)
                  const pai = extracao.pessoas.find((x) => x.ref === p.paiRef)
                  const mae = extracao.pessoas.find((x) => x.ref === p.maeRef)
                  return (
                    <div key={p.ref} className={`flex items-start justify-between gap-4 px-4 py-3 ${fora ? "opacity-40" : ""}`}>
                      <div className="min-w-0">
                        <p className="font-medium">
                          {p.nome} {p.sobrenome ?? ""}
                          {p.numeroLinhagem != null && <span className="ml-2 rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[11px] text-white/70">linhagem {p.numeroLinhagem}</span>}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                          {[p.sexo, p.data_nasc && `nasc. ${p.data_nasc}`, [p.local_nasc, p.pais_nasc].filter(Boolean).join(", "),
                            p.data_obito && `fal. ${p.data_obito}`, p.nacionalidade].filter(Boolean).join(" · ") || "sem dados adicionais"}
                        </p>
                        {(pai || mae) && (
                          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                            filho(a) de {[pai && `${pai.nome} ${pai.sobrenome ?? ""}`.trim(), mae && `${mae.nome} ${mae.sobrenome ?? ""}`.trim()].filter(Boolean).join(" e ")}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => setRemovidas((s) => { const n = new Set(s); n.has(p.ref) ? n.delete(p.ref) : n.add(p.ref); return n })}
                        className="flex-shrink-0 rounded border border-[var(--border-default)] px-2 py-1 text-xs text-white/70 transition hover:bg-[var(--surface-hover)]">
                        {fora ? "Incluir" : "Remover"}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <footer className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-[var(--border-default)] px-6 py-4">
          <p className="text-xs text-[var(--text-secondary)]">
            {naPrevia ? "Nada foi gravado ainda — confira antes de confirmar." : "A imagem é lida no servidor; nada é gravado nesta etapa."}
          </p>
          <div className="flex items-center gap-2">
            {naPrevia && (
              <button onClick={() => setEtapa("upload")} disabled={ocupado} className="rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm text-white/80 transition hover:bg-[var(--surface-hover)]">Voltar</button>
            )}
            <button onClick={fechar} disabled={ocupado}
              className="rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm text-white/80 transition hover:bg-[var(--surface-hover)] disabled:opacity-40">Cancelar</button>
            {!naPrevia ? (
              <button onClick={analisar} disabled={!arquivo || ocupado}
                className="flex items-center gap-2 rounded-lg bg-[var(--surface-elevated)] px-4 py-2 text-sm font-medium text-black transition hover:bg-[var(--surface-primary)] disabled:opacity-40">
                {etapa === "analisando" && <Loader2 className="h-4 w-4 animate-spin" />}
                {etapa === "analisando" ? "Lendo a imagem…" : "Analisar"}
              </button>
            ) : (
              <button onClick={confirmar} disabled={ocupado || restantes.length === 0}
                className="flex items-center gap-2 rounded-lg bg-[var(--surface-elevated)] px-4 py-2 text-sm font-medium text-black transition hover:bg-[var(--surface-primary)] disabled:opacity-40">
                {etapa === "gravando" && <Loader2 className="h-4 w-4 animate-spin" />}
                {etapa === "gravando" ? "Gravando…" : `Confirmar e criar ${restantes.length}`}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
