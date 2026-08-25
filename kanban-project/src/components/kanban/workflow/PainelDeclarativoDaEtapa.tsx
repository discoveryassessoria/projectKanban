"use client"
// src/components/kanban/workflow/PainelDeclarativoDaEtapa.tsx
//
// A TELA DE UM PASSO CONFIGURADO — desenhada a partir do cadastro, não do código.
//
// É por causa deste componente que um passo criado pelo administrador executa sem
// deploy: os campos, os resultados e o checklist vêm de
// `/api/workflow-step-instances/[id]/execucao`, que os lê da VERSÃO que esta
// execução registrou. Nada aqui sabe o nome de nenhum passo, de nenhum canal e de
// nenhum resultado.
//
// A TELA NÃO DECIDE DOMÍNIO. Ela mostra os resultados que o servidor disse existir,
// manda o escolhido, e mostra o que o servidor respondeu — inclusive a recusa
// ("a fase não tem competência para isso"), que é informação para o operador, não
// erro de sistema. O que acontece depois de escolher é do motor.

import { useCallback, useEffect, useState } from "react"

interface Campo {
  key: string; label: string; tipo: string; obrigatorio: boolean
  opcoes: Array<{ value: string; label: string; meta?: unknown }>
  ajuda: string | null; condicao: { campo?: string; op?: string; valor?: unknown } | null
}
interface Acao {
  key: string; label: string; descricao: string | null; effectKey: string
  efeito: { label: string; descricao: string; competencia: string } | null
}
interface ItemChecklist { key: string; label: string; descricao: string | null; obrigatorio: boolean }
interface Tentativa {
  id: number; sequencia: number; status: string; motivo: string
  completedAt: string | null; resultado: string | null; supersededAt: string | null
  payload: { valores?: Record<string, unknown>; acao?: string } | null
}
interface Preview {
  seraReexecutado: Array<{ id: number; stepKey: string; status: string }>
  seraoReavaliados: Array<{ id: number; stepKey: string; status: string }>
  herdados: Array<{ id: number; stepKey: string; status: string }>
  intactos: Array<{ id: number; stepKey: string; status: string }>
  execucoesAnteriores: number
  aviso: string
}

/**
 * UMA SUBTAREFA PROJETADA pelo servidor.
 *
 * `bloqueioTexto` vem pronto: quem sabe POR QUE ela não pode ser feita é quem tem o
 * grafo de dependências e as condições — o servidor. A tela que reescrevesse esse
 * motivo daria uma segunda explicação, e as duas divergiriam no primeiro caso difícil.
 */
interface Subtarefa {
  key: string
  label: string
  descricao: string | null
  ordem: number
  obrigatoria: boolean
  repetivel: boolean
  visivel: boolean
  disponivel: boolean
  concluida: boolean
  status: string
  bloqueioTexto: string | null
  ocorrencias: number
  podeRepetir: boolean
  canais: Array<{ key: string; label: string; exigeProtocolo: boolean; exigeAnexo: boolean; exigeRastreio: boolean; exigeObservacao: boolean; endereco: string | null }>
  execucao: { id: number; sequencia: number; resultado: string | null; completedAt: string | null } | null
  definicao: { acoes: Acao[]; campos: Campo[]; checkItens: ItemChecklist[] }
}

/**
 * O CONTEXTO DA UNIDADE DE TRABALHO, projetado no servidor a partir dos donos de cada
 * fato — o pedido, o profissional, o protocolo, a organização. Chega pronto para
 * mostrar e NÃO existe no payload da execução: copiá-lo para lá "para facilitar a UI"
 * recriaria a segunda verdade que este trabalho inteiro existe para desfazer.
 */
interface BlocoDeContexto {
  chave: string
  titulo: string
  itens: Array<{ rotulo: string; valor: string; detalhe?: string | null }>
}

interface Dados {
  passo: { id: number; stepKey: string; status: string }
  contexto?: { pacoteId: number; num: string; blocos: BlocoDeContexto[] } | null
  versao: number | null
  executor: string | null
  configuracao: { label: string; descricao: string | null; campos: Campo[]; acoes: Acao[]; checklist: ItemChecklist[] } | null
  subtarefas?: Subtarefa[]
  fornecedor?: { id: number; nome: string } | null
  conclusao?: { pode: boolean; regra: string; faltando: Array<{ key: string; label: string; motivo: string }> }
  execucaoAtual: Tentativa | null
  execucoesAnteriores: Tentativa[]
}

const inp = "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[var(--border-default)]"
const lbl = "mb-1 block text-[11px] uppercase tracking-wide text-[var(--text-muted)]"

function headers(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("token") : null
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

/** Condição de visibilidade declarativa: `{ campo, op, valor }`. */
function visivel(c: Campo, v: Record<string, unknown>): boolean {
  const cond = c.condicao
  if (!cond?.campo) return true
  const atual = v[cond.campo]
  if (cond.op === "em") return Array.isArray(cond.valor) && (cond.valor as unknown[]).includes(atual)
  if (cond.op === "preenchido") return atual != null && String(atual).trim() !== ""
  return atual === cond.valor
}

export default function PainelDeclarativoDaEtapa({
  stepInstanceId, onExecutado,
}: { stepInstanceId: number; onExecutado?: () => void }) {
  const [d, setD] = useState<Dados | null>(null)
  const [erroCarga, setErroCarga] = useState("")
  const [valores, setValores] = useState<Record<string, unknown>>({})
  const [marcados, setMarcados] = useState<Record<string, boolean>>({})
  const [enviando, setEnviando] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [justificativa, setJustificativa] = useState("")
  const [recusa, setRecusa] = useState("")
  const [feito, setFeito] = useState("")
  // O QUE FOI PREENCHIDO EM CADA SUBTAREFA, separado. Um único mapa de valores faria
  // dois campos homônimos de subtarefas diferentes serem o mesmo campo.
  const [valoresDaSub, setValoresDaSub] = useState<Record<string, Record<string, unknown>>>({})
  const [marcadosDaSub, setMarcadosDaSub] = useState<Record<string, Record<string, boolean>>>({})
  const [subAberta, setSubAberta] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setErroCarga("")
    try {
      const r = await fetch(`/api/workflow-step-instances/${stepInstanceId}/execucao`, { headers: headers() })
      if (!r.ok) { setErroCarga("Não foi possível carregar a configuração desta etapa."); return }
      const j: Dados = await r.json()
      setD(j)
      // O que a tentativa em curso já tinha guardado volta preenchido: recarregar a
      // tela não pode custar o que o operador já tinha digitado e salvo.
      const anteriores = j.execucaoAtual?.payload?.valores
      if (anteriores && typeof anteriores === "object") setValores(anteriores)
    } catch { setErroCarga("Erro de conexão ao carregar a etapa.") }
  }, [stepInstanceId])

  useEffect(() => {
    // A carga sai do corpo do efeito de propósito: chamar direto faria o primeiro
    // `setState` acontecer na mesma passagem em que o efeito roda, encadeando render.
    let vivo = true
    void Promise.resolve().then(() => { if (vivo) return carregar() })
    return () => { vivo = false }
  }, [carregar])

  async function executar(acao: Acao, subtarefa?: string | null) {
    setEnviando(`${subtarefa ?? "-"}|${acao.key}`); setRecusa(""); setFeito("")
    try {
      const r = await fetch(`/api/workflow-step-instances/${stepInstanceId}/execucao`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({
          acao: acao.key,
          // A SUBTAREFA vai junto: sem ela, o servidor procuraria a ação nas do passo.
          subtarefa: subtarefa ?? null,
          valores: subtarefa
            ? { ...(valoresDaSub[subtarefa] ?? {}), checklist: marcadosDaSub[subtarefa] ?? {} }
            : { ...valores, checklist: marcados },
          // O MESMO CLIQUE REENVIADO não vira duas execuções: a correlação identifica
          // o comando, não a tentativa de rede.
          correlationId: `acao|si${stepInstanceId}|${subtarefa ?? "-"}|${acao.key}|${d?.execucaoAtual?.id ?? 0}`,
        }),
      })
      const j = await r.json()
      if (!j.ok) setRecusa(j.mensagem ?? "A ação não pôde ser executada.")
      else {
        setFeito(`${acao.label} — registrado.${j.concluiuPasso ? " Etapa concluída." : ""}`)
        await carregar()
        onExecutado?.()
      }
    } catch { setRecusa("Erro de conexão. Nada foi executado.") }
    finally { setEnviando(null) }
  }

  async function abrirPreview() {
    setRecusa("")
    try {
      const r = await fetch(`/api/workflow-step-instances/${stepInstanceId}/reexecutar`, { headers: headers() })
      if (!r.ok) { setRecusa("Não foi possível calcular o impacto da reexecução."); return }
      setPreview(await r.json())
    } catch { setRecusa("Erro de conexão ao calcular o impacto.") }
  }

  async function confirmarReexecucao() {
    setEnviando("__reexecutar"); setRecusa("")
    try {
      const r = await fetch(`/api/workflow-step-instances/${stepInstanceId}/reexecutar`, {
        method: "POST", headers: headers(), body: JSON.stringify({ justificativa }),
      })
      const j = await r.json()
      if (!j.ok) setRecusa(j.mensagem ?? j.error ?? "Não foi possível reexecutar.")
      else {
        setPreview(null); setJustificativa(""); setValores({}); setMarcados({})
        setFeito(`Reexecução aberta. Esta é a execução ${j.execucoes}.`)
        await carregar(); onExecutado?.()
      }
    } catch { setRecusa("Erro de conexão. Nada foi reexecutado.") }
    finally { setEnviando(null) }
  }

  if (erroCarga) {
    return (
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4 text-sm text-red-700">
        {erroCarga}
        <button onClick={() => void carregar()} className="ml-3 rounded-lg border border-[var(--border-default)] px-2.5 py-1 text-xs hover:bg-[var(--surface-secondary)]">Tentar novamente</button>
      </div>
    )
  }
  if (!d) return <div className="p-4 text-sm text-[var(--text-secondary)]">Carregando a configuração da etapa…</div>

  if (!d.configuracao) {
    return (
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-4 text-sm text-[var(--text-secondary)]">
        Esta etapa é anterior ao versionamento da configuração e não tem campos nem resultados cadastrados.
        Use o painel operacional da etapa.
      </div>
    )
  }

  const { configuracao: cfg } = d
  const checklistFaltando = cfg.checklist.filter((i) => i.obrigatorio && !marcados[i.key])

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-white">{cfg.label}</h3>
        {cfg.descricao && <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{cfg.descricao}</p>}
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          Configuração da versão {d.versao} · execução {d.execucaoAtual?.sequencia ?? 1}
          {d.execucoesAnteriores.length > 0 && ` · ${d.execucoesAnteriores.length} execução(ões) anterior(es)`}
        </p>
      </div>

      {/* ─────────────────────── AS SUBTAREFAS ─────────────────────── */}
      {(d.subtarefas ?? []).length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-white/70">O que fazer nesta etapa</div>
            {d.fornecedor && <span className="text-[11px] text-[var(--text-muted)]">órgão: {d.fornecedor.nome}</span>}
          </div>

          {(d.subtarefas ?? []).filter((st) => st.visivel).map((st) => {
            const aberta = subAberta === st.key
            const vals = valoresDaSub[st.key] ?? {}
            const marc = marcadosDaSub[st.key] ?? {}
            const podeAgir = st.disponivel || (st.concluida && st.podeRepetir)
            return (
              <div key={st.key} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 flex-none rounded-full ${
                        st.concluida ? "bg-green-600"
                        : st.status === "BLOQUEADO" || st.status === "PENDENTE" ? "bg-[var(--surface-secondary)]"
                        : st.status === "AGUARDANDO_EXTERNO" ? "bg-[var(--surface-secondary)]"
                        : "bg-amber-600"}`} />
                      <span className={`text-sm ${st.concluida ? "text-[var(--text-secondary)] line-through" : "text-white"}`}>{st.label}</span>
                      {st.obrigatoria && !st.concluida && <span className="rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 text-[10px] text-amber-700">obrigatória</span>}
                      {st.ocorrencias > 1 && <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">{st.ocorrencias}ª vez</span>}
                    </div>
                    {st.descricao && <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{st.descricao}</p>}
                    {/* O MOTIVO VEM DO SERVIDOR. A tela não deduz por que está bloqueada. */}
                    {!st.disponivel && !st.concluida && st.bloqueioTexto && (
                      <p className="mt-1 text-[11px] text-amber-700/70">{st.bloqueioTexto}</p>
                    )}
                    {st.concluida && st.execucao?.resultado && (
                      <p className="mt-1 text-[11px] text-green-700/60">
                        {st.execucao.resultado}
                        {st.execucao.completedAt && ` · ${new Date(st.execucao.completedAt).toLocaleDateString("pt-BR")}`}
                      </p>
                    )}
                  </div>
                  {podeAgir && (
                    <button onClick={() => setSubAberta(aberta ? null : st.key)}
                      className="flex-none rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-1.5 text-xs text-white/70 hover:bg-[var(--surface-hover)]">
                      {aberta ? "Fechar" : st.concluida ? "Fazer de novo" : "Abrir"}
                    </button>
                  )}
                </div>

                {aberta && (
                  <div className="mt-3 space-y-3 border-t border-[var(--border-default)] pt-3">
                    {/* OS CANAIS vêm do fornecedor concreto — não do catálogo inteiro. */}
                    {st.canais.length > 0 && (
                      <div>
                        <label className={lbl}>Por onde enviar</label>
                        <select className={inp} value={String(vals.canal ?? "")}
                          onChange={(e) => setValoresDaSub({ ...valoresDaSub, [st.key]: { ...vals, canal: e.target.value } })}>
                          <option value="">— escolher —</option>
                          {st.canais.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>
                        {(() => {
                          const c = st.canais.find((x) => x.key === vals.canal)
                          if (!c) return null
                          const exige = [
                            c.exigeProtocolo ? "protocolo" : null, c.exigeAnexo ? "comprovante" : null,
                            c.exigeRastreio ? "rastreio" : null, c.exigeObservacao ? "observação" : null,
                          ].filter(Boolean)
                          return (
                            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                              {c.endereco ? `${c.endereco} · ` : ""}
                              {exige.length ? `exige ${exige.join(", ")}.` : "não exige comprovação específica."}
                            </p>
                          )
                        })()}
                      </div>
                    )}

                    {st.definicao.campos.filter((c) => visivel(c, vals)).map((c) => (
                      <div key={c.key}>
                        <label className={lbl}>{c.label}{c.obrigatorio && <span className="text-amber-700"> *</span>}</label>
                        {c.tipo === "textarea" ? (
                          <textarea className={inp} rows={3} value={String(vals[c.key] ?? "")}
                            onChange={(e) => setValoresDaSub({ ...valoresDaSub, [st.key]: { ...vals, [c.key]: e.target.value } })} />
                        ) : c.tipo === "select" || c.tipo === "multiselect" || c.tipo === "radio" || c.tipo === "referencia" ? (
                          <select className={inp} value={String(vals[c.key] ?? "")}
                            onChange={(e) => setValoresDaSub({ ...valoresDaSub, [st.key]: { ...vals, [c.key]: e.target.value } })}>
                            <option value="">— escolher —</option>
                            {c.opcoes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : (
                          <input className={inp} type={c.tipo === "data" ? "date" : c.tipo === "numero" ? "number" : "text"}
                            value={String(vals[c.key] ?? "")}
                            onChange={(e) => setValoresDaSub({ ...valoresDaSub, [st.key]: { ...vals, [c.key]: e.target.value } })} />
                        )}
                        {c.ajuda && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{c.ajuda}</p>}
                      </div>
                    ))}

                    {st.definicao.checkItens.length > 0 && (
                      <div className="space-y-1.5">
                        <label className={lbl}>Conferência</label>
                        {st.definicao.checkItens.map((it) => (
                          <label key={it.key} className="flex items-start gap-2 text-xs text-white/70">
                            <input type="checkbox" className="mt-0.5" checked={!!marc[it.key]}
                              onChange={(e) => setMarcadosDaSub({ ...marcadosDaSub, [st.key]: { ...marc, [it.key]: e.target.checked } })} />
                            <span>{it.label}{it.obrigatorio && <span className="text-amber-700"> *</span>}
                              {it.descricao && <span className="block text-[11px] text-[var(--text-muted)]">{it.descricao}</span>}</span>
                          </label>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {st.definicao.acoes.length === 0 && (
                        <p className="text-[11px] text-amber-700/70">Esta subtarefa não tem resultado cadastrado.</p>
                      )}
                      {st.definicao.acoes.map((a) => (
                        <button key={a.key} onClick={() => executar(a, st.key)}
                          disabled={enviando !== null}
                          title={a.descricao ?? undefined}
                          className="rounded-lg bg-[var(--action-primary)] px-3 py-1.5 text-xs font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)] disabled:opacity-50">
                          {enviando === `${st.key}|${a.key}` ? "Executando…" : a.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* O QUE FALTA PARA O PASSO CONCLUIR, segundo a regra cadastrada. */}
          {d.conclusao && !d.conclusao.pode && (
            <p className="text-[11px] text-amber-700/70">
              A etapa só conclui quando: {d.conclusao.faltando.map((x) => x.label).join(", ")}.
            </p>
          )}
        </div>
      )}

      {/* O CONTEXTO VEM ANTES DO FORMULÁRIO porque é o que o operador precisa ler
          para decidir o que preencher. Quais blocos aparecem é decisão do servidor,
          por passo — quem vai protocolar não precisa do parecer da validação. */}
      {(d.contexto?.blocos.length ?? 0) > 0 && (
        <div className="space-y-2">
          {d.contexto!.blocos.map((bloco) => (
            <div key={bloco.chave} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
              <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{bloco.titulo}</p>
              <dl className="mt-2 space-y-1.5">
                {bloco.itens.map((item, i) => (
                  <div key={i} className="flex flex-wrap items-baseline gap-x-2">
                    <dt className="text-xs text-[var(--text-secondary)]">{item.rotulo}</dt>
                    <dd className="text-sm text-white/85">{item.valor}</dd>
                    {item.detalhe && <span className="text-[11px] text-[var(--text-muted)]">{item.detalhe}</span>}
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}

      {cfg.campos.length > 0 && (
        <div className="space-y-3">
          {cfg.campos.filter((c) => visivel(c, valores)).map((c) => (
            <div key={c.key}>
              <label className={lbl}>{c.label}{c.obrigatorio && <span className="text-amber-700"> *</span>}</label>
              {c.tipo === "textarea" ? (
                <textarea className={inp} rows={3} value={String(valores[c.key] ?? "")} onChange={(e) => setValores({ ...valores, [c.key]: e.target.value })} />
              ) : c.tipo === "select" || c.tipo === "multiselect" || c.tipo === "referencia" ? (
                /* REFERÊNCIA a cadastro: as opções chegam resolvidas do servidor — o
                   `value` é o ID canônico e o rótulo é o nome de agora. A tela não
                   sabe de qual cadastro veio, e é por isso que um alvo novo não pede
                   componente novo. */
                <select className={inp} value={String(valores[c.key] ?? "")} onChange={(e) => setValores({ ...valores, [c.key]: e.target.value })}>
                  <option value="">— escolher —</option>
                  {c.opcoes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : c.tipo === "radio" ? (
                <div className="space-y-1">
                  {c.opcoes.map((o) => (
                    <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white/80">
                      <input type="radio" name={c.key} checked={valores[c.key] === o.value} onChange={() => setValores({ ...valores, [c.key]: o.value })} />
                      {o.label}
                    </label>
                  ))}
                </div>
              ) : c.tipo === "booleano" || c.tipo === "checkbox" ? (
                <label className="flex items-center gap-2 text-sm text-white/80">
                  <input type="checkbox" checked={!!valores[c.key]} onChange={(e) => setValores({ ...valores, [c.key]: e.target.checked })} />
                  {c.label}
                </label>
              ) : (
                <input
                  className={inp}
                  type={c.tipo === "numero" || c.tipo === "moeda" ? "number" : c.tipo === "data" ? "date" : "text"}
                  value={String(valores[c.key] ?? "")}
                  onChange={(e) => setValores({ ...valores, [c.key]: e.target.value })}
                />
              )}
              {c.ajuda && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{c.ajuda}</p>}
            </div>
          ))}
        </div>
      )}

      {cfg.checklist.length > 0 && (
        <div>
          <div className={lbl}>Conferência</div>
          <div className="space-y-1">
            {cfg.checklist.map((i) => (
              <label key={i.key} className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2">
                <input type="checkbox" className="mt-1" checked={!!marcados[i.key]} onChange={(e) => setMarcados({ ...marcados, [i.key]: e.target.checked })} />
                <span>
                  <span className="text-sm text-white/85">{i.label}</span>
                  {i.descricao && <span className="block text-[11px] text-[var(--text-muted)]">{i.descricao}</span>}
                </span>
              </label>
            ))}
          </div>
          {checklistFaltando.length > 0 && (
            <p className="mt-1 text-[11px] text-amber-700/70">{checklistFaltando.length} item(ns) de conferência ainda não marcados.</p>
          )}
        </div>
      )}

      {recusa && <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2 text-xs text-amber-100">{recusa}</div>}
      {feito && <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2 text-xs text-green-100">{feito}</div>}

      <div>
        <div className={lbl}>Resultado</div>
        {cfg.acoes.length === 0 && (
          <p className="text-xs text-[var(--text-muted)]">Nenhum resultado cadastrado para esta etapa nesta versão.</p>
        )}
        <div className="space-y-1.5">
          {cfg.acoes.map((a) => (
            <button key={a.key} onClick={() => void executar(a)} disabled={enviando != null}
              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2.5 text-left hover:bg-[var(--surface-hover)] disabled:opacity-50">
              <div className="text-sm font-medium text-white">{enviando === `-|${a.key}` ? "Executando…" : a.label}</div>
              {(a.descricao || a.efeito) && (
                <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{a.descricao ?? a.efeito?.descricao}</div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* REEXECUTAR — ato explícito, com o impacto na frente.
          Reabrir uma etapa mexe no que depende dela, e o operador não está olhando
          para isso. As três listas dizem o que muda, o que é aproveitado e o que
          fica onde está — antes de qualquer escrita. */}
      {(d.passo.status === "CONCLUIDO" || d.passo.status === "EXECUTADO") && (
        <div className="border-t border-[var(--border-default)] pt-3">
          {!preview ? (
            <button onClick={() => void abrirPreview()}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-1.5 text-xs text-white/70 hover:bg-[var(--surface-hover)]">
              Reexecutar esta etapa
            </button>
          ) : (
            <div className="space-y-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3">
              <div className="text-xs font-medium text-amber-100">O que a reexecução faz</div>
              <ul className="space-y-1 text-[11px] text-white/70">
                <li>Reexecutada: <b>{preview.seraReexecutado.map((p) => p.stepKey).join(", ") || "—"}</b></li>
                <li>Reavaliadas por dependerem dela: <b>{preview.seraoReavaliados.map((p) => p.stepKey).join(", ") || "nenhuma"}</b></li>
                <li>Herdadas (continuam valendo): <b>{preview.herdados.map((p) => p.stepKey).join(", ") || "nenhuma"}</b></li>
                <li>Intactas: <b>{preview.intactos.map((p) => p.stepKey).join(", ") || "nenhuma"}</b></li>
              </ul>
              <p className="text-[11px] text-[var(--text-secondary)]">{preview.aviso}</p>
              <div>
                <label className={lbl}>Por quê</label>
                <textarea className={inp} rows={2} value={justificativa} onChange={(e) => setJustificativa(e.target.value)}
                  placeholder="ex.: certidão recebida ilegível; refazer a conferência" />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setPreview(null)} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-1.5 text-xs text-white/70">Cancelar</button>
                <button onClick={() => void confirmarReexecucao()} disabled={enviando != null || justificativa.trim().length < 5}
                  className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-medium text-[var(--action-primary-ink)] disabled:opacity-40">
                  {enviando === "__reexecutar" ? "Reexecutando…" : "Confirmar reexecução"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {d.execucoesAnteriores.length > 0 && (
        <div className="border-t border-[var(--border-default)] pt-3">
          <div className={lbl}>Execuções anteriores</div>
          <div className="space-y-1">
            {d.execucoesAnteriores.map((t) => (
              <div key={t.id} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                <span className="text-white/75">Execução {t.sequencia}</span> · {t.status.toLowerCase()}
                {t.resultado && ` · ${t.resultado}`}
                {t.completedAt && ` · concluída em ${new Date(t.completedAt).toLocaleDateString("pt-BR")}`}
                <span className="ml-1 text-[var(--text-muted)]">({t.motivo.toLowerCase()})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
