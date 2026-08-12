/**
 * CICLO DE VIDA DA PESSOA — prova do CONTRATO. Não precisa de banco.
 * Rodar: npm run test:pessoa-ciclo-vida
 *
 * O teste com banco (criar → materializar → excluir → recriar, 10 rodadas) é
 * `npm run test:pessoa-tortura`. Este aqui prova o que é verificável sem escrever:
 * que a cadeia derivada está DECLARADA por inteiro, que a ordem de remoção
 * respeita as dependências, e que a política de fato protegido não tem furo.
 *
 * Por que separar: o guard estático (`test:guard-pessoa`) prova que existe UM
 * dono. Este prova que esse dono cobre a cadeia inteira. São perguntas
 * diferentes: um motor único que esquece a metade da cadeia continua deixando
 * órfão.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8")

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const servico = ler("src/services/pessoa-ciclo-vida.ts")
const docSvc = ler("src/services/documento-operacional.ts")
const schema = ler("prisma/schema.prisma")

console.log("CICLO DE VIDA DA PESSOA — contrato\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("1) A cadeia derivada está declarada POR INTEIRO")
// A lista veio do schema: tudo que aponta para Pessoa (por FK ou por coluna
// solta) e tudo que aponta para o Requerente dela. Faltar um elo aqui é
// exatamente o defeito que este trabalho corrige.
// ═══════════════════════════════════════════════════════════════════════════

const ELOS: [string, RegExp, string][] = [
  ["vínculo pessoa↔processo", /processoRequerente\.(deleteMany|updateMany)/, "ProcessoRequerente sobrevivia intocado"],
  ["ponteiro Requerente→Pessoa", /requerente\.update\([\s\S]{0,120}personId: null/, "SetNull deixava a linha viva sem identidade"],
  ["participante financeiro", /receitaRequerente\.deleteMany/, "ReceitaRequerente ficava na distribuição"],
  ["distribuição econômica", /distribuicaoEconomica\.deleteMany/, ""],
  ["projeção de saldo", /saldoProjecao\.deleteMany/, ""],
  ["ocorrência financeira", /ocorrenciaFinanceira\.deleteMany/, ""],
  ["ledger da obrigação", /ledgerFinanceiro\.deleteMany/, ""],
  ["obrigação econômica", /obrigacaoEconomica\.deleteMany/, "personId é coluna solta, sem FK"],
  ["receita", /receita\.deleteMany/, "Receita.personId era SetNull"],
  ["custo", /custo\.deleteMany/, "Custo.personId era SetNull"],
  ["parcela financeira", /parcelaFinanceira\.deleteMany/, ""],
  ["evento financeiro", /eventoFinanceiro\.deleteMany/, ""],
  ["tarefa", /tarefa\.deleteMany/, "Tarefa.workflowStepInstanceId era SetNull → tarefa fantasma"],
  ["passo do workflow", /phaseWorkflowStepInstance\.deleteMany/, "pessoaId era SetNull → passo sem escopo"],
  ["documento (serviço canônico)", /removerDocumentosDoSujeito\(/, ""],
  ["necessidade (serviço canônico)", /removerNecessidadesDoSujeito\(/, ""],
  ["união", /uniao\.deleteMany/, ""],
  ["referência de pai nos filhos", /paiId: ctx\.pessoa\.id/, ""],
  ["referência de mãe nos filhos", /maeId: ctx\.pessoa\.id/, ""],
  ["pessoa principal da árvore", /pessoaPrincipalId: ctx\.pessoa\.id/, "árvore apontaria para nó inexistente"],
  ["o nó da árvore", /pessoa\.delete\(/, ""],
]
for (const [elo, padrao, porque] of ELOS) {
  ok(`hard delete cobre: ${elo}`, padrao.test(servico), porque)
}

// ═══════════════════════════════════════════════════════════════════════════
secao("2) A ordem respeita as dependências (folhas antes da raiz)")
// ═══════════════════════════════════════════════════════════════════════════

const hard = servico.slice(servico.indexOf("async function executarHard"))
const pos = (re: RegExp) => { const m = hard.match(re); return m?.index ?? -1 }

ok("participante sai antes da receita",
  pos(/receitaRequerente\.deleteMany/) < pos(/out\.receitasPrevistas/))
ok("distribuição sai antes da obrigação",
  pos(/distribuicaoEconomica\.deleteMany/) < pos(/out\.obrigacoesPrevistas/))
ok("tarefa sai antes do passo (a tarefa é a projeção do passo)",
  pos(/out\.tarefas =/) < pos(/out\.passos =/))
ok("o vínculo com o processo sai antes da pessoa",
  pos(/processoRequerente\.deleteMany/) < pos(/pessoa\.delete\(/))
ok("a pessoa é a ÚLTIMA a sair",
  pos(/pessoa\.delete\(/) > pos(/uniao\.deleteMany/))

// ═══════════════════════════════════════════════════════════════════════════
secao("3) Fato protegido: a lista cobre dinheiro, papel e protocolo")
// ═══════════════════════════════════════════════════════════════════════════

const FATOS: [string, RegExp][] = [
  ["movimento financeiro", /OCORRENCIAS_DE_MOVIMENTO/],
  ["lançamento no ledger", /ledgerEntry\.findMany/],
  ["fatura emitida", /faturaDestinatario\.findMany/],
  ["pagamento recebido", /pagamentoDestinatario\.findMany/],
  ["recibo emitido", /recibo\.findMany/],
  ["protocolo oficial", /protocolo\.findMany/],
  ["documento protocolado", /protocoloDocumento\.findMany/],
  ["arquivo oficial anexado", /documentoArquivo\.findMany/],
  ["solicitação já enviada", /solicitacaoDocumento\.findMany/],
  ["documento gerado por modelo", /documentoGerado\.findMany/],
  ["anexo do requerente", /anexoRequerente\.findMany/],
]
for (const [fato, padrao] of FATOS) ok(`impede hard delete: ${fato}`, padrao.test(servico))

ok("OBRIGACAO_CRIADA NÃO conta como movimento",
  !/OCORRENCIAS_DE_MOVIMENTO[\s\S]{0,200}OBRIGACAO_CRIADA/.test(servico),
  "é registro de nascimento da obrigação, não dinheiro que se moveu")
ok("ocorrência rejeitada/revertida NÃO conta como movimento",
  /notIn: \["REJEITADA", "REVERTIDA"\]/.test(servico))

// ═══════════════════════════════════════════════════════════════════════════
secao("4) Transação, lock e recusa explícita")
// ═══════════════════════════════════════════════════════════════════════════

ok("tudo roda dentro de UMA transação", /prisma\.\$transaction\(async \(tx\)/.test(servico))
// O timeout padrão do Prisma (5s) não cobre a cascata contra banco remoto: o
// smoke em produção reprovou com P2028 no meio da exclusão. Encurtar a
// transação seria aceitar meia exclusão — o defeito que este serviço impede.
ok("a transação tem timeout explícito, dimensionado para banco remoto",
  /timeout: 60_000/.test(servico) && /maxWait: 15_000/.test(servico))
ok("a Pessoa é travada com FOR UPDATE antes de decidir", /FOR UPDATE/.test(servico))
ok("o plano é recalculado DENTRO da transação, não confiado da tela",
  /analisarRemocaoPessoa\(input\.pessoaId, tx\)/.test(servico))
ok("hard delete contra fato protegido RECUSA (não vira desativação silenciosa)",
  /if \(efetivo === "HARD" && !plano\.podeHardDelete\)/.test(servico))
ok("modo AUTO escolhe pelo fato, não por preferência",
  /modo === "AUTO" \? plano\.modoSugerido : modo/.test(servico))
ok("toda remoção é auditada com o que saiu e o que ficou",
  /logAuditoria\.create\([\s\S]{0,600}fatosProtegidos/.test(servico))

// ═══════════════════════════════════════════════════════════════════════════
secao("5) Desativação preserva o fato e limpa só a projeção ativa")
// ═══════════════════════════════════════════════════════════════════════════

const desat = servico.slice(servico.indexOf("async function executarDesativacao"))
ok("só remove tarefa NÃO INICIADA", /statusTarefa: "NAO_INICIADA"/.test(desat))
ok("só remove passo PENDENTE/DISPONIVEL", /status: \{ in: \["PENDENTE", "DISPONIVEL"\] \}/.test(desat))
ok("NÃO apaga a Pessoa", !/pessoa\.delete\(/.test(desat))
ok("NÃO apaga o vínculo com o processo", !/processoRequerente\.deleteMany/.test(desat))
ok("marca o vínculo como removido", /removidoEm: agora/.test(desat))
ok("marca o nó como removido", /removidaEm: agora/.test(desat))
ok("NÃO apaga receita nem obrigação", !/receita\.deleteMany|obrigacaoEconomica\.deleteMany/.test(desat))

// ═══════════════════════════════════════════════════════════════════════════
secao("6) Identidade resolvida por ID — nunca por texto")
// ═══════════════════════════════════════════════════════════════════════════

// Um campo textual só é RESOLUÇÃO DE IDENTIDADE quando aparece dentro de um
// `where`. Em `select` ele é leitura para exibir — por isso o teste isola o
// bloco do filtro antes de procurar, em vez de varrer o arquivo inteiro.
const blocosWhere = [...servico.matchAll(/where:\s*\{([^}]*)\}/g)].map((m) => m[1])
for (const campo of ["nome", "cpf", "email", "telefone", "titulo", "descricao"]) {
  const usado = blocosWhere.filter((b) => new RegExp(`\\b${campo}\\s*:`).test(b))
  ok(`o serviço não resolve vínculo por ${campo}`, usado.length === 0,
    usado.join(" | ") || "")
}
ok("o serviço de documento também não resolve por texto",
  !/where:[\s\S]{0,120}\btitulo:/.test(docSvc),
  "a rota antiga achava tarefa por igualdade de título")
ok("a Pessoa é alcançada por personId", /personId: pessoaId/.test(servico))

// ═══════════════════════════════════════════════════════════════════════════
secao("7) O escopo não vaza para outro processo nem para outra pessoa")
// ═══════════════════════════════════════════════════════════════════════════

ok("participante financeiro é limitado às receitas DESTE processo",
  /requerenteId: requerente\.id,[\s\S]{0,200}receita: \{ processoId: \{ in: processoIds \} \}/.test(servico))
ok("o vínculo removido é o DESTE processo",
  /requerenteId: ctx\.requerenteId, processoId: \{ in: ctx\.processoIds \}/.test(servico))
ok("a necessidade removida é a DO SUJEITO, não a da fase inteira",
  /removerNecessidadesDoSujeito\(\{ pessoaId: ctx\.pessoa\.id, uniaoIds: ctx\.uniaoIds \}/.test(servico))
ok("o cadastro do Requerente NÃO é apagado",
  !/requerente\.delete\(/.test(servico),
  "ele pode existir em outro processo, no histórico ou como cliente")

// ═══════════════════════════════════════════════════════════════════════════
secao("8) Reinserção e constraints")
// ═══════════════════════════════════════════════════════════════════════════

const vinc = ler("lib/genealogia/vincular-requerente.ts")
ok("reinserção REATIVA o nó removido", /removidaEm != null/.test(vinc))
ok("reinserção reativa o vínculo com o processo",
  /processoRequerente\.updateMany\([\s\S]{0,200}removidoEm: null/.test(vinc))
ok("existe função explícita de reativação no serviço", /export async function reativarVinculoDaPessoa/.test(servico))
ok("uma Pessoa ⇒ no máximo um Requerente (constraint)", /personId Int\?\s+@unique/.test(schema))
ok("um requerente ⇒ uma linha por receita (constraint)",
  /@@unique\(\[receitaId, requerenteId\]\)/.test(schema))

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(64)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhou > 0) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}
console.log("Contrato do ciclo de vida da Pessoa: íntegro.\n")
