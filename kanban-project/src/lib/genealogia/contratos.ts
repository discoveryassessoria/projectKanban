// src/lib/genealogia/contratos.ts
//
// CONTRATOS DE DOMÍNIO DA ÁRVORE — a superfície exata que ela conhece.
//
// Este arquivo existe para responder uma pergunta com precisão: **o que a Árvore
// tem direito de saber sobre o resto do sistema?** A resposta é: só o que está
// aqui. Nada de model do Prisma, nada de coluna, nada de enum de persistência.
//
// POR QUE ISSO IMPORTA, e não é burocracia:
//
// Enquanto a árvore lia o model direto, cada coluna nova do domínio alheio virava
// uma porta aberta. Foi assim que ela um dia leu `Pessoa.documentos` (o Documento
// cru) e passou a pintar semáforo documental por conta própria — regra do Sistema
// Documental morando dentro da árvore, duas fontes para a mesma verdade. Um
// contrato estreito torna essa porta inexistente: para a árvore saber algo novo,
// alguém precisa acrescentá-lo aqui, de propósito, e explicar por quê.
//
// REGRA DE OURO: todo campo abaixo é ou (a) genealógico — e aí a árvore é dona —
// ou (b) um NÚMERO/ESTADO já decidido pelo módulo dono. Nunca um insumo a partir
// do qual a árvore possa recalcular a decisão dele.
//
// Ver `docs/adr/ADR-12-arvore-camada-de-projecao.md`.

import type { PessoaEntrada, UniaoEntrada } from "./motor/tipos"

// ── 1. PESSOA ───────────────────────────────────────────────────────────────

/**
 * A pessoa como a árvore precisa conhecê-la: identidade, datas, lugares e
 * FILIAÇÃO. É o único contrato em que a árvore é DONA do dado — relação
 * genealógica é o domínio dela.
 *
 * Repare no que NÃO está aqui: documentos, tarefas, valores. Nada disso é
 * atributo de pessoa para a árvore; tudo vem projetado, abaixo.
 */
export type GenealogyPersonProjection = PessoaEntrada

/** A união (casamento) como fato genealógico. Também domínio da árvore. */
export type GenealogyUnionProjection = UniaoEntrada

// ── 2. LINHAGEM ─────────────────────────────────────────────────────────────

/**
 * A cadeia de transmissão de um requerente, já calculada.
 *
 * Derivada 100% de pessoa + filiação — isto é, do domínio da própria árvore.
 * Por isso é o único contrato que a árvore PRODUZ em vez de consumir.
 */
export interface GenealogyLineageProjection {
  requerenteId: number
  nome: string
  /** Requerente → ascendente transmissor, inclusive. */
  cadeia: readonly number[]
  danteCausaId: number | null
  /** Cadeia ∪ cônjuges da cadeia — o que a vista de linhagem mostra em pleno. */
  visivel: ReadonlySet<number>
  geracoes: number
}

// ── 3. OPERACIONAL ──────────────────────────────────────────────────────────

/**
 * O que os módulos operacionais já decidiram, por sujeito.
 *
 * Cada campo é uma DECISÃO PRONTA do módulo dono, nunca um insumo:
 *   • `status` da necessidade é do Sistema Documental — a árvore conta, não decide;
 *   • `concluida`/`dataPrazo` da tarefa são do módulo de Tarefas;
 *   • não há `condicao`, `regra`, `publicoAlvo` nem `varianteKey` em lugar nenhum:
 *     com esses campos a árvore conseguiria REAVALIAR a regra, e é exatamente
 *     isso que o contrato precisa tornar impossível.
 */
export interface GenealogyOperationalProjection {
  necessidades: readonly {
    id: number
    pessoaId: number | null
    uniaoId: number | null
    /** Estado já decidido pelo Sistema Documental. */
    status: string
    obrigatoriedade: string
    /** Nome do item no Cadastro Mestre — para exibir, não para casar regra. */
    itemCatalogo?: { id: number; code?: string | null; name?: string | null } | null
  }[]
  tarefas: readonly {
    id: number
    titulo: string
    concluida: boolean
    statusTarefa?: string | null
    dataPrazo?: string | null
    responsavel?: string | null
    /** Necessidade que originou a tarefa — é por ela que a tarefa tem dono. */
    necessidadeId?: number | null
    pessoaId: number | null
  }[]
  /**
   * Prazo do processo pela engine ÚNICA de SLA. `null` quando não há SLA
   * configurado — e nesse caso a árvore diz isso, em vez de estimar.
   */
  prazo: {
    rotuloDias: string
    rotuloStatus: string
    status: string
    diasParaVencimento: number | null
    prazoPrevisto: string | null
    configurado: boolean
  } | null
}

// ── 4. FINANCEIRO ───────────────────────────────────────────────────────────

/**
 * Lançamentos econômicos por pessoa, já resolvidos pelo Financeiro.
 *
 * `valor` e `recebido` chegam PRONTOS: a árvore não conhece Tabela de Preços,
 * não conhece taxa de câmbio e não soma moedas diferentes. `visivel: false`
 * significa que o servidor OMITIU os valores por falta de `financeiro.ver` — a
 * tela diz isso, em vez de exibir zero e mentir.
 */
export interface GenealogyFinancialProjection {
  visivel: boolean
  lancamentos: readonly {
    id: number
    /** RECEITA | CUSTO, como a ObrigacaoEconomica classifica. */
    natureza: string
    descricao: string
    moeda: string
    valor: number
    /** Do Ledger. `null` quando não há projeção de saldo. */
    recebido?: number | null
    saldo?: number | null
    status?: string | null
    pessoaId: number | null
  }[]
}

// ── 5. IMPACTO ──────────────────────────────────────────────────────────────

/**
 * O delta que o preview devolve.
 *
 * Contrato de LEITURA de uma simulação: descreve o que ACONTECERIA, e por isso
 * não carrega nenhum identificador de execução (sem chave de idempotência, sem
 * id de evento). Quem executa é o motor canônico, depois da confirmação.
 */
export interface PersonChangeImpactProjection {
  processoId: number
  pessoaId: number
  documental: {
    adicionados: readonly { necessidadeId: number; pessoaNome: string | null; documento: string; obrigatoriedade: string }[]
    dispensados: readonly { necessidadeId: number; pessoaNome: string | null; documento: string }[]
    reativados: readonly { necessidadeId: number; pessoaNome: string | null; documento: string }[]
    inalterados: number
  }
  operacional: {
    passosAdicionados: number
    tarefasPrevistas: number
    bloqueiosAdicionados: number
    bloqueiosRemovidos: number
  }
  financeiro: {
    visivel: boolean
    recalculoPrevisto: boolean
    /** Explicação. NUNCA um valor — o valor é resolvido na execução. */
    observacao: string
  }
  /** O que o motor não conseguiu avaliar. Silêncio aqui seria falsa cobertura. */
  pendencias: readonly string[]
  semImpacto: boolean
  /** Sempre true: a simulação termina em rollback, por construção. */
  somenteLeitura: true
}

// ── OWNERS CANÔNICOS ────────────────────────────────────────────────────────

/**
 * Quem é dono da ESCRITA de cada entidade que a árvore apenas lê.
 *
 * Não é documentação decorativa: `arvore-arquitetura-guard.test.ts` lê este mapa
 * e reprova o build se um arquivo da árvore escrever em qualquer uma delas. A
 * lista e o guard nascem do mesmo lugar — não há como um crescer sem o outro.
 */
export const OWNERS_CANONICOS = {
  NecessidadeDocumental: "src/services/necessidade-documental.ts",
  Documento: "Sistema Documental (materializarExecucaoDaFase → materializarGenealogia)",
  DocumentoArquivo: "Sistema Documental",
  PhaseWorkflowInstance: "src/services/phase-workflow.ts (motor de workflow)",
  PhaseWorkflowStepInstance: "src/services/phase-workflow.ts (motor de workflow)",
  Tarefa: "motor de workflow (a tarefa é PROJEÇÃO do passo)",
  ObrigacaoEconomica: "Motor Financeiro V3",
  LedgerFinanceiro: "Motor Financeiro V3 (única verdade do movimento)",
  DistribuicaoEconomica: "Motor Financeiro V3",
  ProdutoFinanceiro: "Configuração Financeira (Cadastro Mestre)",
} as const

/**
 * O que a Árvore possui de fato. Curto de propósito: relação genealógica e
 * projeção visual — nada mais.
 */
export const DOMINIO_DA_ARVORE = {
  Pessoa: "relação genealógica (filiação, união) e dados de identidade da pessoa na árvore",
  Uniao: "o casamento como fato genealógico",
  Arvore: "a própria árvore e as posições visuais dos nós",
} as const

export type EntidadeProtegida = keyof typeof OWNERS_CANONICOS
