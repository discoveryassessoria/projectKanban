// src/components/operacao/kit-operacional.tsx
// ============================================================================
// O KIT DA OPERAÇÃO — o vocabulário compartilhado das superfícies de Tarefa:
// Central de Distribuição, Minha Fila e a visão gerencial global.
//
// Nada aqui é novo. É o que a Central já usava, EXTRAÍDO para que a visão
// global reutilize em vez de reimplementar. Uma segunda implementação do
// seletor de responsável significaria, mais cedo ou mais tarde, duas regras
// diferentes para "quem pode receber trabalho".
//
// `LinhaDeFila` mora aqui pelo mesmo motivo: é o contrato de leitura da
// projeção canônica, e as três telas leem o MESMO contrato.
//
// ─── NADA AQUI ESCREVE ──────────────────────────────────────────────────────
// O seletor DEVOLVE a escolha (`aoEscolher`); quem comanda é a tela, e sempre
// por `POST /api/tarefas/{id}/comando`.
// ============================================================================
"use client"

import { useEffect, useState } from "react"
import { labelDaFasePorPhaseKey } from "@/src/lib/process-stage/fases-catalog"

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
  /** A frase única do prazo, montada no servidor — a tela só escolhe a cor. */
  rotuloDoPrazo: string
  aguardandoDependencia: boolean
  requerDecisao: boolean
  servico: string | null
  criadaEm: string | null
  atribuidaEm: string | null
}

interface Funcionario {
  id: number
  nome: string
  email?: string
  tarefasAtivas: number
  atrasadas: number
}

interface Funcionario {
  id: number
  nome: string
  tarefasAtivas: number
  atrasadas: number
}

export const auth = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") ?? "" : ""}`,
})

export /** pt-BR curto. Sem prazo é ausência de informação, não "hoje". */
function dataCurta(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

/**
 * O ESTADO OPERACIONAL EM PORTUGUÊS — o MESMO vocabulário da Central e do filtro.
 *
 * `NAO_INICIADA` aparecia como "Não iniciada" no cartão enquanto o filtro logo
 * acima dizia "A fazer" e a Central, sobre a MESMA tarefa, também dizia "A
 * fazer". Três nomes para um estado obrigam cada pessoa a montar o próprio
 * dicionário — e quem monta dicionário erra.
 *
 * "A fazer" ganha porque é o que o operador faz com a informação: é trabalho
 * que espera por ele. "Não iniciada" descreve o passado da tarefa, não o que
 * ela pede.
 */
export const ROTULO_STATUS: Record<string, string> = {
  NAO_INICIADA: "A fazer",
  EM_ANDAMENTO: "Em andamento",
  AGUARDANDO_TERCEIRO: "Aguardando terceiro",
  AGUARDANDO_CLIENTE: "Aguardando cliente",
  BLOQUEADA: "Bloqueada",
  CONCLUIDO_RECEBIDO: "Concluída",
  CONCLUIDO_NAO_POSSUI: "Concluída",
  CANCELADA: "Cancelada",
  SUPERSEDIDA: "Substituída",
}
export const ROTULO_PRIORIDADE: Record<string, string> = { URGENTE: "Urgente", ALTA: "Alta", MEDIA: "Média", BAIXA: "Baixa" }

/**
 * A fase vem como chave técnica; a tela mostra gente, não `faseMacroKey`.
 *
 * O nome vem do CATÁLOGO publicado — é lá que a fase se chama "Emissão
 * documental", com acento. Desenrolar o underscore é o último recurso, para
 * uma chave que o catálogo não conheça: melhor um nome imperfeito do que uma
 * célula vazia onde deveria estar a fase.
 */
export function rotularFase(k: string | null): string | null {
  if (!k) return null
  return labelDaFasePorPhaseKey(k) ?? k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
}

export function Etiqueta({ tom, children }: { tom: "neutro" | "alerta" | "critico" | "acento"; children: React.ReactNode }) {
  const cores = {
    neutro: "bg-[var(--surface-primary)] text-[var(--text-secondary)] border-[var(--border-default)]",
    alerta: "bg-[var(--surface-secondary)] text-amber-700/90 border-[var(--border-default)]",
    critico: "bg-[var(--surface-secondary)] text-red-700/90 border-[var(--border-default)]",
    acento: "bg-[var(--surface-secondary)] text-[var(--text-secondary)]/90 border-[var(--border-default)]",
  }[tom]
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-[1px] text-[10px] font-medium leading-4 ${cores}`}>
      {children}
    </span>
  )
}

export function Estado({ tipo, mensagem, aoTentar }: { tipo: "carregando" | "vazio" | "erro"; mensagem: string; aoTentar?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      {tipo === "carregando" && <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-transparent" />}
      <p className="text-[12px] text-[var(--text-secondary)]">{mensagem}</p>
      {tipo === "erro" && aoTentar && (
        <button
          onClick={aoTentar}
          className="rounded border border-[var(--border-default)] px-3 py-1.5 text-[11px] text-white/70 transition-colors hover:bg-[var(--surface-primary)]"
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
export function SeletorResponsavel({
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--overlay-modal)] p-4" onClick={aoFechar}>
      <div
        className="w-full max-w-sm overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] shadow-[var(--elev-3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/[0.08] px-4 py-3">
          <h2 className="text-[13px] font-medium text-white/90">{titulo}</h2>
        </div>

        {erro && <div className="border-b border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-2 text-[11px] text-red-700/90">{erro}</div>}

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
              className="flex w-full items-center justify-between border-b border-white/[0.05] px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-[var(--surface-primary)] disabled:opacity-40"
            >
              <span className="min-w-0">
                <span className="block truncate text-[12px] text-white/85">{f.nome}</span>
                {/* Discreto, mas presente: dois funcionários de mesmo nome eram
                    duas linhas idênticas no seletor. */}
                {f.email && <span className="block truncate text-[10px] text-[var(--text-muted)]">{f.email}</span>}
              </span>
              <span className="text-[10px] tabular-nums text-[var(--text-muted)]">
                {f.tarefasAtivas} ativa{f.tarefasAtivas === 1 ? "" : "s"}
                {f.atrasadas > 0 && <span className="text-red-700/70"> · {f.atrasadas} atrasada{f.atrasadas === 1 ? "" : "s"}</span>}
                {f.id === atual && <span className="text-[var(--text-secondary)]"> · atual</span>}
              </span>
            </button>
          ))}
        </div>

        <div className="flex justify-end border-t border-white/[0.08] px-4 py-2.5">
          <button onClick={aoFechar} className="rounded px-3 py-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:text-white/80">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

