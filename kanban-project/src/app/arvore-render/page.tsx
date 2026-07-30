// SUPERFÍCIE DE RENDER COM FIXTURES DETERMINÍSTICAS.
//
// Existe para que cada visualização e cada estado possa ser renderizado e
// fotografado sem depender de banco, autenticação ou processo. Os dados são
// fixos e ficam neste arquivo — mesma entrada, mesmo desenho, sempre.
//
// Parâmetros (querystring):
//   caso     base | sem-conjuge | sem-pais | muitos-filhos | multiplos-casamentos
//            | nome-longo | vazia | sem-parentes
//   vista    paisagem | retrato | leque | descendencia
//   gaveta   1 para abrir a gaveta da pessoa focal
//   pais     ITALIA | PORTUGAL | ESPANHA | ALEMANHA | (vazio)
//
// Fora de produção. A integração com processo e banco é assunto separado.

"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ArvoreInteligente } from "@/src/components/arvore/motor/arvore-inteligente"
import { PessoaDetailsPage } from "@/src/components/arvore/pessoa-details-page"
import type { PessoaArvore, UniaoArvore } from "@/src/components/arvore/types"
import { useMontadoNoCliente } from "@/src/hooks/use-dados-headerbar"

export default function Pagina() {
  if (process.env.NODE_ENV === "production") return null
  return <Render />
}

function p(id: number, nome: string, extra: Partial<PessoaArvore> = {}): PessoaArvore {
  return { id, nome, ...extra } as PessoaArvore
}

/** Quatro gerações completas + segundo casamento + irmãos + filhos. */
const PESSOAS: PessoaArvore[] = [
  p(1, "Marco Antônio", { sobrenome: "Bianchi", sexo: "M", data_nasc: "1960-03-12", local_nasc: "Caxias do Sul", estado_nasc: "RS", requerente: "sim", paiId: 10, maeId: 11, publicCode: "PES-1M4C" } as Partial<PessoaArvore>),
  p(2, "Helena", { sobrenome: "Souza", sexo: "F", data_nasc: "1962-07-04", local_nasc: "Porto Alegre", estado_nasc: "RS", publicCode: "PES-2HLN" } as Partial<PessoaArvore>),
  p(3, "Lucas", { sobrenome: "Bianchi", sexo: "M", data_nasc: "1990-01-20", paiId: 1, maeId: 2, local_nasc: "Caxias do Sul" }),
  p(4, "Júlia", { sobrenome: "Bianchi", sexo: "F", data_nasc: "1993-09-08", paiId: 1, maeId: 2, local_nasc: "Caxias do Sul" }),
  p(5, "Sofia", { sobrenome: "Bianchi", sexo: "F", data_nasc: "1963-05-02", paiId: 10, maeId: 11, local_nasc: "Bento Gonçalves" }),

  p(10, "Paulo", { sobrenome: "Bianchi", sexo: "M", data_nasc: "1930-11-02", local_nasc: "Bento Gonçalves", estado_nasc: "RS", paiId: 20, maeId: 21 }),
  p(11, "Teresa", { sobrenome: "Fontana", sexo: "F", data_nasc: "1934-02-17", local_nasc: "Garibaldi", estado_nasc: "RS" }),
  p(12, "Rosa", { sobrenome: "Marchi", sexo: "F", data_nasc: "1941-08-05", local_nasc: "Farroupilha", estado_nasc: "RS" }),
  p(13, "Ana", { sobrenome: "Bianchi", sexo: "F", data_nasc: "1968-12-01", paiId: 10, maeId: 12, local_nasc: "Farroupilha" }),

  p(20, "Giovanni", { sobrenome: "Bianchi", sexo: "M", data_nasc: "1898-06-30", data_obito: "1971-01-09", vivo: false, local_nasc: "Vittorio Veneto", pais_nasc: "Itália", paiId: 30, maeId: 31 }),
  p(21, "Maria", { sobrenome: "Rossi", sexo: "F", data_nasc: "1902-04-11", data_obito: "1979-08-22", vivo: false, local_nasc: "Conegliano", pais_nasc: "Itália" }),

  p(30, "Antonio", { sobrenome: "Bianchi", sexo: "M", data_nasc: "1868-01-15", data_obito: "1940-03-03", vivo: false, local_nasc: "Vittorio Veneto", pais_nasc: "Itália", paiId: 40, maeId: 41 }),
  p(31, "Lucia", { sobrenome: "Zanella", sexo: "F", data_nasc: "1872-09-19", vivo: false, local_nasc: "Vittorio Veneto", pais_nasc: "Itália" }),

  p(40, "Giuseppe", { sobrenome: "Bianchi", sexo: "M", data_nasc: "1840-05-02", vivo: false, local_nasc: "Vittorio Veneto", pais_nasc: "Itália" }),
  p(41, "Caterina", { sobrenome: "Moro", sexo: "F", data_nasc: "1844-03-21", vivo: false, local_nasc: "Serravalle", pais_nasc: "Itália" }),
]

const UNIOES: UniaoArvore[] = [
  { id: 1, pessoa1Id: 1, pessoa2Id: 2, data_inicio: "1988-05-21", local: "Caxias do Sul" },
  { id: 2, pessoa1Id: 10, pessoa2Id: 11, data_inicio: "1956-02-04", local: "Bento Gonçalves" },
  { id: 3, pessoa1Id: 10, pessoa2Id: 12, data_inicio: "1966-09-30", local: "Farroupilha" },
  { id: 4, pessoa1Id: 20, pessoa2Id: 21, data_inicio: "1925-10-12", local: "Vittorio Veneto", pais: "Itália" },
  { id: 5, pessoa1Id: 30, pessoa2Id: 31, data_inicio: "1895-07-07", local: "Vittorio Veneto", pais: "Itália" },
  { id: 6, pessoa1Id: 40, pessoa2Id: 41, data_inicio: "1866-01-20", local: "Vittorio Veneto", pais: "Itália" },
] as UniaoArvore[]

/**
 * Casos-limite.
 *
 * Cada um existe porque é um estado que o desenho tem de aguentar sem quebrar —
 * e que só aparece se for construído de propósito. Derivam da fixture base para
 * que a comparação entre eles isole a variável.
 */
function montarCaso(caso: string): { pessoas: PessoaArvore[]; unioes: UniaoArvore[]; raiz: number | null } {
  switch (caso) {
    case "vazia":
      return { pessoas: [], unioes: [], raiz: null }

    case "sem-parentes":
      return {
        pessoas: [p(1, "Marco Antônio", { sobrenome: "Bianchi", sexo: "M", data_nasc: "1960-03-12", requerente: "sim" })],
        unioes: [],
        raiz: 1,
      }

    case "sem-conjuge":
      // O requerente perde a esposa: o casal fica com um lado só e o desenho
      // precisa oferecer o lugar vago sem inventar pessoa.
      return {
        pessoas: PESSOAS.filter((x) => x.id !== 2).map((x) =>
          x.paiId === 1 || x.maeId === 2 ? ({ ...x, maeId: null } as PessoaArvore) : x,
        ),
        unioes: UNIOES.filter((u) => u.id !== 1),
        raiz: 1,
      }

    case "sem-pais":
      return {
        pessoas: PESSOAS.filter((x) => ![10, 11, 12, 13, 5].includes(x.id)).map((x) =>
          x.id === 1 ? ({ ...x, paiId: null, maeId: null } as PessoaArvore) : x,
        ),
        unioes: UNIOES.filter((u) => ![2, 3].includes(u.id)),
        raiz: 1,
      }

    case "muitos-filhos": {
      const extras: PessoaArvore[] = Array.from({ length: 9 }, (_, i) =>
        p(200 + i, `Filho ${i + 1}`, {
          sobrenome: "Bianchi",
          sexo: i % 2 === 0 ? "M" : "F",
          data_nasc: `${1985 + i}-04-10`,
          paiId: 1,
          maeId: 2,
        }),
      )
      return { pessoas: [...PESSOAS, ...extras], unioes: UNIOES, raiz: 1 }
    }

    case "multiplos-casamentos": {
      // Paulo já tem duas uniões na fixture base; aqui ganha a terceira, que é
      // onde a barra de união precisa desviar em vez de riscar o card do meio.
      const terceira = p(14, "Clara", { sobrenome: "Bertoldi", sexo: "F", data_nasc: "1945-03-03" })
      const filha = p(15, "Nina", { sobrenome: "Bianchi", sexo: "F", data_nasc: "1972-06-06", paiId: 10, maeId: 14 })
      return {
        pessoas: [...PESSOAS, terceira, filha],
        unioes: [...UNIOES, { id: 7, pessoa1Id: 10, pessoa2Id: 14, data_inicio: "1970-01-15", local: "Caxias do Sul" } as UniaoArvore],
        raiz: 1,
      }
    }

    case "nome-longo":
      return {
        pessoas: PESSOAS.map((x) =>
          x.id === 20
            ? ({
                ...x,
                nome: "Giovanni Battista Alessandro Maria",
                sobrenome: "Bianchi della Torre di Santa Croce",
              } as PessoaArvore)
            : x,
        ),
        unioes: UNIOES,
        raiz: 1,
      }

    default:
      return { pessoas: PESSOAS, unioes: UNIOES, raiz: 1 }
  }
}

function Render() {
  const params = useSearchParams()
  // A árvore só desenha depois da hidratação (a preferência de vista é gravada
  // antes do primeiro quadro, senão a foto do harness compara vistas diferentes).
  const montado = useMontadoNoCliente()
  // Seleção: escolha explícita do usuário; com a gaveta aberta e sem escolha,
  // vale a pessoa principal. Derivada no render — sem efeito.
  const [selecionadaEscolhida, setSelecionada] = useState<PessoaArvore | null>(null)
  const [pagina, setPagina] = useState<PessoaArvore | null>(null)

  const caso = params.get("caso") ?? "base"
  const vista = params.get("vista") ?? "paisagem"
  const gaveta = params.get("gaveta") === "1"
  const paisProcesso = params.get("pais") ?? "ITALIA"

  const dados = useMemo(() => montarCaso(caso), [caso])
  const principal = useMemo(
    () => dados.pessoas.find((x) => x.id === dados.raiz) ?? null,
    [dados],
  )
  const selecionada = selecionadaEscolhida ?? (gaveta ? principal : null)

  // A vista é preferência persistida; o harness precisa forçá-la ANTES de a
  // árvore montar, senão o primeiro quadro sai na vista da sessão anterior e a
  // foto compara coisas diferentes.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        "discovery.arvore.preferencias.v1",
        JSON.stringify({ vista, orientacao: vista === "retrato" ? "vertical" : "horizontal" }),
      )
    } catch {
      // sem localStorage a árvore usa o padrão; o harness segue funcionando
    }
  }, [vista])



  if (!montado) return null

  return (
    <div className="fixed inset-0 z-[9000] flex flex-col bg-white">
      <ArvoreInteligente
        pessoas={dados.pessoas}
        unioes={dados.unioes}
        pessoaPrincipal={principal}
        paisProcesso={paisProcesso || null}
        selecionadaId={selecionada?.id ?? null}
        pessoaSelecionada={selecionada}
        aoSelecionarPessoa={setSelecionada}
        aoFecharPainel={() => setSelecionada(null)}
        telaCheia={false}
        aoAlternarTelaCheia={() => {}}
        aoAdicionarPai={() => {}}
        aoAdicionarMae={() => {}}
        aoAdicionarConjuge={() => {}}
        aoAdicionarFilho={() => {}}
        aoAbrirPaginaPessoa={setPagina}
      />

      {pagina && (
        <PessoaDetailsPage
          pessoa={pagina}
          conjuge={conjugeDe(dados, pagina)}
          casamento={casamentoDe(dados, pagina)}
          filhos={dados.pessoas.filter((x) => x.paiId === pagina.id || x.maeId === pagina.id)}
          pais={[pagina.paiId, pagina.maeId]
            .map((id) => dados.pessoas.find((x) => x.id === id) ?? null)
            .filter(Boolean) as PessoaArvore[]}
          irmaos={dados.pessoas.filter(
            (x) =>
              x.id !== pagina.id &&
              ((pagina.paiId != null && x.paiId === pagina.paiId) ||
                (pagina.maeId != null && x.maeId === pagina.maeId)),
          )}
          onBack={() => setPagina(null)}
          onPersonClick={setPagina}
          onAddPai={() => {}}
          onAddMae={() => {}}
          onAddFilho={() => {}}
          onAddConjuge={() => {}}
          onEditar={() => {}}
          onAbrirPastaDocumental={() => {}}
          onVerArvore={() => setPagina(null)}
        />
      )}
    </div>
  )
}

function conjugeDe(
  dados: { pessoas: PessoaArvore[]; unioes: UniaoArvore[] },
  p: PessoaArvore,
): PessoaArvore | null {
  const u = dados.unioes.find((x) => x.pessoa1Id === p.id || x.pessoa2Id === p.id)
  if (!u) return null
  const outro = u.pessoa1Id === p.id ? u.pessoa2Id : u.pessoa1Id
  return dados.pessoas.find((x) => x.id === outro) ?? null
}

function casamentoDe(
  dados: { pessoas: PessoaArvore[]; unioes: UniaoArvore[] },
  p: PessoaArvore,
): UniaoArvore | null {
  return dados.unioes.find((x) => x.pessoa1Id === p.id || x.pessoa2Id === p.id) ?? null
}
