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
// nenhum caminho que toque em Tarefa ou em passo — nem a árvore legada de
// subtarefas (tarefaPaiId / COBRANCA / CONFERENCIA), que esta superfície não
// usa em lugar nenhum.
// ============================================================================
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { TarefaOperacional } from "./tarefa-operacional"

export interface LinhaDeFila {
  taskId: number
  titulo: string
  processoId: number | null
  processoNome: string | null
  pessoaNome: string | null
  faseMacroKey: string | null
  etapaAtual: string | null
  statusTarefa: string
  equipeKey: string | null
  responsavelId: number | null
  responsavelNome: string | null
  prioridade: string
  dataPrazo: string | null
  atrasada: boolean
  diasParaPrazo: number | null
  aguardandoDependencia: boolean
  requerDecisao: boolean
  servico: string | null
  criadaEm: string | null
  atribuidaEm: string | null
}

interface Funcionario {
  id: number
  nome: string
  tarefasAtivas: number
  atrasadas: number
}

type Visao = "minha_fila" | "sem_responsavel"

const auth = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") ?? "" : ""}`,
})

/** pt-BR curto. Sem prazo é ausência de informação, não "hoje". */
function dataCurta(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

const ROTULO_STATUS: Record<string, string> = {
  NAO_INICIADA: "Não iniciada",
  EM_ANDAMENTO: "Em andamento",
  AGUARDANDO_TERCEIRO: "Aguardando terceiro",
  AGUARDANDO_CLIENTE: "Aguardando cliente",
  BLOQUEADA: "Bloqueada",
}
const ROTULO_PRIORIDADE: Record<string, string> = { URGENTE: "Urgente", ALTA: "Alta", MEDIA: "Média", BAIXA: "Baixa" }

/** A fase vem como chave técnica; a tela mostra gente, não `faseMacroKey`. */
function rotularFase(k: string | null): string | null {
  if (!k) return null
  return k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
}

function Etiqueta({ tom, children }: { tom: "neutro" | "alerta" | "critico" | "acento"; children: React.ReactNode }) {
  const cores = {
    neutro: "bg-white/[0.06] text-white/60 border-white/10",
    alerta: "bg-amber-400/10 text-amber-200/90 border-amber-300/25",
    critico: "bg-red-500/10 text-red-200/90 border-red-400/25",
    acento: "bg-sky-400/10 text-sky-200/90 border-sky-300/25",
  }[tom]
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-[1px] text-[10px] font-medium leading-4 ${cores}`}>
      {children}
    </span>
  )
}

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

/** Os quatro estados obrigatórios de qualquer superfície do Discovery. */
function Estado({ tipo, mensagem, aoTentar }: { tipo: "carregando" | "vazio" | "erro"; mensagem: string; aoTentar?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      {tipo === "carregando" && <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/25 border-t-transparent" />}
      <p className="text-[12px] text-white/45">{mensagem}</p>
      {tipo === "erro" && aoTentar && (
        <button
          onClick={aoTentar}
          className="rounded border border-white/15 px-3 py-1.5 text-[11px] text-white/70 transition-colors hover:bg-white/[0.06]"
        >
          Tentar novamente
        </button>
      )}
    </div>
  )
}

/**
 * O SELETOR DE FUNCIONÁRIO.
 *
 * Mostra nome e, discretamente, a carga atual vinda da projeção canônica — não
 * é recomendação nem balanceamento, é informação para quem decide. A lista vem
 * do servidor filtrada por PERMISSÃO de executar tarefa: atribuir a quem não
 * pode executar cria uma tarefa que nasce travada.
 */
function SeletorResponsavel({
  titulo,
  atual,
  aoEscolher,
  aoFechar,
  ocupado,
  erro,
}: {
  titulo: string
  atual: number | null
  aoEscolher: (id: number) => void
  aoFechar: () => void
  ocupado: boolean
  erro: string | null
}) {
  // O RESULTADO CARREGA A CHAVE DO PEDIDO QUE O PRODUZIU.
  //
  // "Carregando" vira DERIVAÇÃO (`resultado.chave !== chave`) em vez de um
  // `setState(null)` no corpo do efeito. Além de não disparar render em
  // cascata, isso mata a corrida clássica: a resposta de um pedido antigo não
  // consegue se passar pela do pedido atual.
  const [resultado, setResultado] = useState<{ chave: number; lista: Funcionario[] | null } | null>(null)
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    let vivo = true
    fetch("/api/operacao/atribuiveis", { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { funcionarios?: Funcionario[] }) => { if (vivo) setResultado({ chave: tentativa, lista: d.funcionarios ?? [] }) })
      .catch(() => { if (vivo) setResultado({ chave: tentativa, lista: null }) })
    return () => { vivo = false }
  }, [tentativa])

  const carregando = resultado?.chave !== tentativa
  const funcionarios = carregando ? null : resultado?.lista ?? null
  const falhou = !carregando && funcionarios == null
  const carregar = () => setTentativa((n) => n + 1)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={aoFechar}>
      <div
        className="w-full max-w-sm overflow-hidden rounded-lg border border-white/10 bg-[#0d0f13] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/[0.08] px-4 py-3">
          <h2 className="text-[13px] font-medium text-white/90">{titulo}</h2>
        </div>

        {erro && <div className="border-b border-red-400/20 bg-red-500/10 px-4 py-2 text-[11px] text-red-200/90">{erro}</div>}

        <div className="max-h-72 overflow-y-auto">
          {falhou && <Estado tipo="erro" mensagem="Não foi possível carregar os funcionários." aoTentar={carregar} />}
          {carregando && <Estado tipo="carregando" mensagem="Carregando funcionários…" />}
          {!falhou && funcionarios?.length === 0 && (
            <Estado tipo="vazio" mensagem="Ninguém tem permissão para executar tarefas." />
          )}
          {funcionarios?.map((f) => (
            <button
              key={f.id}
              disabled={ocupado || f.id === atual}
              onClick={() => aoEscolher(f.id)}
              className="flex w-full items-center justify-between border-b border-white/[0.05] px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-white/[0.04] disabled:opacity-40"
            >
              <span className="text-[12px] text-white/85">{f.nome}</span>
              <span className="text-[10px] tabular-nums text-white/35">
                {f.tarefasAtivas} ativa{f.tarefasAtivas === 1 ? "" : "s"}
                {f.atrasadas > 0 && <span className="text-red-300/70"> · {f.atrasadas} atrasada{f.atrasadas === 1 ? "" : "s"}</span>}
                {f.id === atual && <span className="text-white/50"> · atual</span>}
              </span>
            </button>
          ))}
        </div>

        <div className="flex justify-end border-t border-white/[0.08] px-4 py-2.5">
          <button onClick={aoFechar} className="rounded px-3 py-1.5 text-[11px] text-white/50 transition-colors hover:text-white/80">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

export function CentralTarefas({ podeDistribuir }: { podeDistribuir: boolean }) {
  const [visao, setVisao] = useState<Visao>(podeDistribuir ? "sem_responsavel" : "minha_fila")
  const [resultado, setResultado] = useState<{ chave: string; lista: LinhaDeFila[] | null } | null>(null)
  const [recarga, setRecarga] = useState(0)
  const [alvo, setAlvo] = useState<LinhaDeFila | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erroComando, setErroComando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [aberta, setAberta] = useState<number | null>(null)

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
        {!carregando && linhas != null && (
          <span className="pb-1.5 text-[11px] tabular-nums text-white/35">
            {contagem} tarefa{contagem === 1 ? "" : "s"}
          </span>
        )}
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
        {linhas?.map((l) => (
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
