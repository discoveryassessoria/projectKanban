"use client"

// ============================================================================
// CONFIGURAÇÃO DA PLANILHA DOCUMENTAL — quais itens do cadastro viram coluna.
//
// A tela NÃO cadastra serviço, NÃO cadastra documento e NÃO tem campo de preço.
// Ela escolhe, entre o que JÁ existe no Cadastro Mestre, o que aparece como
// coluna — e em que ordem. Preço continua vivendo só na Tabela de Preços.
//
// A configuração é GLOBAL: a planilha é a mesma para todos os processos. A
// versão anterior deixava cada processo criar as suas próprias colunas por
// nome, e o resultado era uma lista diferente em cada processo, sem vínculo
// com cadastro nem com preço.
// ============================================================================

import { useCallback, useEffect, useState } from "react"
import { ArrowDown, ArrowUp, Plus, Trash2, Eye, EyeOff, Info } from "lucide-react"

interface Coluna {
  id: number
  origem: "SERVICO" | "DOCUMENTO"
  estrategia: "SERVICO_FIXO" | "ITEM_DO_REGISTRO"
  categoriaItemId: number | null
  categoriaItemNome: string | null
  configId: number | null
  tipoDocumentoId: number | null
  posicao: number
  ativa: boolean
  rotulo: string
  rotuloCanonico: string
  rotuloOverride: string | null
}
interface Item { id: number; nome: string; codigo: string | null; jaEhColuna: boolean }
interface Categoria { id: number; nome: string; codigo: string; itens: number; jaEhColuna: boolean }

/**
 * AS TRÊS MANEIRAS DE UMA COLUNA EXISTIR — e por que a do meio é a certa para
 * "Certidão Inteiro Teor".
 *
 * A planilha é uma MATRIZ: o registro civil é a LINHA, a etapa é a COLUNA.
 * Escolher um documento específico ("Certidão de Nascimento - Inteiro Teor")
 * como coluna mistura as duas dimensões — ele pertence à linha. É o que
 * produzia colunas repetidas, uma por certidão, com a metade das células
 * estruturalmente vazia.
 */
const TIPOS_DE_COLUNA = [
  {
    chave: "ETAPA" as const,
    rotulo: "Etapa sobre o registro",
    ajuda: "Uma coluna para as três linhas. O item é resolvido pelo registro da linha — é assim que \u201CCertid\u00e3o Inteiro Teor\u201D vale nascimento, casamento e óbito.",
  },
  {
    chave: "SERVICO" as const,
    rotulo: "Serviço fixo",
    ajuda: "O mesmo serviço em todas as linhas (tradução, apostilamento).",
  },
  {
    chave: "DOCUMENTO" as const,
    rotulo: "Documento específico",
    ajuda: "Raro. Um documento que não é registro civil e não varia por linha.",
  },
]

const COLUNAS_FIXAS = ["Data", "Local", "Dados do registro", "Cônjuge", "Genitores", "Observação"]

export function ConfiguracaoPlanilhaDocumental() {
  const [colunas, setColunas] = useState<Coluna[]>([])
  const [servicos, setServicos] = useState<Item[]>([])
  const [documentos, setDocumentos] = useState<Item[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [adicionando, setAdicionando] = useState(false)
  const [tipo, setTipo] = useState<"ETAPA" | "SERVICO" | "DOCUMENTO">("ETAPA")
  const [busca, setBusca] = useState("")

  const token = () => (typeof window === "undefined" ? "" : localStorage.getItem("authToken") ?? "")
  const cabecalho = useCallback(
    () => ({ "Content-Type": "application/json", Authorization: `Bearer ${token()}` }),
    [],
  )

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const r = await fetch("/api/financeiro/planilha-colunas", { headers: cabecalho() })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
      const d = await r.json()
      setColunas(d.colunas ?? [])
      setServicos(d.disponiveis?.servicos ?? [])
      setDocumentos(d.disponiveis?.documentos ?? [])
      setCategorias(d.categorias ?? [])
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar a configuração.")
    } finally {
      setCarregando(false)
    }
  }, [cabecalho])

  // A carga inicial não passa por `carregar` de propósito: chamá-la aqui
  // atualizaria estado de forma síncrona com o efeito, que é o que produz render
  // em cascata. O efeito só dispara a busca; o estado muda quando ela responde.
  useEffect(() => {
    let vivo = true
    fetch("/api/financeiro/planilha-colunas", { headers: cabecalho() })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
        return r.json()
      })
      .then((d) => {
        if (!vivo) return
        setColunas(d.colunas ?? [])
        setServicos(d.disponiveis?.servicos ?? [])
        setDocumentos(d.disponiveis?.documentos ?? [])
        setCategorias(d.categorias ?? [])
        setCarregando(false)
      })
      .catch((e: unknown) => {
        if (!vivo) return
        setErro(e instanceof Error ? e.message : "Não foi possível carregar a configuração.")
        setCarregando(false)
      })
    return () => { vivo = false }
  }, [cabecalho])

  const acao = async (fn: () => Promise<Response>) => {
    setErro(null)
    const r = await fn()
    if (!r.ok) {
      setErro((await r.json().catch(() => ({}))).error ?? "A operação não foi concluída.")
      return
    }
    await carregar()
  }

  const adicionar = (itemId: number) =>
    acao(() => fetch("/api/financeiro/planilha-colunas", {
      method: "POST",
      headers: cabecalho(),
      body: JSON.stringify(
        // Coluna de ETAPA manda a CATEGORIA, não o item: quem escolhe o item é
        // a linha, no momento em que a célula é resolvida.
        tipo === "ETAPA"
          ? { estrategia: "ITEM_DO_REGISTRO", categoriaItemId: itemId }
          : { origem: tipo, itemId },
      ),
    })).then(() => { setAdicionando(false); setBusca("") })

  const alternar = (c: Coluna) =>
    acao(() => fetch(`/api/financeiro/planilha-colunas/${c.id}`, {
      method: "PATCH", headers: cabecalho(), body: JSON.stringify({ ativa: !c.ativa }),
    }))

  const remover = (c: Coluna) =>
    acao(() => fetch(`/api/financeiro/planilha-colunas/${c.id}`, { method: "DELETE", headers: cabecalho() }))

  const mover = (i: number, delta: number) => {
    const alvo = i + delta
    if (alvo < 0 || alvo >= colunas.length) return
    const ordem = [...colunas]
    ;[ordem[i], ordem[alvo]] = [ordem[alvo], ordem[i]]
    setColunas(ordem) // otimista: a seta responde na hora
    void acao(() => fetch("/api/financeiro/planilha-colunas/ordem", {
      method: "PATCH", headers: cabecalho(), body: JSON.stringify({ ids: ordem.map((c) => c.id) }),
    }))
  }

  const itens = (
    tipo === "ETAPA"
      ? categorias.map((c) => ({ id: c.id, nome: c.nome, codigo: `${c.itens} item(ns)`, jaEhColuna: c.jaEhColuna }))
      : tipo === "SERVICO" ? servicos : documentos
  ).filter((i) => !i.jaEhColuna && i.nome.toLowerCase().includes(busca.trim().toLowerCase()))

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Colunas da Planilha Documental</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Escolha quais itens do Cadastro Mestre aparecem como coluna. O valor de cada célula
          continua vindo da Tabela de Preços — nada aqui define preço.
        </p>
      </header>

      {erro && (
        <div className="rounded-[var(--radius-sm)] border border-[var(--danger)] bg-[var(--danger-bg,transparent)] px-3 py-2 text-sm text-[var(--danger)]">
          {erro}
        </div>
      )}

      <section>
        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Colunas fixas</h3>
        <div className="flex flex-wrap gap-1.5">
          {COLUNAS_FIXAS.map((c) => (
            <span key={c} className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-hover)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">
              {c}
            </span>
          ))}
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <Info className="h-3 w-3" /> Estruturais: vêm do documento e da árvore, não da Tabela de Preços.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Serviços e documentos exibidos
        </h3>

        {carregando ? (
          <p className="text-sm text-[var(--text-muted)]">Carregando…</p>
        ) : colunas.length === 0 ? (
          <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-default)] px-4 py-6 text-center text-sm text-[var(--text-muted)]">
            Nenhuma coluna econômica configurada. A planilha mostra só as colunas fixas.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-default)] rounded-[var(--radius-md)] border border-[var(--border-default)]">
            {colunas.map((c, i) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="flex flex-col">
                  <button onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir"
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => mover(i, 1)} disabled={i === colunas.length - 1} aria-label="Descer"
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="min-w-0 flex-1">
                  <div className={`truncate text-sm ${c.ativa ? "text-[var(--text-primary)]" : "text-[var(--text-muted)] line-through"}`}>
                    {c.rotulo}
                  </div>
                  <div className="truncate text-[11px] text-[var(--text-muted)]">
                    {c.estrategia === "ITEM_DO_REGISTRO"
                      ? `Etapa · resolve o item pelo registro da linha · ${c.categoriaItemNome ?? c.rotuloCanonico}`
                      : `${c.origem === "SERVICO" ? "Serviço" : "Documento"} · ${c.rotuloCanonico}`}
                  </div>
                </div>

                <span className={`text-[11px] ${c.ativa ? "text-[var(--success)]" : "text-[var(--text-muted)]"}`}>
                  {c.ativa ? "Ativo" : "Inativo"}
                </span>
                <button onClick={() => void alternar(c)} title={c.ativa ? "Inativar (esconde; não apaga nada)" : "Reativar"}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  {c.ativa ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button onClick={() => void remover(c)} title="Remover da planilha (serviço, preço e histórico permanecem)"
                  className="text-[var(--text-muted)] hover:text-[var(--danger)]">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {!adicionando ? (
          <button onClick={() => setAdicionando(true)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">
            <Plus className="h-3.5 w-3.5" /> Adicionar coluna
          </button>
        ) : (
          <div className="mt-3 space-y-2 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3">
            <div className="flex flex-wrap gap-2">
              {TIPOS_DE_COLUNA.map((t) => (
                <button key={t.chave} onClick={() => { setTipo(t.chave); setBusca("") }} title={t.ajuda}
                  className={`rounded-[var(--radius-sm)] border px-3 py-1 text-xs ${
                    tipo === t.chave
                      ? "border-[var(--border-strong)] bg-[var(--surface-active)] text-[var(--text-primary)]"
                      : "border-[var(--border-default)] text-[var(--text-muted)]"
                  }`}>
                  {t.rotulo}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              {TIPOS_DE_COLUNA.find((t) => t.chave === tipo)?.ajuda}
            </p>
            <input value={busca} onChange={(e) => setBusca(e.target.value)}
              placeholder={tipo === "ETAPA" ? "Buscar categoria do catálogo…" : "Buscar no cadastro mestre…"}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)]" />
            <ul className="max-h-56 overflow-y-auto">
              {itens.length === 0 ? (
                <li className="px-1 py-2 text-xs text-[var(--text-muted)]">
                  Nada disponível — ou já é coluna, ou não há item cadastrado com esse nome.
                </li>
              ) : itens.slice(0, 40).map((i) => (
                <li key={i.id}>
                  <button onClick={() => void adicionar(i.id)}
                    className="w-full rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">
                    {i.nome} {i.codigo && <span className="text-[11px] text-[var(--text-muted)]">· {i.codigo}</span>}
                  </button>
                </li>
              ))}
            </ul>
            <button onClick={() => { setAdicionando(false); setBusca("") }}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">Cancelar</button>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Prévia do cabeçalho</h3>
        <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border-default)]">
          <div className="flex whitespace-nowrap text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            {["Registro", ...COLUNAS_FIXAS].map((c) => (
              <span key={c} className="border-r border-[var(--border-default)] px-3 py-2">{c}</span>
            ))}
            {colunas.filter((c) => c.ativa).map((c) => (
              <span key={c.id} className="border-r border-[var(--border-default)] px-3 py-2 text-right text-[var(--text-secondary)]">{c.rotulo}</span>
            ))}
            <span className="px-3 py-2 font-medium text-[var(--text-primary)]">Total</span>
          </div>
        </div>
      </section>
    </div>
  )
}

export default ConfiguracaoPlanilhaDocumental
