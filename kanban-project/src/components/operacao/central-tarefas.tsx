// src/components/operacao/central-tarefas.tsx
// ============================================================================
// A OPERAÇÃO DE TAREFAS — duas leituras da MESMA tarefa.
//
//   MINHA FILA        o que EU tenho para fazer
//   SEM RESPONSÁVEL   o que existe e ainda não é de ninguém
//
// Nenhuma das duas é entidade: as duas são projeções da `Tarefa` canônica, e é
// por isso que atribuir move o trabalho de uma para a outra sem copiar nada —
// o `taskId` é o mesmo dos dois lados.
//
// ─── UMA TAREFA, NÃO OITO ───────────────────────────────────────────────────
// Uma tarefa com oito etapas internas aparece como UMA linha, com a etapa
// corrente escrita embaixo do título. Listar etapa como se fosse tarefa era o
// desenho antigo: sete linhas para a mesma certidão, sete prazos, sete donos.
//
// ─── ESTA TELA NÃO ESCREVE ──────────────────────────────────────────────────
// Toda mudança sai por `POST /api/tarefas/{id}/comando`. Não existe aqui
// nenhum caminho que toque em Tarefa ou em passo.
// ============================================================================
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { TarefaOperacional } from "./tarefa-operacional"
// O vocabulário visual e o seletor de responsável são COMPARTILHADOS com a
// visão gerencial global — mesma implementação, não uma cópia parecida.
import {
  auth, dataCurta, Estado, Etiqueta, ROTULO_PRIORIDADE, ROTULO_STATUS,
  rotularFase, SeletorResponsavel, type LinhaDeFila,
} from "./kit-operacional"

export type { LinhaDeFila }

type Visao = "minha_fila" | "sem_responsavel"
type Modo = "lista" | "calendario"

/**
 * UMA LINHA = UMA TAREFA.
 *
 * Densa de propósito: quem opera precisa varrer a lista, não admirar cartões.
 * A hierarquia é título → causa (quem/o quê) → etapa corrente; o resto é
 * informação de decisão (prazo, status, prioridade) alinhada à direita.
 */
function Linha({
  l,
  acao,
  aoAbrir,
}: {
  l: LinhaDeFila
  acao?: React.ReactNode
  aoAbrir?: () => void
}) {
  const contexto = [l.processoNome, l.pessoaNome, l.servico].filter(Boolean).join(" · ")
  return (
    <div className="group grid grid-cols-[1fr_auto] items-start gap-4 border-b border-white/[0.06] px-4 py-3 last:border-b-0 hover:bg-white/[0.02]">
      {/* Clicar na linha abre a TAREFA — é o gesto natural, e é por ele que o
          funcionário chega ao workflow interno sem passar pelo processo. */}
      <button type="button" onClick={aoAbrir} className="min-w-0 cursor-pointer text-left">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-white/90">{l.titulo}</span>
          {l.atrasada && <Etiqueta tom="critico">Atrasada</Etiqueta>}
          {l.prioridade === "URGENTE" && <Etiqueta tom="alerta">Urgente</Etiqueta>}
          {l.aguardandoDependencia && <Etiqueta tom="neutro">Depende de outra</Etiqueta>}
          {l.requerDecisao && <Etiqueta tom="alerta">Requer decisão</Etiqueta>}
        </div>
        {contexto && <div className="mt-0.5 truncate text-[11px] text-white/45">{contexto}</div>}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/40">
          {l.etapaAtual && (
            <span>
              <span className="text-white/30">Etapa atual:</span> <span className="text-white/60">{l.etapaAtual}</span>
            </span>
          )}
          {rotularFase(l.faseMacroKey) && <span className="text-white/35">{rotularFase(l.faseMacroKey)}</span>}
          {l.responsavelNome && <span className="text-white/35">{l.responsavelNome}</span>}
          {/* HÁ QUANTO TEMPO ESTE TRABALHO ESPERA. Quem distribui precisa ver
              o que está parado há mais tempo, não só o que vence antes — um
              pedido de duas semanas sem dono não aparece na régua de prazo. */}
          {l.criadaEm && <span className="text-white/30">Entrou em {dataCurta(l.criadaEm)}</span>}
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-4">
        <div className="text-right">
          <div className={`text-[12px] tabular-nums ${l.atrasada ? "text-red-300/90" : "text-white/70"}`}>
            {dataCurta(l.dataPrazo)}
          </div>
          <div className="mt-0.5 text-[10px] text-white/35">
            {ROTULO_STATUS[l.statusTarefa] ?? l.statusTarefa} · {ROTULO_PRIORIDADE[l.prioridade] ?? l.prioridade}
          </div>
        </div>
        {acao}
      </div>
    </div>
  )
}

/**
 * O CALENDÁRIO É UMA LEITURA DA MESMA FILA — não uma tela de tarefas paralela.
 *
 * Era a única capacidade que a tela antiga de Atividades tinha e a operação
 * canônica não: ver o trabalho distribuído no tempo. Ela volta aqui como MODO
 * de exibição da projeção que já existe — mesma consulta, mesma tarefa, mesmo
 * taskId. Sem prazo não há lugar no calendário; essas ficam num grupo próprio,
 * porque some-las seria esconder trabalho.
 */
function agruparPorDia(linhas: LinhaDeFila[]): Array<{ dia: string; rotulo: string; linhas: LinhaDeFila[] }> {
  const porDia = new Map<string, LinhaDeFila[]>()
  for (const l of linhas) {
    const dia = l.dataPrazo ? l.dataPrazo.slice(0, 10) : "sem-prazo"
    const atual = porDia.get(dia)
    if (atual) atual.push(l)
    else porDia.set(dia, [l])
  }
  const hoje = new Date().toISOString().slice(0, 10)
  return [...porDia.entries()]
    .sort((a, b) => (a[0] === "sem-prazo" ? 1 : b[0] === "sem-prazo" ? -1 : a[0].localeCompare(b[0])))
    .map(([dia, ls]) => ({
      dia,
      rotulo:
        dia === "sem-prazo" ? "Sem prazo definido"
        : dia === hoje ? `Hoje · ${dataCurta(dia)}`
        : dia < hoje ? `Vencido · ${dataCurta(dia)}`
        : dataCurta(dia),
      linhas: ls,
    }))
}

/** Os quatro estados obrigatórios de qualquer superfície do Discovery. */
export function CentralTarefas({ podeDistribuir }: { podeDistribuir: boolean }) {
  const [visao, setVisao] = useState<Visao>(podeDistribuir ? "sem_responsavel" : "minha_fila")
  const [resultado, setResultado] = useState<{ chave: string; lista: LinhaDeFila[] | null } | null>(null)
  const [recarga, setRecarga] = useState(0)
  const [alvo, setAlvo] = useState<LinhaDeFila | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erroComando, setErroComando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [aberta, setAberta] = useState<number | null>(null)
  const [modo, setModo] = useState<Modo>("lista")

  // Mesma disciplina do seletor: o pedido tem chave, o "carregando" é derivado
  // e a resposta atrasada de uma aba não pinta a lista da outra.
  const chave = `${visao}#${recarga}`
  useEffect(() => {
    let vivo = true
    fetch(`/api/operacao/tarefas?visao=${visao}`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { linhas?: LinhaDeFila[] }) => { if (vivo) setResultado({ chave, lista: d.linhas ?? [] }) })
      .catch(() => { if (vivo) setResultado({ chave, lista: null }) })
    return () => { vivo = false }
  }, [chave, visao])

  const carregando = resultado?.chave !== chave
  const linhas = carregando ? null : resultado?.lista ?? null
  const falhou = !carregando && linhas == null
  const carregar = useCallback(() => setRecarga((n) => n + 1), [])

  /**
   * TODA MUDANÇA SAI POR UMA PORTA SÓ.
   *
   * Inclusive o conflito: quando outro gestor mexeu na tarefa antes, a porta
   * responde 409 e a tela DIZ isso e recarrega — em vez de sobrescrever em
   * silêncio a decisão de quem chegou primeiro.
   */
  const comandar = useCallback(
    async (tarefaId: number, corpo: Record<string, unknown>, sucesso: string) => {
      setOcupado(true)
      setErroComando(null)
      try {
        const r = await fetch(`/api/tarefas/${tarefaId}/comando`, {
          method: "POST",
          headers: auth(),
          body: JSON.stringify(corpo),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) {
          const conflito = r.status === 409
          setErroComando(conflito ? "Esta tarefa foi alterada por outro usuário. A lista foi atualizada." : (d.error ?? "Não foi possível concluir a ação."))
          if (conflito) { setAlvo(null); carregar() }
          return false
        }
        setAlvo(null)
        setAviso(sucesso)
        carregar()
        return true
      } catch {
        setErroComando("Falha de rede. Tente novamente.")
        return false
      } finally {
        setOcupado(false)
      }
    },
    [carregar],
  )

  const contagem = useMemo(() => linhas?.length ?? 0, [linhas])

  const abas: Array<{ id: Visao; rotulo: string }> = [
    ...(podeDistribuir ? [{ id: "sem_responsavel" as const, rotulo: "Sem responsável" }] : []),
    { id: "minha_fila", rotulo: "Minha fila" },
  ]

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-3 flex items-end justify-between">
        <div className="flex gap-1">
          {abas.map((a) => (
            <button
              key={a.id}
              onClick={() => setVisao(a.id)}
              className={`rounded-t border-b-2 px-3 py-1.5 text-[12px] transition-colors ${
                visao === a.id
                  ? "border-sky-400/70 text-white/90"
                  : "border-transparent text-white/40 hover:text-white/70"
              }`}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 pb-1.5">
          {!carregando && linhas != null && (
            <span className="text-[11px] tabular-nums text-white/35">
              {contagem} tarefa{contagem === 1 ? "" : "s"}
            </span>
          )}
          <div className="flex gap-1">
            {(["lista", "calendario"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setModo(m)}
                className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                  modo === m ? "bg-white/[0.08] text-white/80" : "text-white/35 hover:text-white/60"
                }`}
              >
                {m === "lista" ? "Lista" : "Calendário"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {aviso && (
        <div className="mb-2 rounded border border-sky-300/20 bg-sky-400/[0.07] px-3 py-2 text-[11px] text-sky-100/85">
          {aviso}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.02]">
        {falhou && <Estado tipo="erro" mensagem="Não foi possível carregar as tarefas." aoTentar={carregar} />}
        {carregando && <Estado tipo="carregando" mensagem="Carregando tarefas…" />}
        {!falhou && linhas?.length === 0 && (
          <Estado
            tipo="vazio"
            mensagem={
              visao === "sem_responsavel"
                ? "Nenhuma tarefa aguardando distribuição."
                : "Você não tem tarefas em aberto."
            }
          />
        )}
        {modo === "calendario" && linhas != null && linhas.length > 0 &&
          agruparPorDia(linhas).map((grupo) => (
            <div key={grupo.dia}>
              <div className="sticky top-0 border-b border-white/[0.06] bg-[#0d0f13] px-4 py-1.5 text-[10px] uppercase tracking-wide text-white/40">
                {grupo.rotulo} · {grupo.linhas.length}
              </div>
              {grupo.linhas.map((l) => (
                <Linha key={l.taskId} l={l} aoAbrir={() => setAberta(l.taskId)} />
              ))}
            </div>
          ))}

        {modo === "lista" && linhas?.map((l) => (
          <Linha
            key={l.taskId}
            l={l}
            aoAbrir={() => setAberta(l.taskId)}
            acao={
              podeDistribuir ? (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => { setErroComando(null); setAlvo(l) }}
                    className="rounded border border-white/15 px-2.5 py-1 text-[11px] text-white/75 transition-colors hover:border-white/30 hover:bg-white/[0.06]"
                  >
                    {l.responsavelId == null ? "Atribuir" : "Transferir"}
                  </button>
                  {/* RETIRAR fica NA LINHA, junto do trabalho a que se refere.
                      Antes era uma barra flutuante que só aparecia com o
                      seletor aberto — ou seja, para devolver a tarefa à
                      distribuição era preciso primeiro fingir que ia
                      transferi-la. */}
                  {l.responsavelId != null && (
                    <button
                      disabled={ocupado}
                      onClick={() => void comandar(l.taskId, { acao: "devolver_a_fila" }, "Tarefa devolvida para Sem responsável.")}
                      className="rounded px-2 py-1 text-[11px] text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/75 disabled:opacity-40"
                      title="Remover o responsável e devolver para distribuição"
                    >
                      Retirar
                    </button>
                  )}
                </div>
              ) : undefined
            }
          />
        ))}
      </div>

      {aberta != null && (
        <TarefaOperacional taskId={aberta} aoFechar={() => setAberta(null)} aoMudar={carregar} />
      )}

      {alvo && (
        <SeletorResponsavel
          titulo={alvo.responsavelId == null ? "Atribuir tarefa" : `Transferir de ${alvo.responsavelNome ?? "—"}`}
          atual={alvo.responsavelId}
          ocupado={ocupado}
          erro={erroComando}
          aoFechar={() => { setAlvo(null); setErroComando(null) }}
          aoEscolher={(responsavelId) =>
            void comandar(
              alvo.taskId,
              // A porta é a mesma; o verbo muda conforme já havia dono. Quem
              // decide isso é o estado da tarefa, não o botão.
              { acao: alvo.responsavelId == null ? "atribuir" : "transferir", responsavelId },
              alvo.responsavelId == null ? "Tarefa atribuída." : "Tarefa transferida.",
            )
          }
        />
      )}

    </div>
  )
}
