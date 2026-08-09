// src/components/financeiro/v3/PlanilhaDocumentalView.tsx
// ============================================================================
// PLANILHA DOCUMENTAL — reprodução visual da pasta documental de referência.
//
// ─── ISTO NÃO É UM COMPONENTE DE DASHBOARD ──────────────────────────────────
// A referência é a planilha que a Discovery já usa. Ela é branca, densa,
// retangular e cheia de bordas — de propósito: quem confere um dossiê precisa
// ver a família inteira de uma vez. Card, sombra, badge, canto arredondado e
// respiro de dashboard destroem exatamente isso.
//
// A casca do Discovery em volta continua escura. A ÁREA DA PLANILHA reproduz o
// documento.
//
// ─── MEDIDO NO ARQUIVO, NÃO ESTIMADO ────────────────────────────────────────
// Paleta e proporções foram extraídas do PDF renderizado a 200 dpi:
//
//   #44546A  faixas e cabeçalhos (título, cabeçalho de coluna, seção de apoio)
//   #DDEBF7  1ª linha do bloco — e a faixa de papéis da linhagem
//   #E2EFDA  2ª linha do bloco
//   #D0CECE  3ª linha do bloco
//   #000000  bordas e texto
//
// A faixa colorida pega SÓ as duas primeiras células da linha (Geração e
// Registro); o resto é branco.
//
// A largura de cada coluna é a proporção medida entre as divisórias verticais
// do arquivo (tabela de 1938 px). Nada de `flex: 1`.
//
// UMA CORREÇÃO AO ENUNCIADO: a instrução dizia nascimento esverdeado e casamento
// amarelado. No arquivo é o contrário — a linha de nascimento é AZUL claro
// (#DDEBF7) e a de casamento é VERDE claro (#E2EFDA). O arquivo é o golden
// master; vale ele.
//
// ─── O QUE É ESTRUTURA E O QUE É DADO ───────────────────────────────────────
// Só a ESTRUTURA veio do arquivo. Nome, geração, data, local, tipo do registro,
// cônjuge, genitores e valores vêm da projeção canônica — inclusive QUAIS são
// as linhas, que são os tipos com `participaPlanilha` no Cadastro Mestre.
// ============================================================================
"use client"

import { useState } from "react"
import { useApi } from "@/src/lib/dados"

// ── Paleta do arquivo ───────────────────────────────────────────────────────
const AZUL = "#44546A"
const BORDA = "#000000"
// As três faixas do arquivo, na ordem em que ele as usa. A cor é BANDA de
// leitura — ela separa as linhas de uma mesma pessoa —, não um significado
// declarado em lugar nenhum. Por isso segue a ordem dos tipos no Cadastro
// Mestre, e não um "nascimento é azul" escrito no código: um quarto tipo
// declarado amanhã entra no ciclo sem tocar aqui.
const FAIXAS = ["#DDEBF7", "#E2EFDA", "#D0CECE"]

/** Proporção das colunas fixas, medida entre as divisórias do arquivo. */
const LARGURA_FIXA = [4.95, 5.78, 6.4, 9.29, 10.99, 14.6, 13.36]
const LARGURA_TOTAL = 7.95
const LARGURA_ECONOMICA = 6.66

// As duas faixas de seção não atravessam a tabela inteira no arquivo — param
// onde pararam, e reproduzir isso é metade do que faz a página "parecer ela".
const LARGURA_FAIXA_TITULO = 65
const LARGURA_FAIXA_APOIO = 48

// A tabela precisa de largura para não quebrar linha onde o arquivo não quebra.
// Ela não é fixa: cada coluna econômica configurada acrescenta a sua fatia, e é
// o container que rola — encolher a fonte ou deixar o texto empilhar destruiria
// a densidade que a referência tem.
// 16px por ponto percentual: é a razão em que o texto do arquivo cabe em uma
// linha só. Abaixo disso "Livro A 101 / Folhas 41 / Termo 1001" quebra em duas
// e a linha dobra de altura — a planilha perde exatamente a densidade que faz
// a família caber num olhar.
const PX_POR_PONTO = 16
const larguraMinima = (economicas: number) =>
  Math.round((LARGURA_FIXA.reduce((a, b) => a + b, 0) + economicas * LARGURA_ECONOMICA + LARGURA_TOTAL) * PX_POR_PONTO)

// O nome da pessoa começa recuado, alinhado à coluna "Data" — ou seja, depois
// das duas primeiras colunas. Não é margem estética: é onde o arquivo o põe.
const RECUO_NOME = LARGURA_FIXA[0] + LARGURA_FIXA[1]

// NO ARQUIVO A COR PEGA SÓ AS DUAS PRIMEIRAS CÉLULAS — Geração e Registro. O
// resto da linha é branco. Pintar a linha inteira parece a mesma coisa em
// miniatura, e é a diferença mais visível ao sobrepor as duas páginas: a mancha
// de cor da referência é uma coluna estreita à esquerda, não uma tarja de ponta
// a ponta.

/** Rótulos exatamente como no arquivo — sem "corrigir" nada. */
const CABECALHOS_FIXOS = ["Geração", "Registro", "Data", "Local", "Dados do registro", "Cônjuge", "Genitores"]

type EstadoCelula = "NAO_APLICAVEL" | "SEM_PRECO" | "PREVISTO" | "REALIZADO" | "SOBRESCRITO" | "AMBIGUO"

interface Celula {
  colunaId: number
  tipoServicoId: number
  estado: EstadoCelula
  valorBrl: number | null
  valorBase: number | null
  valorOverride: number | null
  valorEfetivo: number | null
  editavel: boolean
  explicacao?: {
    servico: string
    registro: string | null
    origem: string | null
    regra: string | null
    motivo: string | null
    itemResolvidoNome: string | null
    valorBase: number | null
  }
}
interface Linha {
  tipoDocumentoId: number | null
  tipoRegistro: string | null
  dataRegistro: string | null
  local: string | null
  cartorio: string | null
  livro: string | null
  folha: string | null
  termo: string | null
  conjuge: string | null
  paiNome: string | null
  maeNome: string | null
  celulas: Celula[]
  totalBrl: number
}
interface Bloco {
  pessoaId: number | null
  nome: string
  geracao: number | null
  linhagemPrincipal: boolean
  posicao: string | null
  linhas: Linha[]
  totalBrl: number
}
interface Planilha {
  nomeProcesso?: string | null
  colunas: { colunaId: number; tipoServicoId: number; nome: string }[]
  pessoas: Bloco[]
  totalGeralBrl: number
}

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
/**
 * Data de registro em UTC — NUNCA no fuso do navegador.
 *
 * A data de uma certidão é um fato de calendário, não um instante: 14/07/1868 é
 * 14/07/1868 em qualquer lugar. Formatar no fuso local faz `1868-07-14T00:00:00Z`
 * virar 13/07 para quem está a oeste de Greenwich — e a planilha passa a
 * discordar da certidão que está na mão do operador.
 */
const dataBR = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "-"

/** "Livro A 053 / Folhas 043 / Termo 282" — texto simples, como no arquivo. */
function dadosDoRegistro(l: Linha): string {
  if (!l.livro && !l.folha && !l.termo) return "-"
  return `Livro ${l.livro || "-"} / Folhas ${l.folha || "-"} / Termo ${l.termo || "-"}`
}

/**
 * A célula econômica: valor ou traço. Sem badge, sem ícone, sem botão.
 *
 * Cada estado diz uma coisa que R$ 0,00 não sabe dizer, e por isso nenhum deles
 * cai em zero: "não se aplica", "não tem preço cadastrado" e "o cadastro está
 * ambíguo" são situações diferentes, e a planilha existe para o operador
 * distinguir as três num olhar.
 */
function textoDaCelula(c?: Celula): string {
  if (!c || c.estado === "NAO_APLICAVEL") return "-"
  if (c.estado === "SEM_PRECO") return "Sem valor"
  if (c.estado === "AMBIGUO") return "Ambíguo"
  return fmt(c.valorEfetivo ?? c.valorBrl ?? 0)
}

/**
 * POR QUE ESTA CÉLULA VALE ISTO — a resposta do Modo Auditor, no `title`.
 *
 * O tooltip não desenha nada: no papel e na captura ele é invisível, então não
 * disputa fidelidade com a referência. Mas uma célula que diz "Sem valor" sem
 * dizer POR QUE obriga quem confere a sair da planilha para descobrir.
 */
function tituloDaCelula(c?: Celula): string | undefined {
  const e = c?.explicacao
  if (!e) return undefined
  const linhas = [
    e.registro && e.servico ? `${e.registro} × ${e.servico}` : e.servico,
    e.itemResolvidoNome ? `Item: ${e.itemResolvidoNome}` : null,
    // Sob override, o preço da Tabela continua dito — ele não some, só deixa de
    // valer AQUI. É essa distinção que impede o combinado de virar "o preço".
    c?.estado === "SOBRESCRITO" && e.valorBase != null ? `Valor padrão: ${fmt(e.valorBase)}` : null,
    c?.estado === "SOBRESCRITO" && c.valorOverride != null ? `Valor deste processo: ${fmt(c.valorOverride)}` : null,
    e.motivo,
    e.origem ? `Origem: ${e.origem}` : null,
    e.regra,
  ].filter(Boolean)
  return linhas.length > 0 ? linhas.join("\n") : undefined
}

/** Aceita "1.234,56", "1234.56" e "1234" — o operador digita como fala. */
function lerValor(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.-]/g, "").trim()
  if (!limpo) return null
  // Se tem vírgula, ela é o decimal e o ponto é milhar (pt-BR).
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo
  const n = Number(normal)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * A CÉLULA EDITÁVEL.
 *
 * Fora de edição ela é exatamente uma célula de planilha — sem botão, sem
 * coluna "Ações", sem ícone permanente. O único sinal de que existe um
 * combinado é um triângulo de 4px no canto, a mesma convenção que o Excel usa
 * para "esta célula tem uma nota": some no papel e não disputa atenção.
 *
 * `Enter` grava, `Escape` cancela, e o blur **cancela** em vez de gravar —
 * clicar fora é o gesto de quem desistiu, e gravar aí produziria alteração
 * financeira que o operador não pediu.
 */
function CelulaEconomica({
  celula, processoId, pessoaId, tipoDocumentoId, aoMudar,
}: {
  celula?: Celula
  processoId: number
  pessoaId: number | null
  tipoDocumentoId: number | null
  aoMudar: () => void
}) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const podeEditar = !!celula?.editavel && pessoaId != null && tipoDocumentoId != null
  const texto0 = textoDaCelula(celula)
  const titulo = tituloDaCelula(celula)

  const gravar = async (remover: boolean) => {
    if (!celula || pessoaId == null || tipoDocumentoId == null) return
    const valor = remover ? null : lerValor(texto)
    if (!remover && valor == null) { setErro("valor inválido"); return }
    setSalvando(true); setErro(null)
    try {
      const r = await fetch(`/api/processos/${processoId}/planilha-override`, {
        method: remover ? "DELETE" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pessoaId, tipoDocumentoId, colunaId: celula.colunaId, valor }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? "falha ao salvar")
      setEditando(false)
      aoMudar()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  if (editando) {
    return (
      <td className="relative border px-0 py-0" style={{ borderColor: BORDA, background: "#FFF9E6" }}>
        <input
          autoFocus
          value={texto}
          disabled={salvando}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void gravar(false) }
            if (e.key === "Escape") { e.preventDefault(); setEditando(false); setErro(null) }
          }}
          // Blur CANCELA. Clicar fora é desistir; gravar aqui alteraria dinheiro
          // sem o operador ter confirmado nada.
          onBlur={() => { setEditando(false); setErro(null) }}
          className="w-full bg-transparent px-1 py-[1px] text-right text-[9px] tabular-nums outline-none"
          title={erro ?? "Enter grava · Esc cancela"}
        />
        {celula?.valorOverride != null && (
          <button
            // `onMouseDown` porque o `onBlur` do input dispara antes do click.
            onMouseDown={(e) => { e.preventDefault(); void gravar(true) }}
            className="absolute right-0 top-full z-10 whitespace-nowrap border bg-white px-1 text-[8px]"
            style={{ borderColor: BORDA }}
          >
            Restaurar padrão
          </button>
        )}
      </td>
    )
  }

  return (
    <td
      className={`relative border px-1 py-[1px] tabular-nums ${texto0 === "-" ? "text-center" : "text-left"} ${podeEditar ? "cursor-cell" : ""}`}
      style={{ borderColor: BORDA }}
      title={titulo}
      onClick={() => {
        if (!podeEditar) return
        setTexto(celula?.valorEfetivo != null ? String(celula.valorEfetivo).replace(".", ",") : "")
        setEditando(true)
      }}
    >
      {texto0}
      {celula?.estado === "SOBRESCRITO" && (
        // O marcador do Excel para "esta célula tem algo": 4px no canto. No
        // papel ele desaparece; na tela ele responde "por que este número é
        // diferente do da tabela?" sem ocupar espaço nenhum.
        <span
          aria-label="valor combinado neste processo"
          className="pointer-events-none absolute right-0 top-0"
          style={{ width: 0, height: 0, borderTop: `4px solid ${AZUL}`, borderLeft: "4px solid transparent" }}
        />
      )}
    </td>
  )
}

export function PlanilhaDocumentalView({ processoId }: { processoId: number }) {
  const req = useApi<{ planilha?: Planilha }>(`/api/processos/${processoId}/custos`)
  const p = req.dados?.planilha ?? null

  // Quatro estados: carregando / erro / vazio / conteúdo. Nenhum deles é silêncio.
  if (req.carregando && !p) {
    return <div className="py-10 text-center text-sm text-[var(--text-muted)]">carregando a planilha…</div>
  }
  if (req.erro) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-8 text-center">
        <p className="text-sm text-[var(--text-secondary)]">Não foi possível carregar a planilha documental.</p>
        <button
          onClick={() => void req.recarregar()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
        >
          Tentar novamente
        </button>
      </div>
    )
  }
  if (!p) return null

  // Depois de gravar um combinado a planilha inteira é relida: o total da
  // linha, o da pessoa e o do processo mudam junto, e recalcular no cliente
  // seria a segunda régua de soma.
  const recarregar = () => { void req.recarregar() }
  const economicas = p.colunas
  const principais = p.pessoas.filter((b) => b.linhagemPrincipal)
  const apoio = p.pessoas.filter((b) => !b.linhagemPrincipal)

  if (p.pessoas.length === 0) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-10 text-center">
        <p className="text-sm text-[var(--text-secondary)]">Nenhuma pessoa na árvore deste processo.</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">As linhas nascem das pessoas da árvore; os valores, das Regras Documentais e da Tabela de Preços.</p>
      </div>
    )
  }

  return (
    <div className="mt-3 overflow-x-auto bg-white p-4 text-black print:overflow-visible print:p-0" style={{ colorScheme: "light" }}>
      {/* O branco fica AQUI, na largura do conteúdo — não só no container que
          rola. Pintar só o container deixa a parte da tabela que passa da
          janela sobre o fundo escuro do Discovery, e a folha aparece cortada ao
          rolar e ao imprimir. */}
      <div className="bg-white" style={{ minWidth: larguraMinima(economicas.length) }}>
        {/* Faixa de título — 65% da largura da tabela no arquivo, não 100%. */}
        <div
          className="mb-3 py-[3px] text-center text-[11px] font-semibold tracking-wide text-white"
          style={{ background: AZUL, width: `${LARGURA_FAIXA_TITULO}%` }}
        >
          {p.nomeProcesso ? `Pasta documental Família ${p.nomeProcesso}` : "Pasta documental"}
        </div>

        {/* A faixa de papéis da referência (BISAVÔ · PAI · FILHO / REQUERENTE).
            O rótulo vem do MOTOR DE PARENTESCO, nunca do número da geração:
            geração 1 é o topo exibido, não uma posição familiar. Quem não tem
            parentesco calculado fica de fora — melhor faltar da faixa do que
            aparecer com um papel inventado.
            No arquivo esta faixa é AZUL CLARO com texto preto; o azul escuro
            fica só no título e nos cabeçalhos de coluna. */}
        {principais.some((b) => b.posicao) && (
          <table className="mb-5 border-collapse text-[9px]">
            <tbody>
              <tr>
                {principais.filter((b) => b.posicao).map((b) => (
                  <td
                    key={`c-${b.pessoaId}`}
                    className="border px-3 py-[1px] text-center text-[8px] font-bold uppercase"
                    style={{ background: FAIXAS[0], borderColor: BORDA }}
                  >
                    {b.posicao}
                  </td>
                ))}
              </tr>
              <tr>
                {principais.filter((b) => b.posicao).map((b) => (
                  <td key={`n-${b.pessoaId}`} className="border px-3 py-[1px] text-center" style={{ borderColor: BORDA }}>
                    {b.nome.split(" ")[0].toUpperCase()}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        )}

        {principais.map((b) => (
          <BlocoPessoa key={b.pessoaId} bloco={b} economicas={economicas} rotuloPrimeira="Geração" processoId={processoId} aoMudar={recarregar} />
        ))}

        {apoio.length > 0 && (
          <>
            <div
              className="my-4 py-[4px] text-center text-[10px] font-semibold tracking-wide text-white"
              style={{ background: AZUL, width: `${LARGURA_FAIXA_APOIO}%` }}
            >
              FORA DA LINHAGEM · CÔNJUGES / APOIO
            </div>
            {/* Nesta seção o arquivo troca o rótulo da primeira coluna: quem está
                fora da linhagem não tem "geração", tem número de ordem. */}
            {apoio.map((b) => (
              <BlocoPessoa key={b.pessoaId} bloco={b} economicas={economicas} rotuloPrimeira="Numero" processoId={processoId} aoMudar={recarregar} />
            ))}
          </>
        )}

        {/* Total geral: linha curta encostada à direita, como no arquivo. */}
        <table className="mt-3 w-full border-collapse text-[9px]" style={{ tableLayout: "fixed" }}>
          <tbody>
            <tr>
              <td style={{ width: `${100 - LARGURA_TOTAL - LARGURA_ECONOMICA}%` }} />
              <td className="border px-1 py-[1px] text-left" style={{ borderColor: BORDA, width: `${LARGURA_ECONOMICA}%` }}>
                Total
              </td>
              <td className="border px-1 py-[1px] text-right tabular-nums" style={{ borderColor: BORDA, width: `${LARGURA_TOTAL}%` }}>
                {fmt(p.totalGeralBrl)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * UM BLOCO = UMA PESSOA: nome em linha própria e, abaixo, a sua tabela com o
 * cabeçalho REPETIDO. O arquivo repete o cabeçalho em cada pessoa; um cabeçalho
 * global só serviria a uma lista contínua, que não é a leitura desta planilha.
 */
function BlocoPessoa({
  bloco,
  economicas,
  rotuloPrimeira,
  processoId,
  aoMudar,
}: {
  bloco: Bloco
  economicas: { colunaId: number; tipoServicoId: number; nome: string }[]
  rotuloPrimeira: string
  processoId: number
  aoMudar: () => void
}) {
  return (
    <div className="mb-4" style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
      <div className="pb-[2px] text-[10px] font-bold uppercase" style={{ paddingLeft: `${RECUO_NOME}%` }}>
        {bloco.nome}
      </div>
      <table className="w-full border-collapse text-[9px]" style={{ tableLayout: "fixed" }}>
        <colgroup>
          {LARGURA_FIXA.map((w, i) => (
            <col key={i} style={{ width: `${w}%` }} />
          ))}
          {economicas.map((c) => (
            <col key={c.tipoServicoId} style={{ width: `${LARGURA_ECONOMICA}%` }} />
          ))}
          <col style={{ width: `${LARGURA_TOTAL}%` }} />
        </colgroup>
        <thead>
          <tr style={{ background: AZUL }}>
            {[rotuloPrimeira, ...CABECALHOS_FIXOS.slice(1)].map((h) => (
              <th key={h} className="border px-1 py-[1px] text-center text-[8px] font-semibold text-white" style={{ borderColor: BORDA }}>
                {h}
              </th>
            ))}
            {economicas.map((c) => (
              <th key={c.colunaId} className="border px-1 py-[1px] text-center text-[8px] font-semibold text-white" style={{ borderColor: BORDA }}>
                {c.nome}
              </th>
            ))}
            <th className="border px-1 py-[1px] text-center text-[8px] font-semibold text-white" style={{ borderColor: BORDA }}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {bloco.linhas.map((l, i) => {
            const faixa = FAIXAS[i % FAIXAS.length]
            return (
            <tr key={l.tipoDocumentoId ?? i}>
              <td className="border px-1 py-[1px] text-center" style={{ borderColor: BORDA, background: faixa }}>{bloco.geracao ?? "-"}</td>
              <td className="border px-1 py-[1px] text-center" style={{ borderColor: BORDA, background: faixa }}>{l.tipoRegistro ?? "-"}</td>
              <td className="border px-1 py-[1px] text-center" style={{ borderColor: BORDA }}>{dataBR(l.dataRegistro)}</td>
              <td className="border px-1 py-[1px] text-center" style={{ borderColor: BORDA }}>{l.local ?? l.cartorio ?? "-"}</td>
              <td className="border px-1 py-[1px] text-center" style={{ borderColor: BORDA }}>{dadosDoRegistro(l)}</td>
              <td className="border px-1 py-[1px] text-center" style={{ borderColor: BORDA }}>{l.conjuge ?? "-"}</td>
              <td className="border px-1 py-[1px] text-center leading-tight" style={{ borderColor: BORDA }}>
                {l.paiNome || l.maeNome ? (
                  <>
                    <div>PAI: {l.paiNome ?? "-"}</div>
                    <div>MÃE: {l.maeNome ?? "-"}</div>
                  </>
                ) : (
                  "-"
                )}
              </td>
              {economicas.map((c) => (
                <CelulaEconomica
                  key={c.colunaId}
                  celula={l.celulas.find((x) => x.colunaId === c.colunaId)}
                  processoId={processoId}
                  pessoaId={bloco.pessoaId}
                  tipoDocumentoId={l.tipoDocumentoId}
                  aoMudar={aoMudar}
                />
              ))}
              <td className="border px-1 py-[1px] text-right tabular-nums" style={{ borderColor: BORDA }}>
                {fmt(l.totalBrl)}
              </td>
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default PlanilhaDocumentalView
