// src/lib/genealogia/operacional/comparacao.ts
//
// ANTES × DEPOIS — o estado projetado, derivado do delta. Nunca recalculado.
//
// O preview já responde "o que muda". Falta responder "como fica" — que é a
// pergunta que o operador realmente faz antes de confirmar. Este módulo monta as
// duas colunas.
//
// A REGRA QUE O MANTÉM CORRETO: o DEPOIS é sempre `antes + delta`, aritmética
// pura sobre números que outro motor já apurou. Ele não consulta regra, não
// reavalia condição e não adivinha. Se o delta estiver certo, o depois está
// certo; se o delta mudar, o depois muda junto. Recalcular o estado final por
// conta própria seria criar uma segunda opinião sobre o mesmo futuro — e as duas
// discordariam no primeiro caso de borda.
//
// PURO: sem rede, sem banco, sem relógio.

export type DirecaoMudanca = "melhora" | "piora" | "igual"

export interface LinhaComparacao {
  rotulo: string
  antes: string
  depois: string
  direcao: DirecaoMudanca
  /** Explica a linha em uma frase. Vira tooltip. */
  dica?: string
}

/** Números do estado atual que o preview consegue projetar adiante. */
export interface EstadoAtual {
  documentosExigidos: number
  documentosConcluidos: number
  pendencias: number
  bloqueios: number
  pessoasNaLinhagem: number
  ascendenteTransmissor: string | null
}

/** O que o delta do preview diz que muda. */
export interface DeltaComparavel {
  documentosAdicionados: number
  documentosDispensados: number
  bloqueiosAdicionados: number
  bloqueiosRemovidos: number
  passosAdicionados: number
  /** Requerentes cuja cadeia muda — vindo do motor de linhagem, não do preview. */
  linhagensAfetadas: readonly string[]
  transmissorAlterado: boolean
}

/**
 * Para quantidades, o que é "melhor" depende do que se conta: mais documento
 * concluído é bom; mais bloqueio é ruim. Por isso a direção é declarada por
 * linha, e não inferida do sinal do número.
 */
function direcao(delta: number, maiorEhMelhor: boolean): DirecaoMudanca {
  if (delta === 0) return "igual"
  return delta > 0 === maiorEhMelhor ? "melhora" : "piora"
}

export function compararEstados(antes: EstadoAtual, delta: DeltaComparavel): LinhaComparacao[] {
  const linhas: LinhaComparacao[] = []

  // Exigidos: dispensar reduz o denominador — o total de trabalho cai.
  const exigidosDepois =
    antes.documentosExigidos + delta.documentosAdicionados - delta.documentosDispensados
  linhas.push({
    rotulo: "Documentos exigidos",
    antes: String(antes.documentosExigidos),
    depois: String(exigidosDepois),
    // Mais exigência é mais trabalho; menos, menos. Nenhum dos dois é "erro".
    direcao: direcao(exigidosDepois - antes.documentosExigidos, false),
    dica: "Total de obrigações documentais desta linha, decidido pelas Regras Documentais.",
  })

  linhas.push({
    rotulo: "Documentos concluídos",
    antes: `${antes.documentosConcluidos} de ${antes.documentosExigidos}`,
    depois: `${antes.documentosConcluidos} de ${exigidosDepois}`,
    // O que já foi entregue não muda por uma alteração de cadastro.
    direcao: "igual",
    dica: "Atendidos ou dispensados. Uma alteração de cadastro não conclui documento.",
  })

  const pendenciasDepois =
    antes.pendencias + delta.documentosAdicionados - delta.documentosDispensados
  linhas.push({
    rotulo: "Pendências",
    antes: String(antes.pendencias),
    depois: String(Math.max(0, pendenciasDepois)),
    direcao: direcao(pendenciasDepois - antes.pendencias, false),
    dica: "Exigências ainda não resolvidas.",
  })

  const bloqueiosDepois = antes.bloqueios + delta.bloqueiosAdicionados - delta.bloqueiosRemovidos
  linhas.push({
    rotulo: "Bloqueios",
    antes: String(antes.bloqueios),
    depois: String(Math.max(0, bloqueiosDepois)),
    direcao: direcao(bloqueiosDepois - antes.bloqueios, false),
    dica: "Documentos marcados como não localizados — é o que impede concluir.",
  })

  if (delta.passosAdicionados > 0) {
    linhas.push({
      rotulo: "Tarefas previstas",
      antes: "—",
      depois: `+${delta.passosAdicionados}`,
      direcao: "piora",
      dica: "Passos de workflow que nascem; a tarefa é projeção deles.",
    })
  }

  if (delta.linhagensAfetadas.length > 0) {
    linhas.push({
      rotulo: "Linhagens afetadas",
      antes: "—",
      depois: delta.linhagensAfetadas.join(", "),
      direcao: "piora",
      dica: "Requerentes cuja cadeia de transmissão muda com esta alteração.",
    })
  }

  linhas.push({
    rotulo: "Ascendente transmissor",
    antes: antes.ascendenteTransmissor ?? "não identificado",
    // O preview sabe SE muda, não PARA QUEM: quem resolve o novo transmissor é o
    // motor de linhagem, na execução. Prometer um nome aqui seria adivinhar.
    depois: delta.transmissorAlterado
      ? "muda — o motor recalcula ao confirmar"
      : (antes.ascendenteTransmissor ?? "não identificado"),
    direcao: delta.transmissorAlterado ? "melhora" : "igual",
    dica: "O ascendente mais próximo com nacionalidade do país-alvo. É ele que fundamenta o pedido.",
  })

  linhas.push({
    rotulo: "Pessoas na linhagem",
    antes: String(antes.pessoasNaLinhagem),
    depois: delta.linhagensAfetadas.length > 0
      ? "muda — o motor recalcula ao confirmar"
      : String(antes.pessoasNaLinhagem),
    direcao: delta.linhagensAfetadas.length > 0 ? "melhora" : "igual",
    dica: "Cadeia do requerente mais os cônjuges dela.",
  })

  return linhas
}

/** true quando nada mudou em nenhuma linha — o preview então diz isso e pronto. */
export function semDiferenca(linhas: readonly LinhaComparacao[]): boolean {
  return linhas.every((l) => l.direcao === "igual")
}
