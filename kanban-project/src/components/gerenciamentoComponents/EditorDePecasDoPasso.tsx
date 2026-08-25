"use client"
// src/components/gerenciamentoComponents/EditorDePecasDoPasso.tsx
//
// AS PEÇAS — ações, campos, opções, checklist e requisitos.
//
// Este componente existe por um motivo estrutural, não estético: passo e subtarefa têm
// as MESMAS peças. Escrever dois editores faria a subtarefa oferecer menos que o
// passo, e a diferença apareceria meses depois como "não dá para pôr condição numa
// ação de subtarefa" — uma limitação sem razão de existir, nascida de duplicação.
//
// O componente não sabe se está editando um passo ou uma subtarefa. Ele recebe as
// listas e devolve as listas.

import type { AcaoCfg, CampoCfg, ItemCfg, RequisitoCfg, OpcaoCfg } from "./tiposDoCadastroDoPasso"
import { chaveDe, TIPOS_DE_REQUISITO, nomeDoTipoDeCampo, TIPOS_COM_OPCOES, TIPO_REFERENCIA } from "./tiposDoCadastroDoPasso"
import { ALVOS_DE_REFERENCIA, CHAVES_DE_ALVO, alvoDeReferencia, alvoDoCampo } from "@/src/lib/motor/fontes-de-campo"

export interface Efeito {
  key: string; label: string; descricao: string; competencia: string
  permitidoNestaFase: boolean; camposObrigatorios: string[]
}

const inp = "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[var(--border-default)]"
const lbl = "mb-1 block text-[11px] uppercase tracking-wide text-[var(--text-muted)]"
const card = "rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3"

export interface PecasDoPasso {
  acoes: AcaoCfg[]
  campos: CampoCfg[]
  checkItens: ItemCfg[]
  requisitos: RequisitoCfg[]
}

export default function EditorDePecasDoPasso({
  aba, pecas, aoMudar, efeitosOfertados, todosOsEfeitos = [], tiposDeCampo, avisoDoExecutor,
}: {
  aba: "campos" | "acoes" | "checklist" | "requisitos" | "evidencias"
  pecas: PecasDoPasso
  aoMudar: (patch: Partial<PecasDoPasso>) => void
  efeitosOfertados: Efeito[]
  /** TODOS os do catálogo — para explicar por que um indisponível está indisponível. */
  todosOsEfeitos?: Efeito[]
  tiposDeCampo: string[]
  avisoDoExecutor?: string | null
}) {
  const setLista = <K extends keyof PecasDoPasso>(nome: K, i: number, patch: Partial<PecasDoPasso[K][number]>) =>
    aoMudar({ [nome]: pecas[nome].map((it, j) => (j === i ? { ...it, ...patch } : it)) } as Partial<PecasDoPasso>)
  const delLista = <K extends keyof PecasDoPasso>(nome: K, i: number) =>
    aoMudar({ [nome]: pecas[nome].filter((_, j) => j !== i) } as Partial<PecasDoPasso>)
  const opcaoSet = (iCampo: number, iOpcao: number, patch: Partial<OpcaoCfg>) =>
    aoMudar({
      campos: pecas.campos.map((c, j) => j !== iCampo ? c : {
        ...c, opcoesCadastradas: (c.opcoesCadastradas ?? []).map((o, k) => (k === iOpcao ? { ...o, ...patch } : o)),
      }),
    })

  // ══════════════════════════════════════════════════════════════════════
  if (aba === "campos") return (
    <>
      <p className="text-xs text-[var(--text-secondary)]">O que o operador preenche aqui.</p>
      {pecas.campos.length === 0 && (
        <p className="rounded-lg border border-dashed border-[var(--border-default)] p-4 text-center text-xs text-[var(--text-muted)]">
          Nenhum campo configurado.
        </p>
      )}
      {pecas.campos.map((c, i) => (
        <div key={i} className={card}>
          <div className="grid grid-cols-[1fr_150px_auto] items-end gap-2">
            <div>
              <label className={lbl}>Rótulo</label>
              <input className={inp} value={c.label} onChange={(e) => setLista("campos", i, { label: e.target.value })} />
            </div>
            <div>
              <label className={lbl}>Tipo</label>
              {/* O NOME É HUMANO, a chave continua sendo a do motor. "textarea" e
                  "upload" são palavras de quem escreve o formulário. */}
              <select className={inp} value={c.tipo} onChange={(e) => setLista("campos", i, { tipo: e.target.value })}>
                {tiposDeCampo.map((t) => <option key={t} value={t}>{nomeDoTipoDeCampo(t)}</option>)}
              </select>
            </div>
            <button onClick={() => delLista("campos", i)} className="rounded-lg border border-[var(--border-default)] px-2 py-2 text-xs text-red-700 hover:bg-[var(--surface-secondary)]">Remover</button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              <input type="checkbox" checked={!!c.obrigatorio} onChange={(e) => setLista("campos", i, { obrigatorio: e.target.checked })} /> Obrigatório
            </label>
            <code className="text-[11px] text-[var(--text-muted)]" title="Chave gravada nas execuções — não muda.">{c.key ?? chaveDe(c.label)}</code>
          </div>
          {c.tipo === TIPO_REFERENCIA && (
            <div className="mt-3 rounded-lg border border-[var(--border-default)] bg-black/20 p-3">
              <label className={lbl}>Qual cadastro</label>
              {/* NÃO se escrevem opções aqui: a lista É o cadastro, e ela muda quando
                  o cadastro muda. O que se escolhe é para ONDE o campo aponta. */}
              <select
                className={inp}
                value={alvoDoCampo(c.opcoes) ?? ""}
                onChange={(e) => setLista("campos", i, {
                  opcoes: e.target.value ? { referencia: e.target.value } : null,
                  opcoesCadastradas: [],
                })}
              >
                <option value="">— escolher o cadastro —</option>
                {CHAVES_DE_ALVO.map((k) => (
                  <option key={k} value={k}>{ALVOS_DE_REFERENCIA[k].label}</option>
                ))}
              </select>
              {(() => {
                const a = alvoDeReferencia(alvoDoCampo(c.opcoes))
                return a ? (
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                    {a.descricao} Fica gravado o identificador do registro, não o nome — renomear lá
                    aparece aqui sem regravar nada.
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-amber-700/70">
                    Referência sem cadastro escolhido não deixa escolher nada — a publicação recusa.
                  </p>
                )
              })()}
            </div>
          )}
          {TIPOS_COM_OPCOES.includes(c.tipo) && (
            <div className="mt-3 rounded-lg border border-[var(--border-default)] bg-black/20 p-3">
              <div className="flex items-center justify-between">
                <label className={`${lbl} mb-0`}>Opções</label>
                <button
                  onClick={() => setLista("campos", i, { opcoesCadastradas: [...(c.opcoesCadastradas ?? []), { label: "Nova opção", ativo: true }] })}
                  className="rounded-lg border border-[var(--border-default)] px-2 py-1 text-[11px] text-white/70 hover:bg-[var(--surface-hover)]">+ Opção</button>
              </div>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                Cada opção tem chave própria. Renomear o rótulo não desliga a escolha já registrada; para tirar
                de circulação, desmarque &quot;disponível&quot;.
              </p>
              {(c.opcoesCadastradas ?? []).length === 0 && (
                <p className="mt-2 text-[11px] text-amber-700/70">
                  Campo de escolha sem opção não deixa escolher nada — a publicação recusa.
                </p>
              )}
              {(c.opcoesCadastradas ?? []).map((o, k) => (
                <div key={k} className="mt-2 grid grid-cols-[1fr_140px_auto] items-center gap-2">
                  <input className={inp} value={o.label}
                    onChange={(e) => opcaoSet(i, k, { label: e.target.value, key: o.key ?? chaveDe(e.target.value) })} />
                  <code className="truncate text-[11px] text-[var(--text-muted)]">{o.key ?? chaveDe(o.label)}</code>
                  <label className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-[var(--text-secondary)]">
                    <input type="checkbox" checked={o.ativo !== false} onChange={(e) => opcaoSet(i, k, { ativo: e.target.checked })} />
                    disponível
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <button onClick={() => aoMudar({ campos: [...pecas.campos, { label: "Novo campo", tipo: tiposDeCampo[0] ?? "texto" }] })}
        className="rounded-lg bg-[var(--action-primary)] px-3 py-1.5 text-xs font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)]">+ Campo</button>
    </>
  )

  // ══════════════════════════════════════════════════════════════════════
  if (aba === "acoes") return (
    <>
      <p className="text-xs text-[var(--text-secondary)]">
        Os resultados que o operador pode escolher. Cada um aponta para um efeito do catálogo — a lista mostra
        <b> só</b> os que esta fase tem competência para executar e que o executor sabe disparar.
      </p>
      {pecas.acoes.length === 0 && (
        <p className="rounded-lg border border-dashed border-[var(--border-default)] p-4 text-center text-xs text-[var(--text-muted)]">
          Nenhum resultado disponível. Sem um resultado cadastrado o operador vê a etapa e não tem como fechá-la.
        </p>
      )}
      {pecas.acoes.map((a, i) => {
        const ef = efeitosOfertados.find((x) => x.key === a.effectKey)
        // O efeito EXISTE no catálogo mas não está ofertado aqui? Então dá para dizer
        // por quê — e a resposta vem do próprio catálogo, não de suposição da tela.
        const indisponivel = ef ? null : todosOsEfeitos.find((x) => x.key === a.effectKey)
        return (
          <div key={i} className={card}>
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <div>
                <label className={lbl}>Rótulo</label>
                <input className={inp} value={a.label} onChange={(e) => setLista("acoes", i, { label: e.target.value })} />
              </div>
              <button onClick={() => delLista("acoes", i)} className="rounded-lg border border-[var(--border-default)] px-2 py-2 text-xs text-red-700 hover:bg-[var(--surface-secondary)]">Remover</button>
            </div>
            <div className="mt-2">
              <label className={lbl}>O que acontece</label>
              {/* A LINGUAGEM É A DO NEGÓCIO. `COMPLETE_STEP` é a chave que o motor lê;
                  o administrador escolhe "Concluir a etapa". A chave aparece como
                  detalhe técnico, não como o nome da coisa. */}
              <select className={inp} value={a.effectKey} onChange={(e) => setLista("acoes", i, { effectKey: e.target.value })}>
                {!efeitosOfertados.some((e) => e.key === a.effectKey) && (
                  <option value={a.effectKey}>{indisponivel?.label ?? a.effectKey} — indisponível</option>
                )}
                {efeitosOfertados.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
              </select>
              {/* INDISPONÍVEL COM MOTIVO. "(indisponível nesta fase)" não diz se o
                  problema é a competência da fase ou o executor escolhido — e são
                  correções diferentes. */}
              {!efeitosOfertados.some((e) => e.key === a.effectKey) && (
                <p className="mt-1 text-[11px] text-amber-700/80">
                  {indisponivel
                    ? indisponivel.permitidoNestaFase
                      ? `O executor configurado para este passo não sabe disparar "${indisponivel.label}". Troque o executor em Avançado ou escolha outro resultado.`
                      : `Esta fase não tem competência para "${indisponivel.label}" — quem decide isso é a fase de ${indisponivel.competencia}.`
                    : `O resultado aponta para um efeito que não está no catálogo (${a.effectKey}).`}
                </p>
              )}
              {ef && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{ef.descricao}</p>}
            </div>
            <div className="mt-2">
              <label className={lbl}>Explicação para o operador</label>
              <input className={inp} value={a.descricao ?? ""} onChange={(e) => setLista("acoes", i, { descricao: e.target.value })} />
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              <input type="checkbox" checked={a.ativo !== false} onChange={(e) => setLista("acoes", i, { ativo: e.target.checked })} />
              Ativa (desmarcar tira das versões novas; o histórico continua legível)
            </label>
          </div>
        )
      })}
      <button disabled={efeitosOfertados.length === 0}
        onClick={() => aoMudar({ acoes: [...pecas.acoes, { label: "Novo resultado", effectKey: efeitosOfertados[0]?.key ?? "REGISTER_ONLY" }] })}
        className="rounded-lg bg-[var(--action-primary)] px-3 py-1.5 text-xs font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)] disabled:opacity-40">+ Resultado</button>
      {efeitosOfertados.length === 0 && (
        <p className="text-[11px] text-amber-700/70">
          Nenhum efeito disponível: a fase não declarou competência compatível com o executor escolhido.
        </p>
      )}
    </>
  )

  // ══════════════════════════════════════════════════════════════════════
  if (aba === "checklist") return (
    <>
      <p className="text-xs text-[var(--text-secondary)]">Itens de conferência.</p>
      {avisoDoExecutor && <p className="text-[11px] text-amber-700/70">{avisoDoExecutor}</p>}
      {pecas.checkItens.length === 0 && (
        <p className="rounded-lg border border-dashed border-[var(--border-default)] p-4 text-center text-xs text-[var(--text-muted)]">
          Nenhum item de conferência.
        </p>
      )}
      {pecas.checkItens.map((k, i) => (
        <div key={i} className={card}>
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <div>
              <label className={lbl}>Item</label>
              <input className={inp} value={k.label} onChange={(e) => setLista("checkItens", i, { label: e.target.value })} />
            </div>
            <button onClick={() => delLista("checkItens", i)} className="rounded-lg border border-[var(--border-default)] px-2 py-2 text-xs text-red-700 hover:bg-[var(--surface-secondary)]">Remover</button>
          </div>
          <input className={`${inp} mt-2`} placeholder="Explicação (opcional)" value={k.descricao ?? ""} onChange={(e) => setLista("checkItens", i, { descricao: e.target.value })} />
          <label className="mt-2 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <input type="checkbox" checked={k.obrigatorio !== false} onChange={(e) => setLista("checkItens", i, { obrigatorio: e.target.checked })} />
            Obrigatório
          </label>
        </div>
      ))}
      <button onClick={() => aoMudar({ checkItens: [...pecas.checkItens, { label: "Novo item" }] })}
        className="rounded-lg bg-[var(--action-primary)] px-3 py-1.5 text-xs font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)]">+ Item</button>
    </>
  )

  // ══════════════════════════════════════════════════════════════════════
  // REQUISITOS e EVIDÊNCIAS são a MESMA entidade vista por dois recortes: evidência é
  // requisito do tipo EVIDENCIA_ANEXADA. Separá-los em duas tabelas daria duas
  // respostas para "o que falta para concluir".
  const soEvidencia = aba === "evidencias"
  const visiveis = pecas.requisitos
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => (soEvidencia ? r.tipo === "EVIDENCIA_ANEXADA" : r.tipo !== "EVIDENCIA_ANEXADA"))

  return (
    <>
      <p className="text-xs text-[var(--text-secondary)]">
        {soEvidencia
          ? "Que arquivo precisa estar anexado para concluir. Evidência é um requisito do tipo “arquivo anexado”: um registro só, mostrado aqui porque tem campos próprios."
          : "O que precisa estar cumprido para concluir. O motor recusa a conclusão citando o requisito pelo nome que está aqui. As evidências ficam logo abaixo — mesma lista, agrupada à parte."}
      </p>
      {visiveis.length === 0 && (
        <p className="rounded-lg border border-dashed border-[var(--border-default)] p-4 text-center text-xs text-[var(--text-muted)]">
          {soEvidencia ? "Nenhuma evidência obrigatória." : "Nenhum requisito configurado."}
        </p>
      )}
      {visiveis.map(({ r, i }) => {
        const tipo = TIPOS_DE_REQUISITO.find((t) => t.key === r.tipo)
        const alvos =
          tipo?.alvo === "campo" ? pecas.campos.map((c) => ({ key: c.key ?? chaveDe(c.label), label: c.label }))
          : tipo?.alvo === "item" ? pecas.checkItens.map((c) => ({ key: c.key ?? chaveDe(c.label), label: c.label }))
          : tipo?.alvo === "acao" ? pecas.acoes.map((c) => ({ key: c.key ?? chaveDe(c.label), label: c.label }))
          : []
        return (
          <div key={i} className={card}>
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <div>
                <label className={lbl}>O que o operador lê quando falta</label>
                <input className={inp} value={r.label} onChange={(e) => setLista("requisitos", i, { label: e.target.value })} />
              </div>
              <button onClick={() => delLista("requisitos", i)} className="rounded-lg border border-[var(--border-default)] px-2 py-2 text-xs text-red-700 hover:bg-[var(--surface-secondary)]">Remover</button>
            </div>
            {!soEvidencia && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className={lbl}>Tipo</label>
                  <select className={inp} value={r.tipo}
                    onChange={(e) => setLista("requisitos", i, { tipo: e.target.value, alvoKey: null })}>
                    {TIPOS_DE_REQUISITO.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>{tipo?.alvo ? `Qual ${tipo.alvo}` : "Quantidade mínima"}</label>
                  {tipo?.alvo ? (
                    <select className={inp} value={r.alvoKey ?? ""}
                      onChange={(e) => setLista("requisitos", i, { alvoKey: e.target.value || null })}>
                      <option value="">(todos)</option>
                      {alvos.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                    </select>
                  ) : (
                    <input className={inp} type="number" min={1} value={r.minimo ?? 1}
                      onChange={(e) => setLista("requisitos", i, { minimo: Math.max(1, Number(e.target.value) || 1) })} />
                  )}
                </div>
              </div>
            )}
            {soEvidencia && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                <div>
                  <label className={lbl}>Quantidade mínima</label>
                  <input className={inp} type="number" min={1} value={r.minimo ?? 1}
                    onChange={(e) => setLista("requisitos", i, { minimo: Math.max(1, Number(e.target.value) || 1) })} />
                </div>
                <div>
                  <label className={lbl}>Formatos aceitos</label>
                  <input className={inp} placeholder="application/pdf, image/jpeg"
                    value={(r.mimesPermitidos ?? []).join(", ")}
                    onChange={(e) => setLista("requisitos", i, {
                      mimesPermitidos: e.target.value.split(",").map((x) => x.trim()).filter(Boolean),
                    })} />
                </div>
                <div>
                  <label className={lbl}>Quando é cobrada</label>
                  <select className={inp} value={r.momento ?? "AO_CONCLUIR"}
                    onChange={(e) => setLista("requisitos", i, { momento: e.target.value })}>
                    <option value="AO_CONCLUIR">Ao concluir</option>
                    <option value="AO_EXECUTAR_ACAO">Ao executar a ação</option>
                    <option value="SEMPRE">Sempre</option>
                  </select>
                </div>
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <input type="checkbox" checked={r.obrigatorio !== false} onChange={(e) => setLista("requisitos", i, { obrigatorio: e.target.checked })} />
                Bloqueia a conclusão (desmarcado: só avisa)
              </label>
              <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <span>Só na ação:</span>
                <select className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1 text-xs text-white"
                  value={r.acaoKey ?? ""} onChange={(e) => setLista("requisitos", i, { acaoKey: e.target.value || null })}>
                  <option value="">(na conclusão)</option>
                  {pecas.acoes.map((a) => <option key={a.key ?? a.label} value={a.key ?? chaveDe(a.label)}>{a.label}</option>)}
                </select>
              </div>
            </div>
          </div>
        )
      })}
      <button
        onClick={() => aoMudar({
          requisitos: [...pecas.requisitos, soEvidencia
            ? { label: "Nova evidência", tipo: "EVIDENCIA_ANEXADA", obrigatorio: true, minimo: 1, momento: "AO_CONCLUIR" }
            : { label: "Novo requisito", tipo: "CAMPO_PREENCHIDO", obrigatorio: true }],
        })}
        className="rounded-lg bg-[var(--action-primary)] px-3 py-1.5 text-xs font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)]">
        {soEvidencia ? "+ Evidência" : "+ Requisito"}
      </button>
    </>
  )
}
