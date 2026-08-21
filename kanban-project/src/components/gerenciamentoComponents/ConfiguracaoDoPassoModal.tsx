"use client"
// src/components/gerenciamentoComponents/ConfiguracaoDoPassoModal.tsx
//
// ONDE O ADMINISTRADOR CONFIGURA O QUE O PASSO FAZ.
//
// Até aqui, "o que aparece na tela de Solicitar certidão" era uma pergunta cuja
// resposta era um array dentro de um componente React. Esta tela é a resposta nova:
// campos, resultados, checklist e dependências são cadastro, e cadastrar não é
// deploy.
//
// O QUE ELA NÃO INVENTA: a lista de efeitos e a de executores vêm do servidor
// (`/api/gerenciamento/catalogo-execucao`). Escrevê-las aqui à mão recriaria o
// problema — a tela ofereceria coisas que o motor não conhece, e o operador
// descobriria isso executando.
//
// A tela também NÃO decide se a configuração é válida: ela mostra o que o servidor
// recusou. A validação mora na publicação, que é quem tem a configuração inteira.

import { useEffect, useState } from "react"

export interface PassoConfiguravel {
  id?: number
  key: string
  label: string
  description?: string | null
  ordem: number
  createsTask: boolean
  required: boolean
  cardinalidade?: string | null
  owner?: string | null
  priority?: string
  slaDays?: number
  completionRule?: string | null
  executorKey?: string | null
  dependeDe?: string[] | null
  reaberturaPermitida?: boolean
  reaberturaEstrategia?: string
  reaberturaExigeJustificativa?: boolean
  reaberturaPermissao?: string | null
  acoes?: AcaoCfg[]
  campos?: CampoCfg[]
  checkItens?: ItemCfg[]
}
export interface AcaoCfg { key?: string; label: string; descricao?: string | null; effectKey: string; ordem?: number; requerCampos?: string[]; ativo?: boolean }
export interface CampoCfg { key?: string; label: string; tipo: string; obrigatorio?: boolean; opcoes?: unknown; ajuda?: string | null; ordem?: number; ativo?: boolean }
export interface ItemCfg { key?: string; label: string; descricao?: string | null; obrigatorio?: boolean; ordem?: number; ativo?: boolean }

interface Efeito { key: string; label: string; descricao: string; competencia: string; permitidoNestaFase: boolean; camposObrigatorios: string[] }
interface Executor { key: string; label: string; campos: string[]; efeitos: string[]; acoesCadastradas: boolean; checklistCadastrado: boolean }
interface Catalogo { efeitos: Efeito[]; executores: Executor[]; tiposDeCampo: string[]; canais: Array<{ key: string; label: string }> }

const ABAS = ["geral", "dependencias", "reabertura", "campos", "acoes", "checklist"] as const
type Aba = (typeof ABAS)[number]
const TITULO: Record<Aba, string> = {
  geral: "Geral", dependencias: "Dependências", reabertura: "Reabertura",
  campos: "Campos", acoes: "Ações/Resultados", checklist: "Checklist",
}

const inp = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-blue-400/50"
const lbl = "mb-1 block text-[11px] uppercase tracking-wide text-white/40"
const card = "rounded-lg border border-white/10 bg-white/5 p-3"

export default function ConfiguracaoDoPassoModal({
  passo, irmaos, phaseKey, faseLabel, onFechar, onSalvar, problemas,
}: {
  passo: PassoConfiguravel
  /** Os outros passos do mesmo workflow — as dependências só podem apontar para eles. */
  irmaos: Array<{ key: string; label: string }>
  phaseKey: string
  faseLabel: string
  onFechar: () => void
  onSalvar: (p: PassoConfiguravel) => Promise<void> | void
  problemas?: Array<{ codigo: string; stepKey: string | null; mensagem: string }>
}) {
  const [aba, setAba] = useState<Aba>("geral")
  const [cat, setCat] = useState<Catalogo | null>(null)
  const [f, setF] = useState<PassoConfiguravel>({
    ...passo,
    dependeDe: passo.dependeDe ?? [],
    reaberturaPermitida: passo.reaberturaPermitida !== false,
    reaberturaEstrategia: passo.reaberturaEstrategia ?? "ESCOLHA_MANUAL",
    reaberturaExigeJustificativa: passo.reaberturaExigeJustificativa !== false,
    reaberturaPermissao: passo.reaberturaPermissao ?? null,
    acoes: passo.acoes ?? [],
    campos: passo.campos ?? [],
    checkItens: passo.checkItens ?? [],
  })
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("token") : null
    fetch(`/api/gerenciamento/catalogo-execucao?phaseKey=${encodeURIComponent(phaseKey)}`, {
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCat(d))
      .catch(() => setCat(null))
  }, [phaseKey])

  const executorAtual = f.executorKey ?? ""
  const exec = cat?.executores.find((e) => e.key === executorAtual) ?? null
  const efeitosOfertados = (cat?.efeitos ?? []).filter((e) =>
    e.permitidoNestaFase && (!exec || exec.efeitos.includes(e.key)))
  const tiposOfertados = exec ? exec.campos : (cat?.tiposDeCampo ?? [])

  const set = <K extends keyof PassoConfiguravel>(k: K, v: PassoConfiguravel[K]) => setF((x) => ({ ...x, [k]: v }))
  const listaSet = <T,>(nome: "acoes" | "campos" | "checkItens", i: number, patch: Partial<T>) =>
    setF((x) => ({ ...x, [nome]: (x[nome] as T[]).map((it, j) => (j === i ? { ...it, ...patch } : it)) }))
  const listaDel = (nome: "acoes" | "campos" | "checkItens", i: number) =>
    setF((x) => ({ ...x, [nome]: (x[nome] as unknown[]).filter((_, j) => j !== i) }))

  async function salvar() {
    setSalvando(true)
    try { await onSalvar(f) } finally { setSalvando(false) }
  }

  const meus = (problemas ?? []).filter((p) => p.stepKey === f.key || p.stepKey === null)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onFechar}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-white/10 px-6 py-4">
          <h3 className="font-semibold text-white">Configurar “{f.label}”</h3>
          <p className="mt-0.5 text-xs text-white/50">
            Fase: {faseLabel} · chave <code className="text-white/70">{f.key}</code> · salvar publica uma versão nova; os processos em andamento continuam na versão deles.
          </p>
        </div>

        <div className="flex gap-1 border-b border-white/10 px-4 pt-3">
          {ABAS.map((a) => (
            <button key={a} onClick={() => setAba(a)}
              className={`rounded-t-lg px-3 py-2 text-xs ${aba === a ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"}`}>
              {TITULO[a]}
              {a === "campos" && (f.campos?.length ?? 0) > 0 && <span className="ml-1.5 text-white/40">{f.campos!.length}</span>}
              {a === "acoes" && (f.acoes?.length ?? 0) > 0 && <span className="ml-1.5 text-white/40">{f.acoes!.length}</span>}
              {a === "checklist" && (f.checkItens?.length ?? 0) > 0 && <span className="ml-1.5 text-white/40">{f.checkItens!.length}</span>}
            </button>
          ))}
        </div>

        {meus.length > 0 && (
          <div className="mx-6 mt-4 rounded-lg border border-red-400/30 bg-red-500/10 p-3">
            <div className="text-xs font-medium text-red-200">A publicação foi recusada:</div>
            <ul className="mt-1 space-y-0.5 text-xs text-red-200/80">
              {meus.map((p, i) => <li key={i}>· {p.mensagem}</li>)}
            </ul>
          </div>
        )}

        <div className="flex-1 space-y-4 overflow-auto px-6 py-4">
          {aba === "geral" && (
            <>
              <div>
                <label className={lbl}>Nome</label>
                <input className={inp} value={f.label} onChange={(e) => set("label", e.target.value)} />
              </div>
              <div>
                <label className={lbl}>Descrição</label>
                <textarea className={inp} rows={2} value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Responsável padrão</label>
                  <input className={inp} value={f.owner ?? ""} onChange={(e) => set("owner", e.target.value)} placeholder="ex.: Equipe de emissão" />
                </div>
                <div>
                  <label className={lbl}>Prazo (dias úteis)</label>
                  <input type="number" min={0} className={inp} value={f.slaDays ?? 0} onChange={(e) => set("slaDays", Number(e.target.value) || 0)} />
                </div>
              </div>
              <div>
                <label className={lbl}>Executor (interface que roda esta etapa)</label>
                <select className={inp} value={executorAtual} onChange={(e) => set("executorKey", e.target.value || null)}>
                  <option value="">Resolver pela chave do passo</option>
                  {(cat?.executores ?? []).map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-white/40">
                  {exec
                    ? `Desenha ${exec.campos.length} tipos de campo e dispara ${exec.efeitos.length} efeitos. Campos e resultados fora disso são recusados na publicação.`
                    : "O painel declarativo desenha qualquer campo e dispara qualquer efeito permitido à fase."}
                </p>
              </div>
              <div className="flex gap-4 text-sm text-white/70">
                <label className="flex items-center gap-2"><input type="checkbox" checked={f.createsTask} onChange={(e) => set("createsTask", e.target.checked)} /> Etapa executável</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={f.required} onChange={(e) => set("required", e.target.checked)} /> Obrigatória</label>
              </div>
            </>
          )}

          {aba === "dependencias" && (
            <>
              <p className="text-xs text-white/50">
                Esta etapa fica disponível quando <b>todas</b> as marcadas estiverem concluídas. Sem nenhuma marcada,
                ela não espera ninguém. Dependência não é ordem: duas etapas podem depender da mesma e correr juntas —
                e reabrir uma delas não derruba a outra.
              </p>
              {irmaos.filter((s) => s.key !== f.key).length === 0 && <div className="text-xs text-white/40">Este é o único passo do workflow.</div>}
              {irmaos.filter((s) => s.key !== f.key).map((s) => {
                const marcado = (f.dependeDe ?? []).includes(s.key)
                return (
                  <label key={s.key} className={`flex cursor-pointer items-center gap-3 ${card}`}>
                    <input type="checkbox" checked={marcado}
                      onChange={() => set("dependeDe", marcado ? (f.dependeDe ?? []).filter((k) => k !== s.key) : [...(f.dependeDe ?? []), s.key])} />
                    <div>
                      <div className="text-sm text-white">{s.label}</div>
                      <div className="text-[11px] text-white/40">{s.key}</div>
                    </div>
                  </label>
                )
              })}
            </>
          )}

          {aba === "reabertura" && (
            <>
              <p className="text-xs text-white/50">
                O que acontece quando alguém precisa <b>refazer</b> esta etapa depois de concluída — seja pela
                Central, seja ao retroceder a fase. Reabrir nunca apaga a execução anterior: ela é arquivada com
                o que foi registrado, e uma execução nova começa.
              </p>
              <label className={`flex cursor-pointer items-start gap-3 ${card}`}>
                <input type="checkbox" className="mt-1" checked={f.reaberturaPermitida !== false}
                  onChange={(e) => set("reaberturaPermitida", e.target.checked)} />
                <span>
                  <span className="text-sm text-white">Esta etapa pode ser reexecutada</span>
                  <span className="block text-[11px] text-white/40">
                    Desmarcado, ela aparece na tela de retrocesso com o motivo — e não como um botão desabilitado sem explicação.
                  </span>
                </span>
              </label>
              <div>
                <label className={lbl}>O que propor por padrão</label>
                <select className={inp} value={f.reaberturaEstrategia ?? "ESCOLHA_MANUAL"}
                  onChange={(e) => set("reaberturaEstrategia", e.target.value)}>
                  <option value="ESCOLHA_MANUAL">Perguntar — o administrador escolhe o que reabrir</option>
                  <option value="SOMENTE_ESTA">Somente esta etapa</option>
                  <option value="ESTA_E_DEPENDENTES">Esta e as que dependem dela</option>
                </select>
                <p className="mt-1 text-[11px] text-white/40">
                  Isto é só a sugestão que a tela marca; quem decide continua sendo quem executa o retrocesso.
                  &quot;As que dependem dela&quot; vem do grafo cadastrado na aba Dependências — nunca da ordem da lista.
                </p>
              </div>
              <label className={`flex cursor-pointer items-start gap-3 ${card}`}>
                <input type="checkbox" className="mt-1" checked={f.reaberturaExigeJustificativa !== false}
                  onChange={(e) => set("reaberturaExigeJustificativa", e.target.checked)} />
                <span>
                  <span className="text-sm text-white">Exigir justificativa</span>
                  <span className="block text-[11px] text-white/40">
                    Reabrir sem dizer por quê deixa o histórico com um buraco no lugar do motivo.
                  </span>
                </span>
              </label>
              <div>
                <label className={lbl}>Permissão exigida (vazio = a permissão geral de reabrir)</label>
                <input className={inp} value={f.reaberturaPermissao ?? ""}
                  onChange={(e) => set("reaberturaPermissao", e.target.value || null)}
                  placeholder="ex.: processos.moverFaseManual" />
              </div>
            </>
          )}

          {aba === "campos" && (
            <>
              <p className="text-xs text-white/50">O que o operador preenche nesta etapa.</p>
              {(f.campos ?? []).map((c, i) => (
                <div key={i} className={card}>
                  <div className="grid grid-cols-[1fr_150px_auto] items-end gap-2">
                    <div>
                      <label className={lbl}>Rótulo</label>
                      <input className={inp} value={c.label} onChange={(e) => listaSet<CampoCfg>("campos", i, { label: e.target.value })} />
                    </div>
                    <div>
                      <label className={lbl}>Tipo</label>
                      <select className={inp} value={c.tipo} onChange={(e) => listaSet<CampoCfg>("campos", i, { tipo: e.target.value })}>
                        {tiposOfertados.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <button onClick={() => listaDel("campos", i)} className="rounded-lg border border-white/10 px-2 py-2 text-xs text-red-300 hover:bg-red-500/10">Remover</button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-xs text-white/60">
                      <input type="checkbox" checked={!!c.obrigatorio} onChange={(e) => listaSet<CampoCfg>("campos", i, { obrigatorio: e.target.checked })} /> Obrigatório
                    </label>
                    {["select", "multiselect", "radio"].includes(c.tipo) && (
                      <label className="flex items-center gap-2 text-xs text-white/60">
                        <input type="checkbox"
                          checked={!!(c.opcoes as { catalogo?: string } | null)?.catalogo}
                          onChange={(e) => listaSet<CampoCfg>("campos", i, { opcoes: e.target.checked ? { catalogo: "canais" } : [] })} />
                        Usar o cadastro de canais ({cat?.canais.length ?? 0} ativos)
                      </label>
                    )}
                  </div>
                  {["select", "multiselect", "radio"].includes(c.tipo) && !(c.opcoes as { catalogo?: string } | null)?.catalogo && (
                    <div className="mt-2">
                      <label className={lbl}>Opções (uma por linha: valor | rótulo)</label>
                      <textarea className={inp} rows={3}
                        value={(Array.isArray(c.opcoes) ? c.opcoes as Array<{ value: string; label: string }> : []).map((o) => `${o.value} | ${o.label}`).join("\n")}
                        onChange={(e) => listaSet<CampoCfg>("campos", i, {
                          opcoes: e.target.value.split("\n").map((l) => l.split("|")).filter((p) => p[0]?.trim())
                            .map((p) => ({ value: p[0].trim(), label: (p[1] ?? p[0]).trim() })),
                        })} />
                    </div>
                  )}
                </div>
              ))}
              <button onClick={() => setF((x) => ({ ...x, campos: [...(x.campos ?? []), { label: "Novo campo", tipo: tiposOfertados[0] ?? "texto" }] }))}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500">+ Campo</button>
            </>
          )}

          {aba === "acoes" && (
            <>
              <p className="text-xs text-white/50">
                Os resultados que o operador pode escolher. Cada um aponta para um efeito do catálogo — a lista abaixo
                mostra <b>só</b> os que esta fase tem competência para executar e que o executor sabe disparar.
              </p>
              {(f.acoes ?? []).map((a, i) => {
                const ef = cat?.efeitos.find((x) => x.key === a.effectKey)
                return (
                  <div key={i} className={card}>
                    <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                      <div>
                        <label className={lbl}>Rótulo</label>
                        <input className={inp} value={a.label} onChange={(e) => listaSet<AcaoCfg>("acoes", i, { label: e.target.value })} />
                      </div>
                      <button onClick={() => listaDel("acoes", i)} className="rounded-lg border border-white/10 px-2 py-2 text-xs text-red-300 hover:bg-red-500/10">Remover</button>
                    </div>
                    <div className="mt-2">
                      <label className={lbl}>O que acontece</label>
                      <select className={inp} value={a.effectKey} onChange={(e) => listaSet<AcaoCfg>("acoes", i, { effectKey: e.target.value })}>
                        {!efeitosOfertados.some((e) => e.key === a.effectKey) && <option value={a.effectKey}>{a.effectKey} (indisponível nesta fase)</option>}
                        {efeitosOfertados.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
                      </select>
                      {ef && <p className="mt-1 text-[11px] text-white/40">{ef.descricao} · competência {ef.competencia}
                        {ef.camposObrigatorios.length > 0 && ` · exige: ${ef.camposObrigatorios.join(", ")}`}</p>}
                    </div>
                    <div className="mt-2">
                      <label className={lbl}>Explicação para o operador</label>
                      <input className={inp} value={a.descricao ?? ""} onChange={(e) => listaSet<AcaoCfg>("acoes", i, { descricao: e.target.value })} />
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-xs text-white/60">
                      <input type="checkbox" checked={a.ativo !== false} onChange={(e) => listaSet<AcaoCfg>("acoes", i, { ativo: e.target.checked })} />
                      Ativa (desmarcar tira das versões novas; o histórico continua legível)
                    </label>
                  </div>
                )
              })}
              <button disabled={efeitosOfertados.length === 0}
                onClick={() => setF((x) => ({ ...x, acoes: [...(x.acoes ?? []), { label: "Novo resultado", effectKey: efeitosOfertados[0]?.key ?? "REGISTER_ONLY" }] }))}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40">+ Resultado</button>
              {efeitosOfertados.length === 0 && cat && (
                <p className="text-[11px] text-amber-300/70">
                  Nenhum efeito disponível: a fase não declarou competência compatível com o executor escolhido.
                </p>
              )}
            </>
          )}

          {aba === "checklist" && (
            <>
              <p className="text-xs text-white/50">Itens de conferência desta etapa.</p>
              {exec && !exec.checklistCadastrado && (
                <p className="text-[11px] text-amber-300/70">O executor “{exec.label}” não desenha checklist; os itens ficam cadastrados mas não aparecem nele.</p>
              )}
              {(f.checkItens ?? []).map((k, i) => (
                <div key={i} className={card}>
                  <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                    <div>
                      <label className={lbl}>Item</label>
                      <input className={inp} value={k.label} onChange={(e) => listaSet<ItemCfg>("checkItens", i, { label: e.target.value })} />
                    </div>
                    <button onClick={() => listaDel("checkItens", i)} className="rounded-lg border border-white/10 px-2 py-2 text-xs text-red-300 hover:bg-red-500/10">Remover</button>
                  </div>
                  <input className={`${inp} mt-2`} placeholder="Explicação (opcional)" value={k.descricao ?? ""} onChange={(e) => listaSet<ItemCfg>("checkItens", i, { descricao: e.target.value })} />
                </div>
              ))}
              <button onClick={() => setF((x) => ({ ...x, checkItens: [...(x.checkItens ?? []), { label: "Novo item" }] }))}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500">+ Item</button>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/10 px-6 py-4">
          <button onClick={onFechar} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10">Cancelar</button>
          <button onClick={salvar} disabled={salvando}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
            {salvando ? "Publicando…" : "Salvar e publicar versão"}
          </button>
        </div>
      </div>
    </div>
  )
}
