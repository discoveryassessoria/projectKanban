// scripts/palco-distribuicao.ts
// Monta no banco de TESTE o cenário da tela de Operação e DEIXA os dados de pé,
// para a captura visual. Não roda em produção (guarda de banco de teste).
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"
import { atribuirTarefa } from "@/lib/operacional/tarefa-comandos"

const MARCA = "PALCO"
const CENAS: Array<{ nome: string; pessoa: [string, string]; item: string; etapa: string; dias: number; prio: "URGENTE" | "ALTA" | "MEDIA" | "BAIXA"; dono?: "dani" }> = [
  { nome: "Família Rovatti",  pessoa: ["João", "da Silva"],      item: "Certidão de Nascimento",  etapa: "Pesquisar registro",       dias: -4, prio: "MEDIA" },
  { nome: "Família Brait",    pessoa: ["Maria", "Ferreira"],     item: "Certidão de Casamento",   etapa: "Solicitar ao cartório",    dias: 40, prio: "URGENTE" },
  { nome: "Família Gerbi",    pessoa: ["Antônio", "Rovatti"],    item: "Certidão de Óbito",       etapa: "Conferir dados",           dias: 2,  prio: "MEDIA" },
  { nome: "Família Souza",    pessoa: ["Carolina", "Menezes"],   item: "Certidão de Nascimento",  etapa: "Aguardar cartório",        dias: 12, prio: "ALTA" },
  { nome: "Família Almeida",  pessoa: ["Eduardo", "Almeida"],    item: "Inteiro Teor",            etapa: "Validar transcrição",      dias: 25, prio: "BAIXA", dono: "dani" },
  { nome: "Família Pereira",  pessoa: ["Beatriz", "Pereira"],    item: "Certidão de Casamento",   etapa: "Pesquisar registro",       dias: -1, prio: "ALTA",  dono: "dani" },
  { nome: "Família Lima",     pessoa: ["Rafael", "Lima"],        item: "Certidão de Nascimento",  etapa: "Solicitar ao cartório",    dias: 6,  prio: "MEDIA", dono: "dani" },
]

async function main() {
  exigirBancoDeTeste("monta o palco visual da Operação")
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefaId: { in: ts.map((t) => t.id) } } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: ts.map((t) => t.id) } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })

  const gestor = await prisma.usuario.upsert({
    where: { email: "gestor@palco.test" },
    create: { nome: "Marco Rovatti", email: "gestor@palco.test", senha: "x", tipo: "admin" },
    update: {}, select: { id: true },
  })
  // O FUNCIONÁRIO DO PALCO É UM FUNCIONÁRIO DE VERDADE.
  //
  // `assistente` sem perfil e sem permissões nominais não tem permissão nenhuma
  // — e é assim que o sistema real funciona. Dar a ele o mesmo conjunto que a
  // operação de produção concede é o que faz a captura mostrar a tela que o
  // funcionário realmente vê, em vez de uma tela vazia por falta de acesso.
  // O CONJUNTO REAL de uma assistente em produção — copiado do cadastro, não
  // inventado. Com só as permissões de `tarefas.*`, o funcionário abria a
  // tarefa e o executor da etapa, mas `POST /documentos/{id}/solicitacoes`
  // respondia 403: a operação documental exige permissão documental.
  const PERMISSOES_EXECUTOR = {
    "arvore.ver": true, "arvore.criar": true, "arvore.editar": true, "arvore.excluir": true,
    "arvore.criar_documento": true, "arvore.editar_documento": true, "arvore.excluir_documento": true,
    "clientes.ver": true, "clientes.criar": true, "clientes.editar": true, "clientes.excluir": true,
    "eventos.ver": true, "eventos.criar": true, "eventos.editar": true, "eventos.excluir": true,
    "processos.ver": true, "processos.criar": true, "processos.editar": true, "processos.excluir": true,
    "processos.ver_paginas": true, "processos.editar_paginas": true,
    "processos.criar_coluna": true, "processos.editar_coluna": true, "processos.excluir_coluna": true,
    "processos.editar_status": true,
    "tarefas.ver": true, "tarefas.criar": true, "tarefas.editar": true,
    "tarefas.excluir": true, "tarefas.iniciar_concluir": true,
    // AS PERMISSÕES DE WORKFLOW — que a Daniela de PRODUÇÃO não tem.
    //
    // Sem `workflow.concluirPasso` o funcionário abre a tarefa, abre o
    // executor, preenche tudo e a ação terminal responde 403: ele consegue
    // preparar o trabalho e não consegue registrá-lo. Aqui elas existem para
    // que o teste percorra a operação inteira; em produção, conceder é decisão
    // de cadastro.
    "workflow.iniciarPasso": true, "workflow.concluirPasso": true,
    "workflow.gerarTarefa": true, "workflow.dispensarPasso": true,
    "tarefas.bloquear": true,
  }
  const dani = await prisma.usuario.upsert({
    where: { email: "daniela@palco.test" },
    create: { nome: "Daniela Brait", email: "daniela@palco.test", senha: "x", tipo: "assistente", permissoesCustom: PERMISSOES_EXECUTOR },
    update: { permissoesCustom: PERMISSOES_EXECUTOR }, select: { id: true },
  })
  await prisma.usuario.upsert({
    where: { email: "maria@palco.test" },
    create: { nome: "Maria Souza", email: "maria@palco.test", senha: "x", tipo: "assistente", permissoesCustom: PERMISSOES_EXECUTOR },
    update: { permissoesCustom: PERMISSOES_EXECUTOR }, select: { id: true },
  })

  for (const [i, c] of CENAS.entries()) {
    const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${i}`, name: c.item, natureza: "DOCUMENTO" }, select: { id: true } })
    const arv = await prisma.arvore.create({ data: { nome: `${MARCA} ${i}` }, select: { id: true } })
    const proc = await prisma.processo.create({ data: { nome: `${MARCA} ${c.nome}`, pais: "espanha", arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: "emissao_documental" }, select: { id: true } })
    const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: c.pessoa[0], sobrenome: c.pessoa[1] }, select: { id: true } })
    const doc = await prisma.documento.create({ data: { pessoaId: pes.id, descricao: c.item, status: "SOLICITAR" }, select: { id: true } })
    const nec = await prisma.necessidadeDocumental.create({ data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-n-${i}` }, select: { id: true } })
    const inst = await prisma.phaseWorkflowInstance.create({ data: { processoId: proc.id, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-i-${i}` }, select: { id: true } })
    // O WORKFLOW INTERNO REAL da Emissão Documental: cinco etapas, uma tarefa.
    // As chaves PUBLICADAS importam: é por elas que o registry resolve qual
    // executor especializado abre em cada etapa.
    const ETAPAS: Array<[string, string]> = [
      ["solicitar_certidao", "Solicitar certidão"],
      ["aguardar_retorno_do_cartorio", "Aguardar retorno do cartório"],
      ["receber_certidao", "Receber certidão"],
      ["conferir_certidao", "Conferir certidão"],
      ["validar_certidao", "Validar certidão"],
    ]
    for (const [j, [chave, label]] of ETAPAS.entries()) {
      await prisma.phaseWorkflowStepInstance.create({
        data: {
          workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "emissao_documental", stepKey: chave,
          ordem: j + 1, tipo: "HUMANO", obrigatorio: true, status: j === 0 ? "DISPONIVEL" : "PENDENTE",
          necessidadeId: nec.id, documentoId: doc.id, pessoaId: pes.id, papel: "equipe_documental", slaDays: 5, ciclo: 1,
          snapshot: { label, titulo: `${c.item} — ${c.pessoa[0]} ${c.pessoa[1]}` } as never, chaveIdempotencia: `${MARCA}-s-${i}-${j}`,
        },
      })
    }
    await reconciliarTarefas({ processoId: proc.id })
    const t = await prisma.tarefa.findFirstOrThrow({ where: { processoId: proc.id }, select: { id: true } })
    await prisma.tarefa.update({
      where: { id: t.id },
      // O TÍTULO NÃO É ESCRITO AQUI. Quem nomeia é o motor, pela unidade de
      // trabalho — é justamente isso que a captura precisa mostrar.
      data: { prioridade: c.prio, dataPrazo: new Date(Date.now() + c.dias * 86400000) },
    })
    if (c.dono === "dani") await atribuirTarefa({ tarefaId: t.id, responsavelId: dani.id, autorId: gestor.id })
  }

  const u = await prisma.usuario.findUniqueOrThrow({ where: { email: "gestor@palco.test" }, select: { id: true, nome: true, email: true, tipo: true } })
  console.log(JSON.stringify({ gestor: u, dani }))
  await prisma.$disconnect()
}
main()
