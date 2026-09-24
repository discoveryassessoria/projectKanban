// scripts/prova-etapa-atual-subtarefa-aguardando-externo.test.ts
// ============================================================================
// PROVA (função pura, sem banco) — achado real 24/09/2026, processo "Teste":
// com a subtarefa 1 ("Enviar requerimento ao cartório") concluída e a
// subtarefa 2 ("Receber confirmação do pedido") em AGUARDANDO_EXTERNO, a
// coluna "Etapa atual" da Central/Resumo da fase mostrava o rótulo da
// subtarefa 1 (já feita) em vez da 2 (a realmente corrente) — mesmo com a
// coluna "Status" corretamente dizendo "Aguardando terceiro" (essa vem da
// Tarefa, fonte à parte). A inconsistência visível levou a uma reabertura
// manual desnecessária da subtarefa 1.
//
// Causa: `expandirComSubtarefas` (estrutura-operacional-core.ts) projeta cada
// subtarefa como um pseudo-passo e reusa `baldeDoPasso`/`rotuloStatusPasso`/
// `STATUS_ESPERA_EXTERNA` — três réguas documentadas para o vocabulário de
// PASSO ("AGUARDANDO"), que nunca reconheciam o literal de SUBTAREFA
// ("AGUARDANDO_EXTERNO", execucao-da-subtarefa.ts). Sem tradução, o balde
// caía em PENDENTE por omissão, e `passoCorrente` (que prefere o balde
// EM_ANDAMENTO) perdia a subtarefa 2 como candidata.
// ============================================================================
import {
  montarEstruturaOperacional,
  montarIndiceOperacional,
  type AlvoBruto,
  type PassoBruto,
} from "../src/lib/process-stage/estrutura-operacional-core"
import { montarPessoasDoProcesso, type PessoaBruta } from "../src/lib/process-stage/central-operacional-core"

let ok = 0, falhou = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.error(`  ❌ ${nome}${detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""}`) }
}

const REQUERENTE: PessoaBruta = { id: 1, nome: "Ademir", sobrenome: "Matheus", sexo: "M", publicCode: "G1", requerente: "maior", linhaReta: true, numeroLinhagem: null, paiId: null, maeId: null }
const PESSOAS = montarPessoasDoProcesso([REQUERENTE], [])

const ALVO: AlvoBruto = {
  chave: "necessidade:1", escopo: "NECESSIDADE", pessoaId: 1, necessidadeId: 1, documentoId: 1,
  titulo: "Certidão de nascimento", subtitulo: null, statusLabel: null, pais: null,
}

/** O MESMO passo/subtarefas de "Solicitar certidão" — subtarefa 1 concluída, 2 em espera externa, 3/4 bloqueadas por dependência. */
const PASSO: PassoBruto = {
  stepInstanceId: 2746, stepDefinitionId: 548, stepKey: "solicitar_certidao",
  titulo: "Solicitar certidão", ordem: 1, obrigatorio: true, status: "EM_ANDAMENTO",
  ciclo: 1, pessoaId: 1, necessidadeId: 1, documentoId: 1,
  responsavelId: null, responsavelNome: null, prazo: "2026-10-03T00:00:00.000Z", diasParaPrazo: 10,
  slaDays: 10, motivo: null, executor: "OPERACAO_DOCUMENTO", erroAdministrativo: null,
  dependeDeStepKeys: [], esperaExternaAoLiberar: false, peso: 1,
  subtarefas: [
    { key: "enviar_requerimento_cartorio", label: "Enviar requerimento ao cartório", ordem: 1, obrigatoria: true, concluida: true, disponivel: false, status: "CONCLUIDO", bloqueioTexto: null },
    { key: "receber_confirmacao_pedido", label: "Receber confirmação do pedido", ordem: 2, obrigatoria: true, concluida: false, disponivel: true, status: "AGUARDANDO_EXTERNO", bloqueioTexto: null },
    { key: "receber_certidao", label: "Receber certidão", ordem: 3, obrigatoria: true, concluida: false, disponivel: false, status: "BLOQUEADO", bloqueioTexto: "Aguarda: Receber confirmação do pedido" },
    { key: "conferir_validar_certidao", label: "Conferir e validar certidão", ordem: 4, obrigatoria: true, concluida: false, disponivel: false, status: "BLOQUEADO", bloqueioTexto: "Aguarda: Receber certidão" },
  ],
}

async function main() {
  console.log("\n=== PROVA — Etapa atual respeita a subtarefa realmente corrente em espera externa ===\n")

  const estrutura = montarEstruturaOperacional({ pessoas: PESSOAS, passos: [PASSO], alvos: [ALVO] })
  const indice = montarIndiceOperacional(estrutura)

  const todos = [...indice.linhaPrincipal, ...indice.foraDaLinha, ...indice.pendenteClassificacao].flatMap((p) => p.documentos)
  check("achou o documento no índice", todos.length === 1, todos.length)
  const doc = todos[0]

  check("1) etapa atual é a subtarefa 2 (Receber confirmação do pedido), não a 1 já concluída",
    doc?.naFase.etapaAtual === "Receber confirmação do pedido", doc?.naFase.etapaAtual)
  check("2) estado derivado (sem Tarefa viva) já reconhece espera externa como AGUARDANDO_TERCEIRO",
    doc?.naFase.estado === "AGUARDANDO_TERCEIRO", doc?.naFase.estado)
  check("3) progresso conta a subtarefa 1 como feita (1 de 4)",
    doc?.naFase.progresso.concluidos === 1 && doc?.naFase.progresso.total === 4, doc?.naFase.progresso)

  console.log(`\n=== ${ok} passaram, ${falhou} falharam ===`)
  if (falhou > 0) { console.error("Falhas:", falhas); process.exit(1) }
}

main()
