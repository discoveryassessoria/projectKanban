// src/components/kanban/workflow/useConfiguracaoDaEtapa.ts
//
// O EXECUTOR PERGUNTA AO SERVIDOR O QUE ELE PODE OFERECER.
//
// Os executores especializados continuam existindo — o resumo do pedido, a dropzone,
// a comparação lado a lado são interfaces ricas que valem o código que custam. O que
// eles deixaram de ter é a LISTA: quais canais existem, quais itens de conferência,
// quais resultados. Isso vem daqui, da versão congelada que a execução registrou.
//
// ENQUANTO A CONFIGURAÇÃO NÃO CHEGA, ou quando a etapa é anterior ao versionamento,
// `carregando`/`ausente` dizem isso — e o executor mostra o que sempre mostrou. Não é
// fallback de negócio: é a mesma tela, sem opções que o cadastro ainda não fornece.

import { useEffect, useState } from "react"

export interface CampoConfigurado {
  key: string
  label: string
  tipo: string
  obrigatorio: boolean
  opcoes: Array<{ value: string; label: string; meta?: Record<string, unknown> }>
  ajuda: string | null
  condicao: { campo?: string; op?: string; valor?: unknown } | null
}
export interface AcaoConfigurada {
  key: string
  label: string
  descricao: string | null
  effectKey: string
  requerCampos: string[]
  efeito: { label: string; descricao: string; competencia: string } | null
}
export interface ItemConferencia {
  key: string
  label: string
  descricao: string | null
  obrigatorio: boolean
}

/**
 * Canal que ESTE passo oferece — do cadastro do passo, não do catálogo inteiro.
 *
 * As exigências já chegam RESOLVIDAS: a versão congelada soma o que o catálogo pede
 * com o que o passo acrescentou. A tela não refaz essa conta, senão passariam a
 * existir duas respostas para "este canal exige protocolo?".
 */
export interface CanalDoPasso {
  key: string
  label: string
  descricao: string | null
  ordem: number
  ativo: boolean
  exigeProtocolo: boolean
  exigeAnexo: boolean
  anexoLabel: string | null
  exigeRastreio: boolean
  exigeObservacao: boolean
  camposObrigatorios: string[]
}
/** O que falta para concluir — calculado pelo servidor, com a mesma conta que recusa. */
export interface PendenciaDaEtapa { key: string; label: string; tipo: string; obrigatorio: boolean; motivo: string }

export interface ConfiguracaoDaEtapa {
  versao: number | null
  executor: string | null
  campos: CampoConfigurado[]
  acoes: AcaoConfigurada[]
  checklist: ItemConferencia[]
  canais: CanalDoPasso[]
  pendencias: PendenciaDaEtapa[]
  /** O que já foi preenchido nesta tentativa — o servidor devolve para a tela recarregar cheia. */
  valores: Record<string, unknown>
  /** Execução atual e anteriores — para o executor mostrar "o que houve antes". */
  execucaoAtual: { id: number; sequencia: number; resultado: string | null } | null
  execucoesAnteriores: Array<{ id: number; sequencia: number; resultado: string | null; completedAt: string | null; motivo: string }>
}

function headers(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("token") : null
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

export function useConfiguracaoDaEtapa(stepInstanceId: number | null) {
  const [cfg, setCfg] = useState<ConfiguracaoDaEtapa | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [recarga, setRecarga] = useState(0)

  useEffect(() => {
    // A carga sai do corpo do efeito: chamar direto faria o primeiro `setState`
    // acontecer na mesma passagem em que o efeito roda, encadeando render. O
    // caso "sem etapa" também passa por aqui, pelo mesmo motivo.
    let vivo = true
    void Promise.resolve().then(async () => {
      if (!vivo) return
      if (!stepInstanceId) { setCfg(null); setCarregando(false); return }
      setCarregando(true)
      setErro(null)
      try {
        const r = await fetch(`/api/workflow-step-instances/${stepInstanceId}/execucao`, { headers: headers() })
        if (!vivo) return
        if (!r.ok) { setErro("Não foi possível carregar a configuração da etapa."); setCfg(null); return }
        const j = await r.json()
        if (!vivo) return
        setCfg({
          versao: j.versao ?? null,
          executor: j.executor ?? null,
          campos: j.configuracao?.campos ?? [],
          acoes: j.configuracao?.acoes ?? [],
          checklist: j.configuracao?.checklist ?? [],
          canais: j.configuracao?.canais ?? [],
          pendencias: j.pendencias ?? [],
          valores: j.valores ?? {},
          execucaoAtual: j.execucaoAtual ? { id: j.execucaoAtual.id, sequencia: j.execucaoAtual.sequencia, resultado: j.execucaoAtual.resultado } : null,
          execucoesAnteriores: j.execucoesAnteriores ?? [],
        })
      } catch {
        if (vivo) { setErro("Erro de conexão ao carregar a etapa."); setCfg(null) }
      } finally {
        if (vivo) setCarregando(false)
      }
    })
    return () => { vivo = false }
  }, [stepInstanceId, recarga])

  /** Opções de um campo cadastrado. Vazio = o cadastro não declarou este campo. */
  const opcoesDe = (campoKey: string) => cfg?.campos.find((c) => c.key === campoKey)?.opcoes ?? []

  /**
   * OS CANAIS DESTE PASSO, no formato que os executores já desenham.
   *
   * A ordem da resposta é a do cadastro do passo (`StepChannel`). Só quando o passo
   * não cadastrou canal nenhum é que a lista fica vazia — e aí o executor cai no
   * campo `canal`, que resolve do catálogo, e por último na semente. Nenhum desses
   * caminhos inventa canal: os três dizem a mesma lista, em graus de especificidade
   * decrescentes.
   */
  const canaisDoPasso = () =>
    (cfg?.canais ?? []).filter((c) => c.ativo !== false).slice().sort((a, b) => a.ordem - b.ordem).map((c) => ({
      value: c.key,
      label: c.label,
      meta: {
        descricao: c.descricao,
        protocoloObrigatorio: c.exigeProtocolo,
        anexoObrigatorioLabel: c.exigeAnexo ? (c.anexoLabel ?? "Comprovante do envio") : null,
        rastreioObrigatorio: c.exigeRastreio,
        observacaoObrigatoria: c.exigeObservacao,
      } as Record<string, unknown>,
    }))

  /**
   * EXECUTA UMA AÇÃO CADASTRADA pela porta única de domínio.
   *
   * O executor não decide o que acontece: ele diz QUAL resultado o operador escolheu e
   * o que foi preenchido. Status de documento, próxima fase e conclusão da etapa são
   * do motor — e a recusa dele (competência, permissão, campo faltando) volta como
   * texto para o operador ler.
   */
  const executarAcao = async (
    acaoKey: string,
    valores: Record<string, unknown>,
  ): Promise<{ ok: boolean; mensagem?: string; concluiuPasso?: boolean }> => {
    if (!stepInstanceId) return { ok: false, mensagem: "Etapa não identificada." }
    try {
      const r = await fetch(`/api/workflow-step-instances/${stepInstanceId}/execucao`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          acao: acaoKey,
          valores,
          correlationId: `acao|si${stepInstanceId}|${acaoKey}|${cfg?.execucaoAtual?.id ?? 0}`,
        }),
      })
      const j = await r.json()
      if (!j.ok) return { ok: false, mensagem: j.mensagem ?? j.error ?? "A ação não pôde ser executada." }
      setRecarga((n) => n + 1)
      return { ok: true, concluiuPasso: !!j.concluiuPasso }
    } catch {
      return { ok: false, mensagem: "Erro de conexão. Nada foi executado." }
    }
  }

  return {
    cfg,
    carregando,
    erro,
    /** `true` quando a etapa não tem configuração cadastrada nesta versão. */
    ausente: !carregando && !erro && cfg != null && cfg.acoes.length === 0 && cfg.campos.length === 0,
    opcoesDe,
    canaisDoPasso,
    /** O que o servidor diz que falta. A tela mostra; quem recusa é a porta. */
    pendencias: cfg?.pendencias ?? [],
    executarAcao,
    recarregar: () => setRecarga((n) => n + 1),
  }
}
