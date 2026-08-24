// scripts/_configuracao-retificacao.ts
//
// O CONTEÚDO OPERACIONAL DOS SEIS PASSOS DA RETIFICAÇÃO, num módulo só.
//
// Está separado do script que o aplica para que o TESTE possa montar a fase com
// exatamente o mesmo conteúdo que a produção recebe. Se fossem dois textos, o teste
// provaria a cópia dele, não o que está no ar.
//
// A procedência de cada peça está comentada em `configurar-retificacao.ts`.

export const CONFIGURACAO: Record<string, {
  dependeDe: string[]
  campos: Array<{
    key: string; label: string; tipo: string; obrigatorio?: boolean; ajuda?: string
    opcoes?: Array<{ key: string; label: string }>
    /** Alvo de referência, quando o campo aponta para um cadastro canônico. */
    referencia?: string
  }>
  acoes: Array<{ key: string; label: string; effectKey: string; descricao: string; requerCampos?: string[] }>
  checkItens?: Array<{ key: string; label: string; obrigatorio?: boolean }>
  requisitos?: Array<{ key: string; label: string; tipo: string; alvoKey?: string; acaoKey?: string }>
}> = {
  // 1 ─ O modo decide todo o resto do trâmite. É a primeira coisa que se sabe.
  definir_modo_de_retificacao: {
    dependeDe: [],
    campos: [
      {
        key: "modo", label: "Modo da retificação", tipo: "select", obrigatorio: true,
        ajuda: "Judicial exige petição e tramita no tribunal; administrativa é feita no próprio cartório.",
        // Vocabulário de `RetificacaoPacote.tipo` — não inventado aqui.
        opcoes: [{ key: "judicial", label: "Judicial" }, { key: "administrativa", label: "Administrativa" }],
      },
      { key: "fundamentacao", label: "Por que este modo", tipo: "textarea", ajuda: "O que na divergência leva a este caminho." },
    ],
    acoes: [{ key: "modo_definido", label: "Modo definido", effectKey: "COMPLETE_STEP", descricao: "Registra o caminho escolhido e libera a preparação.", requerCampos: ["modo"] }],
    requisitos: [{ key: "modo_escolhido", label: "Modo da retificação", tipo: "CAMPO_PREENCHIDO", alvoKey: "modo" }],
  },

  // 2 ─ O documento que vai ser protocolado. A evidência é o próprio requerimento.
  // A DEPENDÊNCIA 1→2 FOI REMOVIDA. Ela não passava no teste: redigir o pedido é
  // possível antes de o modo estar registrado — o `resumo_do_pedido` ("o que precisa
  // ser corrigido") é o mesmo nos dois caminhos. O que o modo decide é PARA QUEM a
  // peça vai, e isso é pré-condição de PROTOCOLAR, não de redigir. Gatear aqui era
  // ordem visual disfarçada de pré-condição.
  preparar_requerimento_peticao: {
    dependeDe: [],
    campos: [
      { key: "resumo_do_pedido", label: "O que está sendo pedido", tipo: "textarea", obrigatorio: true, ajuda: "O que precisa ser corrigido no registro, em uma frase." },
    ],
    acoes: [{ key: "requerimento_pronto", label: "Requerimento pronto", effectKey: "COMPLETE_STEP", descricao: "A peça está pronta para ser protocolada.", requerCampos: ["resumo_do_pedido"] }],
    requisitos: [
      { key: "pedido_descrito", label: "Descrição do pedido", tipo: "CAMPO_PREENCHIDO", alvoKey: "resumo_do_pedido" },
      { key: "peca_anexada", label: "Requerimento/petição anexado", tipo: "EVIDENCIA_ANEXADA" },
    ],
  },

  // 3 ─ O protocolo é o fato que separa "preparando" de "aguardando terceiro".
  // DUAS PRÉ-CONDIÇÕES REAIS, e as duas se justificam sozinhas: sem a peça não há o
  // que entregar, e sem o modo não se sabe se o destinatário é tribunal ou cartório.
  protocolar_retificacao: {
    dependeDe: ["definir_modo_de_retificacao", "preparar_requerimento_peticao"],
    campos: [
      // O ÓRGÃO APONTA PARA O CADASTRO. Era a lacuna que ficou aberta na primeira
      // rodada: sem campo referencial, a única saída seria um texto "cartório", e o
      // nome congelaria no dia em que a organização mudasse de nome.
      {
        key: "orgao_receptor", label: "Órgão que recebeu", tipo: "referencia", obrigatorio: true,
        referencia: "ORGANIZACAO",
        ajuda: "Escolhido em Órgãos e Organizações. Fica gravado o registro, não o nome.",
      },
      // A VARA É O SETOR. `Protocolo.setor` já existe e já se chama "setor/guichê
      // dentro do órgão" — vara, cartório de ofício e guichê são a mesma pergunta em
      // vocabulários diferentes. Um campo "vara" ao lado dele seria a segunda fonte.
      { key: "setor_do_orgao", label: "Vara / setor / ofício", tipo: "texto", ajuda: "Onde dentro do órgão o pedido deu entrada. Vai para o cadastro do protocolo." },
      { key: "numero_protocolo", label: "Número do protocolo", tipo: "texto", obrigatorio: true },
      { key: "data_protocolo", label: "Data do protocolo", tipo: "data", obrigatorio: true },
      { key: "observacao_protocolo", label: "Observação", tipo: "textarea" },
    ],
    // O PROTOCOLO VIRA LINHA NO CADASTRO DE PROTOCOLOS, que é o dono do fato. A etapa
    // fica com a referência; o número não é copiado para dentro da execução.
    acoes: [{ key: "protocolado", label: "Protocolado", effectKey: "REGISTER_PROTOCOL", descricao: "Registra o protocolo no cadastro e encerra a etapa: o pedido passa a depender de terceiro.", requerCampos: ["orgao_receptor", "numero_protocolo", "data_protocolo"] }],
    requisitos: [
      { key: "tem_protocolo", label: "Número do protocolo", tipo: "CAMPO_PREENCHIDO", alvoKey: "numero_protocolo" },
      { key: "tem_orgao", label: "Órgão que recebeu", tipo: "CAMPO_PREENCHIDO", alvoKey: "orgao_receptor" },
    ],
  },

  // 4 ─ A espera. "Em exigência" é estado do domínio, não invenção da tela.
  acompanhar_decisao: {
    dependeDe: ["protocolar_retificacao"],
    campos: [
      { key: "situacao", label: "O que se sabe até agora", tipo: "textarea" },
      { key: "prazo_informado", label: "Prazo informado pelo órgão", tipo: "data", ajuda: "É previsão do órgão — não substitui o prazo interno da fase." },
    ],
    acoes: [
      { key: "aguardando", label: "Aguardando decisão", effectKey: "PAUSE_FOR_EXTERNAL_WAIT", descricao: "A etapa fica esperando o órgão, sem cobrar o operador." },
      { key: "exigencia_recebida", label: "Exigência recebida", effectKey: "REGISTER_ONLY", descricao: "O órgão pediu algo a mais. Registra sem encerrar a espera." },
      { key: "retomar", label: "Retomar acompanhamento", effectKey: "RESUME", descricao: "Volta a acompanhar depois de responder à exigência." },
      { key: "decisao_recebida", label: "Decisão recebida", effectKey: "COMPLETE_STEP", descricao: "Saiu a decisão. Libera o registro da averbação." },
    ],
  },

  // 5 ─ A averbação é o efeito material da decisão sobre o registro.
  registrar_averbacao: {
    dependeDe: ["acompanhar_decisao"],
    campos: [
      { key: "data_averbacao", label: "Data da averbação", tipo: "data", obrigatorio: true },
      { key: "teor_da_averbacao", label: "O que foi averbado", tipo: "textarea", obrigatorio: true },
    ],
    acoes: [{ key: "averbacao_registrada", label: "Averbação registrada", effectKey: "COMPLETE_STEP", descricao: "O registro foi corrigido na origem.", requerCampos: ["data_averbacao", "teor_da_averbacao"] }],
    requisitos: [{ key: "averbacao_anexada", label: "Comprovante da averbação", tipo: "EVIDENCIA_ANEXADA" }],
  },

  // 6 ─ Conferir que o que voltou corrige o que motivou o pedido.
  validar_retificacao: {
    dependeDe: ["registrar_averbacao"],
    campos: [{ key: "parecer", label: "Parecer da validação", tipo: "textarea", obrigatorio: true }],
    checkItens: [
      { key: "corrige_a_divergencia", label: "A correção resolve a divergência que motivou o pedido" },
      { key: "dados_conferem", label: "Os dados do registro corrigido conferem com a árvore" },
      { key: "documento_legivel", label: "O documento corrigido está legível e completo" },
    ],
    acoes: [{ key: "retificacao_validada", label: "Retificação validada", effectKey: "COMPLETE_STEP", descricao: "A correção resolve o que motivou o pedido.", requerCampos: ["parecer"] }],
    requisitos: [{ key: "conferencia_completa", label: "Conferência completa", tipo: "CHECKLIST_COMPLETO", acaoKey: "retificacao_validada" }],
  },
}
