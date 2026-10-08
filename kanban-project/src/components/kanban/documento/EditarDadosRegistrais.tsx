// src/components/kanban/documento/EditarDadosRegistrais.tsx
// ============================================================================
// "EDITAR" DA ABA DADOS REGISTRAIS (06/10/2026) — corrige evento, localidade e referência registral de uma certidão em QUALQUER fase. Não reabre o passo, não muda
// a fase, não cancela nada, não reenvia ao cartório. Pede o MOTIVO quando o "Localizar registro" já estava concluído; AVISA se o pedido ao cartório já saiu com os dados
// antigos; quando o valor digitado difere do que a árvore tem, o servidor recusa e pede a escolha explícita (árvore · cadastro · cancelar). Regras e textos: `src/lib/genealogia/dados-registrais-edicao.ts`.
// ============================================================================
"use client"

import { CampoDataTexto } from "@/src/components/ui/campo-data-texto"
import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { Loader2 } from "lucide-react"
import { LAYER } from "@/src/lib/ui/layers"
import { useLocalidade } from "@/lib/localidade/use-localidade"
import { CartorioOrgaoField } from "@/src/components/orgaos/CartorioOrgaoField"
import {
  CAMPOS_EDITAVEIS, MOTIVO_MINIMO, avisoDoRequerimentoEnviado, mudancasDaEdicao, mostrarMudanca, type ChaveEditavel, type ValoresEditaveis,
} from "@/src/lib/genealogia/dados-registrais-edicao"
import { ModalConfirmacaoArvore, divergenciasDaResposta, type DivergenciaDaArvore, type EscolhasDaArvore } from "@/src/components/kanban/documento/ModalConfirmacaoArvore"

interface Contexto { documentoId: number; pessoaNome: string; passoConcluido: boolean; requerimentoEnviadoEm: string | null; valores: Record<string, string | null> }
interface Aplicado { chave: string; rotulo: string; pessoaNome: string; arvoreTexto: string; registroTexto: string; tipo: string; logId?: number }

const auth = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("authToken")}` })
const cls = "w-full px-2.5 py-1.5 text-[13px] rounded-md bg-[var(--surface-secondary)] border border-[var(--border-default)] text-[var(--text-primary)]"
const lab = "block text-[10px] uppercase font-semibold tracking-wider text-[var(--text-secondary)] mb-1"

export function EditarDadosRegistrais({ documentoId, onFechar, onSaved }: { documentoId: number; onFechar: () => void; onSaved?: () => void }) {
  const [ctx, setCtx] = useState<Contexto | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [motivo, setMotivo] = useState("")
  // Divergência com a árvore: o SERVIDOR recusa (409) e devolve o que difere; a pessoa escolhe e o salvamento é refeito com a escolha.
  const [divergencias, setDivergencias] = useState<DivergenciaDaArvore[] | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aplicados, setAplicados] = useState<Aplicado[] | null>(null)
  const [desfeitos, setDesfeitos] = useState<Set<number>>(new Set())

  useEffect(() => {
    let vivo = true
    void fetch(`/api/documentos/${documentoId}/dados-registrais`, { headers: auth() }).then((r) => (r.ok ? r.json() : null)).then((c) => {
      if (!vivo) return
      if (!c) { setErro("Não foi possível carregar os dados desta certidão."); return }
      setCtx(c)
      setForm(Object.fromEntries(CAMPOS_EDITAVEIS.map((f) => [f.chave, c.valores[f.chave] ?? ""])))
    })
    return () => { vivo = false }
  }, [documentoId])

  // A LOCALIDADE segue a regra única (`lib/localidade`): Brasil = Estado→Cidade→Cartório em lista; outro país = Província→Cidade→Cartório em texto livre.
  const loc = useLocalidade({ ativo: !!ctx, pais: form.pais_registro ?? "", estadoOuProvincia: form.estado_registro ?? "", cidade: form.cidade_registro ?? "" })

  const mudancas = useMemo(() => (ctx ? mudancasDaEdicao(ctx.valores as ValoresEditaveis, form as ValoresEditaveis) : []), [ctx, form])
  const aviso = useMemo(() => (ctx ? avisoDoRequerimentoEnviado(ctx.requerimentoEnviadoEm, mudancas) : null), [ctx, mudancas])
  const motivoOk = !ctx?.passoConcluido || motivo.trim().length >= MOTIVO_MINIMO
  const podeSalvar = !!ctx && mudancas.length > 0 && motivoOk && !salvando

  const mudar = (chave: ChaveEditavel, v: string) => setForm((f) => ({ ...f, [chave]: v }))
  const salvar = async (decisoes?: EscolhasDaArvore) => {
    if (!ctx) return
    setSalvando(true); setErro(null)
    try {
      const r = await fetch(`/api/documentos/${documentoId}/dados-registrais`, {
        method: "PATCH", headers: auth(),
        body: JSON.stringify({ valores: Object.fromEntries(mudancas.map((m) => [m.chave, form[m.chave] === "" ? null : form[m.chave]])), motivo, confirmouRequerimentoEnviado: aviso != null, ...(decisoes ? { decisoes } : {}) }),
      })
      const j = await r.json().catch(() => ({}))
      const divergentes = divergenciasDaResposta(r.status, j)
      if (divergentes) { setDivergencias(divergentes); return }
      if (!r.ok || j.ok === false) { setErro(j.error ?? "Não foi possível salvar."); return }
      onSaved?.()
      if (Array.isArray(j.sincronizados) && j.sincronizados.length > 0) setAplicados(j.sincronizados)
      else onFechar()
    } catch { setErro("Não foi possível salvar agora. Tente novamente.") } finally { setSalvando(false) }
  }

  const desfazer = async (logId: number) => {
    const r = await fetch(`/api/sincronizacao-registral/${logId}/desfazer`, { method: "POST", headers: auth() })
    const j = await r.json().catch(() => ({}))
    if (r.ok) { setDesfeitos((s) => new Set(s).add(logId)); onSaved?.() } else setErro(j.error ?? "Não foi possível desfazer.")
  }

  const grupos = ["Evento", "Localidade", "Referência registral"] as const
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center bg-black/50" style={{ zIndex: LAYER.aboveProcessCritical }} data-testid="modal-editar-dados-registrais">
      <div className="w-[560px] max-w-[94vw] max-h-[92vh] overflow-y-auto rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] p-5">
        <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">Editar dados registrais</h3>
        {ctx && <p className="text-[12px] text-[var(--text-secondary)] mb-3">{ctx.pessoaNome} · o órgão emissor continua pelo “alterar”</p>}
        {!ctx && !erro && <div className="flex items-center gap-2 text-[13px] py-6"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</div>}

        {aplicados ? (
          <div data-testid="resultado-sincronizacao">
            <p className="text-[13px] text-[var(--text-primary)] mb-2">Dados registrais salvos. A árvore foi atualizada com o registro:</p>
            <ul className="space-y-1.5 mb-3">
              {aplicados.map((a, i) => (
                <li key={i} className="text-[12.5px] flex items-center gap-2 flex-wrap">
                  <span><b>{a.pessoaNome}</b> — {a.rotulo}: {a.arvoreTexto} → {a.registroTexto}{a.tipo === "CONFLITO" ? " (divergência resolvida)" : ""}</span>
                  {a.logId != null && (desfeitos.has(a.logId)
                    ? <span className="text-[11px] text-[var(--text-secondary)]">desfeito</span>
                    : <button type="button" onClick={() => void desfazer(a.logId!)} className="text-[11px] underline text-[var(--accent-text)]">Desfazer na árvore</button>)}
                </li>
              ))}
            </ul>
            {erro && <div className="text-[12px] text-[var(--warning-text)] mb-2">{erro}</div>}
            <div className="flex justify-end"><button type="button" onClick={onFechar} className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[var(--accent-primary)] text-white">Fechar</button></div>
          </div>
        ) : ctx && (
          <>
            {grupos.map((g) => (
              <div key={g} className="mb-3">
                <div className="text-[11px] font-semibold text-[var(--text-secondary)] mb-1.5">{g}</div>
                <div className="grid grid-cols-2 gap-3">
                  {g === "Localidade" && (
                    <>
                      <div>
                        <label className={lab} htmlFor="edr-pais_registro">País</label>
                        <select id="edr-pais_registro" data-testid="campo-pais_registro" className={cls} value={form.pais_registro ?? ""} onChange={(e) => setForm((f) => ({ ...f, pais_registro: e.target.value, estado_registro: "", cidade_registro: "" }))}>
                          <option value="">{loc.paises.length ? "Selecione o país" : "Carregando…"}</option>
                          {form.pais_registro && !loc.paises.some((p) => p.nome === form.pais_registro) && <option value={form.pais_registro}>{form.pais_registro}</option>}
                          {loc.paises.map((p) => <option key={p.codigo} value={p.nome}>{p.nome}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={lab} htmlFor="edr-estado_registro">{loc.rotuloDivisao}</label>
                        {loc.ehBrasil || loc.provincias.length > 0 ? (
                          <select id="edr-estado_registro" data-testid="campo-estado_registro" className={cls} value={form.estado_registro ?? ""} onChange={(e) => setForm((f) => ({ ...f, estado_registro: e.target.value, cidade_registro: "" }))}>
                            <option value="">{`Selecione ${loc.ehBrasil ? "o estado" : "a província"}`}</option>
                            {form.estado_registro && !(loc.ehBrasil ? loc.ufs.map((u) => u.nome) : loc.provincias.map((p) => p.nome)).includes(form.estado_registro) && <option value={form.estado_registro}>{form.estado_registro}</option>}
                            {(loc.ehBrasil ? loc.ufs.map((u) => u.nome) : loc.provincias.map((p) => p.nome)).map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                        ) : (
                          <input id="edr-estado_registro" data-testid="campo-estado_registro" className={cls} type="text" maxLength={50} value={form.estado_registro ?? ""} onChange={(e) => mudar("estado_registro", e.target.value)} />
                        )}
                      </div>
                      <div className="col-span-2">
                        <label className={lab} htmlFor="edr-cidade_registro">Cidade</label>
                        {loc.ehBrasil && loc.municipios.length > 0 ? (
                          <select id="edr-cidade_registro" data-testid="campo-cidade_registro" className={cls} value={form.cidade_registro ?? ""} onChange={(e) => mudar("cidade_registro", e.target.value)}>
                            <option value="">Selecione a cidade</option>
                            {form.cidade_registro && !loc.municipios.includes(form.cidade_registro) && <option value={form.cidade_registro}>{form.cidade_registro}</option>}
                            {loc.municipios.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        ) : (
                          <>
                            {/* Fora do Brasil a lista só SUGERE; cidade que a base não conhece é texto livre (nunca trava). */}
                            <input id="edr-cidade_registro" data-testid="campo-cidade_registro" className={cls} type="text" maxLength={100} list="edr-cidades-sugeridas" value={form.cidade_registro ?? ""} onChange={(e) => mudar("cidade_registro", e.target.value)} />
                            <datalist id="edr-cidades-sugeridas">{loc.cidadesSugeridas.map((c) => <option key={`${c.nome}|${c.provincia}`} value={c.nome}>{c.provincia ? `${c.nome} — ${c.provincia}` : c.nome}</option>)}</datalist>
                          </>
                        )}
                      </div>
                      <div className="col-span-2">
                        {loc.ehBrasil ? (
                          <CartorioOrgaoField
                            documentoId={documentoId} texto={form.cartorio ?? ""} orgaoId={null} ufSigla={loc.ufSigla} cidade={form.cidade_registro ?? ""} paisNome="Brasil" requiredToComplete={false}
                            onTextoChange={(v) => mudar("cartorio", v)} onVinculado={(o) => mudar("cartorio", o.name)}
                          />
                        ) : (
                          <>
                            <label className={lab} htmlFor="edr-cartorio">Cartório</label>
                            <input id="edr-cartorio" data-testid="campo-cartorio" className={cls} type="text" maxLength={200} value={form.cartorio ?? ""} onChange={(e) => mudar("cartorio", e.target.value)} />
                          </>
                        )}
                      </div>
                    </>
                  )}
                  {CAMPOS_EDITAVEIS.filter((c) => c.grupo === g && g !== "Localidade").map((c) => (
                    <div key={c.chave} className={c.chave === "cartorio" ? "col-span-2" : ""}>
                      <label className={lab} htmlFor={`edr-${c.chave}`}>{c.rotulo}</label>
                      {c.tipo === "data" ? (
                        <CampoDataTexto id={`edr-${c.chave}`} className={cls} value={form[c.chave] ?? ""} onChange={(v) => mudar(c.chave, v)} />
                      ) : (
                        <input id={`edr-${c.chave}`} data-testid={`campo-${c.chave}`} className={cls} type="text" value={form[c.chave] ?? ""} maxLength={c.max}
                          onChange={(e) => mudar(c.chave, c.maiuscula ? e.target.value.toUpperCase() : e.target.value)} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {aviso && <div data-testid="aviso-requerimento-enviado" className="mb-2 p-2.5 rounded-md border border-[var(--warning-text)]/40 text-[12.5px] text-[var(--warning-text)]">{aviso}</div>}

            {ctx.passoConcluido && (
              <div className="mb-3">
                <label className={lab} htmlFor="edr-motivo">Motivo da correção (obrigatório — o registro já foi localizado)</label>
                <textarea id="edr-motivo" data-testid="campo-motivo" className={cls} rows={2} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: a data do evento estava trocada com a data do registro" />
              </div>
            )}

            {mudancas.length > 0 && <div className="mb-3 text-[11.5px] text-[var(--text-secondary)]">Vai para o histórico: {mudancas.map(mostrarMudanca).join(" · ")}</div>}
            {erro && <div className="mb-2 text-[12px] text-[var(--warning-text)]">{erro}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onFechar} className="px-3 py-1.5 rounded-md text-[12px] border border-[var(--border-default)] text-[var(--text-primary)]">Cancelar</button>
              <button type="button" data-testid="salvar-dados-registrais" disabled={!podeSalvar} onClick={() => void salvar()} className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[var(--accent-primary)] text-white disabled:opacity-50">
                {salvando ? "Salvando…" : aviso ? "Salvar mesmo assim" : "Salvar"}
              </button>
            </div>
          </>
        )}
        {erro && !ctx && <div className="text-[12px] text-[var(--warning-text)]">{erro}</div>}
      </div>
      {divergencias && (
        <ModalConfirmacaoArvore
          divergencias={divergencias} salvando={salvando}
          onCancelar={() => setDivergencias(null)}
          onDecidir={(escolhas) => { setDivergencias(null); void salvar(escolhas) }}
        />
      )}
    </div>,
    document.body,
  )
}
