// scripts/torre-bloco-e-capacidade-ausencia.test.ts
// ============================================================================
// TORRE DE CONTROLE, BLOCO E1 + E2 (29/09/2026) — capacidade medida, fila em
// semanas, e o sucessor SUGERIDO (nunca redirecionado automaticamente) numa
// ausência.
//
//   npx tsx scripts/torre-bloco-e-capacidade-ausencia.test.ts
//
// Roda contra o banco de TESTE. Não toca em produção.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-bloco-e-capacidade-ausencia.test.ts")

import { prisma } from "../lib/prisma"
import { capacidadeMedidaPorUsuario, abrirIndisponibilidade, lerOrganizacao } from "../lib/operacional/organizacao"
import { sugerirSucessor } from "../lib/operacional/elegibilidade"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = "TORRE_E1E2_"

async function limpar() {
  await prisma.indisponibilidadeOperacional.deleteMany({ where: { usuario: { email: { startsWith: MARCA } } } })
  await prisma.tarefa.deleteMany({ where: { titulo: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA } } })
}

async function main() {
  await limpar()

  secao("E1 · CAPACIDADE MEDIDA — média real das últimas 4 semanas")

  const ativo = await prisma.usuario.create({
    data: { nome: `${MARCA}Ativo`, email: `${MARCA}ativo@teste.com`, senha: "x", tipo: "assistente" },
  })
  const parado = await prisma.usuario.create({
    data: { nome: `${MARCA}Parado`, email: `${MARCA}parado@teste.com`, senha: "x", tipo: "assistente" },
  })

  const agora = new Date()
  const diasAtras = (n: number) => new Date(agora.getTime() - n * 86_400_000)

  // Ativo concluiu 8 tarefas nas últimas 4 semanas (dentro da janela) — média = 2/semana.
  for (let i = 0; i < 8; i++) {
    await prisma.tarefa.create({
      data: {
        titulo: `${MARCA}concluida-${i}`, responsavelId: ativo.id,
        statusTarefa: "CONCLUIDO_RECEBIDO", dataConclusao: diasAtras(3 + i * 2),
      },
    })
  }
  // Uma conclusão FORA da janela (35 dias atrás) — não deve entrar na média.
  await prisma.tarefa.create({
    data: { titulo: `${MARCA}concluida-fora`, responsavelId: ativo.id, statusTarefa: "CONCLUIDO_RECEBIDO", dataConclusao: diasAtras(35) },
  })
  // Uma CANCELADA no período — cancelamento não é conclusão (regra permanente).
  await prisma.tarefa.create({
    data: { titulo: `${MARCA}cancelada`, responsavelId: ativo.id, statusTarefa: "CANCELADA", dataConclusao: diasAtras(2) },
  })
  // Ativo tem 6 tarefas ativas agora — fila em semanas = 6 / 2 = 3.
  for (let i = 0; i < 6; i++) {
    await prisma.tarefa.create({ data: { titulo: `${MARCA}ativa-${i}`, responsavelId: ativo.id, statusTarefa: "EM_ANDAMENTO" } })
  }

  const cm = await capacidadeMedidaPorUsuario([ativo.id, parado.id], new Map([[ativo.id, 6], [parado.id, 0]]), agora)

  ok("conta as 8 concluídas dentro da janela, nunca a de 35 dias atrás", cm.get(ativo.id)?.concluidasUltimasSemanas === 8,
    `got ${cm.get(ativo.id)?.concluidasUltimasSemanas}`)
  ok("nunca conta CANCELADA como conclusão", cm.get(ativo.id)?.concluidasUltimasSemanas === 8)
  ok("média semanal = 8/4 = 2", cm.get(ativo.id)?.mediaSemanal === 2, `got ${cm.get(ativo.id)?.mediaSemanal}`)
  ok("fila em semanas = 6/2 = 3", cm.get(ativo.id)?.filaEmSemanas === 3, `got ${cm.get(ativo.id)?.filaEmSemanas}`)
  ok("sem conclusão nenhuma → média 0", cm.get(parado.id)?.mediaSemanal === 0)
  ok("média 0 → fila em semanas é null (nunca dividir por zero)", cm.get(parado.id)?.filaEmSemanas === null,
    `got ${cm.get(parado.id)?.filaEmSemanas}`)

  secao("E2 · SUCESSOR SUGERIDO — só sugestão, nunca redireciona")

  const unidade = await prisma.perfilOperacionalDocumento.findFirst({ where: { ativo: true } })
  if (!unidade) {
    console.log("  ⚠ sem PerfilOperacionalDocumento ativo no banco de teste — pulando o recorte por aptidão")
  }

  const candidatoLeve = await prisma.usuario.create({
    data: { nome: `${MARCA}CandidatoLeve`, email: `${MARCA}leve@teste.com`, senha: "x", tipo: "assistente" },
  })
  const candidatoPesado = await prisma.usuario.create({
    data: { nome: `${MARCA}CandidatoPesado`, email: `${MARCA}pesado@teste.com`, senha: "x", tipo: "assistente" },
  })
  const candidatoIndisponivel = await prisma.usuario.create({
    data: { nome: `${MARCA}CandidatoIndisponivel`, email: `${MARCA}indisp@teste.com`, senha: "x", tipo: "assistente" },
  })

  // Todos precisam de permissão de executar — via perfil "assistente" default (ver seed de permissões) OU permissoesCustom direto.
  await prisma.usuario.updateMany({
    where: { id: { in: [candidatoLeve.id, candidatoPesado.id, candidatoIndisponivel.id] } },
    data: { permissoesCustom: { "tarefas.iniciar_concluir": true } },
  })

  // Pesado tem 5 tarefas ativas; Leve tem 0. Leve deve ganhar — inclusive
  // contra QUALQUER outro usuário já cadastrado no banco (ex.: o admin da
  // fixture mínima, que também tem permissão e carga zero): dar carga a
  // TODOS os outros usuários ativos do banco isola o teste de quem mais
  // exista na base.
  for (let i = 0; i < 5; i++) {
    await prisma.tarefa.create({ data: { titulo: `${MARCA}carga-pesado-${i}`, responsavelId: candidatoPesado.id, statusTarefa: "EM_ANDAMENTO" } })
  }
  const outrosUsuarios = await prisma.usuario.findMany({
    where: { id: { notIn: [ativo.id, parado.id, candidatoLeve.id, candidatoPesado.id, candidatoIndisponivel.id] } },
    select: { id: true },
  })
  for (const u of outrosUsuarios) {
    await prisma.tarefa.create({ data: { titulo: `${MARCA}carga-outro-${u.id}`, responsavelId: u.id, statusTarefa: "EM_ANDAMENTO" } })
  }
  // Indisponível está de férias AGORA — nunca pode ser sugerido, mesmo com carga zero.
  await abrirIndisponibilidade({
    usuarioId: candidatoIndisponivel.id, tipo: "FERIAS",
    inicio: diasAtras(1), fim: null, autorId: ativo.id,
  })

  const sugestao = await sugerirSucessor(candidatoPesado.id, agora)
  ok("sugere alguém", sugestao != null)
  ok("sugere o de MENOR carga (Leve), nunca o próprio ausente", sugestao?.usuarioId === candidatoLeve.id,
    `got ${sugestao?.nome}`)

  const sugestaoParaLeve = await sugerirSucessor(candidatoLeve.id, agora)
  ok("nunca sugere alguém INDISPONÍVEL, mesmo com carga zero",
    sugestaoParaLeve?.usuarioId !== candidatoIndisponivel.id)

  // A ausência REGISTRA a sugestão, mas não move nenhuma tarefa.
  const antesDeAbrir = await prisma.tarefa.count({ where: { responsavelId: candidatoPesado.id, statusTarefa: { in: ["EM_ANDAMENTO"] } } })
  const abertura = await abrirIndisponibilidade({
    usuarioId: candidatoPesado.id, tipo: "AUSENCIA", inicio: agora, fim: null,
    autorId: ativo.id, sucessorSugeridoId: sugestao?.usuarioId ?? null,
  })
  ok("abre a ausência", abertura.ok === true)
  const depoisDeAbrir = await prisma.tarefa.count({ where: { responsavelId: candidatoPesado.id, statusTarefa: { in: ["EM_ANDAMENTO"] } } })
  ok("NENHUMA tarefa foi movida ao abrir a ausência (r4 não existe)", antesDeAbrir === depoisDeAbrir,
    `antes=${antesDeAbrir} depois=${depoisDeAbrir}`)

  const org = await lerOrganizacao(agora)
  const registrado = org.get(candidatoPesado.id)?.indisponibilidades.find((i) => i.tipo === "AUSENCIA")
  ok("a sugestão fica registrada e legível na organização do ausente",
    registrado?.sucessorSugerido?.usuarioId === candidatoLeve.id,
    `got ${JSON.stringify(registrado?.sucessorSugerido)}`)

  ok("recusa sucessor sugerido = a própria pessoa ausente",
    (await abrirIndisponibilidade({
      usuarioId: candidatoLeve.id, tipo: "AUSENCIA", inicio: agora, fim: null,
      autorId: ativo.id, sucessorSugeridoId: candidatoLeve.id,
    })).ok === false)

  await limpar()

  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
