// src/lib/requisitos/completude.ts
//
// O MOTOR DE COMPLETUDE — "o que deveria existir" contra "o que existe".
//
// ─── A CADEIA, E POR QUE ELE NÃO DECIDE NADA ───────────────────────────────
//   CADASTRO MESTRE → REGRA → REQUISITO APLICÁVEL → OBRIGAÇÃO → EVIDÊNCIA
//   → SATISFAÇÃO → PENDÊNCIA → RELATÓRIO
//
// Este arquivo é o penúltimo elo. Ele NÃO sabe que RG é obrigatório, NÃO tem
// lista de documentos e NÃO tem lista de campos: ele PERGUNTA ao cadastro quais
// requisitos incidem e compara com o que a operação registrou. Se amanhã alguém
// cadastrar "passaporte obrigatório para maiores de 18 na rota espanhola", este
// código não muda.
//
// ─── DUAS NATUREZAS, UMA RESPOSTA ──────────────────────────────────────────
// DOCUMENTAL — vem de `NecessidadeDocumental`, a obrigação que a Matriz
//   Documental materializou. Ela já carrega o snapshot da regra que a gerou.
// CADASTRAL — vem de `RequisitoCadastral`, e a satisfação é lida na coluna real
//   da entidade dona (Requerente.email…), com a validação canônica de
//   `campos-canonicos.ts`. Nenhum valor é copiado para cá.
//
// ─── O QUE NÃO É PENDÊNCIA ─────────────────────────────────────────────────
// NÃO APLICÁVEL não entra na conta — nem como pendente, nem no denominador.
// DISPENSADO incidia e foi formalmente dispensado: sai das pendências, mas
// continua visível na sua própria categoria. NÃO LOCALIZADA é resultado
// documental, não recusa e não ausência. Colapsar isso em "faltando" é o erro
// clássico que faz o operador correr atrás do que já foi resolvido.

import { prisma } from "@/lib/prisma"
import { CAMPOS_CANONICOS, campoPorChave, valorSatisfaz } from "./campos-canonicos"

export type EstadoRequisito = "SATISFEITO" | "PENDENTE" | "DISPENSADO" | "NAO_LOCALIZADA" | "EM_ATENDIMENTO"

export interface RequisitoAvaliado {
  /** Chave estável para a tela: `cad:<code>` ou `doc:<necessidadeId>`. */
  chave: string
  natureza: "CADASTRAL" | "DOCUMENTAL"
  rotulo: string
  estado: EstadoRequisito
  bloqueante: boolean
  /**
   * PROVENIÊNCIA — de onde esta linha veio e por que ela existe. É o que permite
   * responder "por que o sistema diz que falta RG para Marco?" sem abrir o código.
   */
  origem: {
    fonte: "RequisitoCadastral" | "NecessidadeDocumental"
    id: number
    code?: string | null
    /** Regra que gerou a obrigação documental, e a versão congelada nela. */
    regraId?: number | null
    regraVersao?: number | null
    motivo?: string | null
    /** Onde corrigir: entidade e campo, para o drill-down. */
    entidade?: string
    campo?: string
  }
}

export interface CompletudeDaPessoa {
  requerenteId: number
  nome: string
  aplicaveis: number
  satisfeitos: number
  pendentes: number
  bloqueadores: number
  dispensados: number
  /** Denominador = aplicáveis. Requisito que não incide não reduz completude. */
  percentual: number
  requisitos: RequisitoAvaliado[]
}

export interface CompletudeDoProcesso {
  processoId: number
  pais: string | null
  modalidadeLegal: string | null
  pessoas: CompletudeDaPessoa[]
  totais: { aplicaveis: number; satisfeitos: number; pendentes: number; bloqueadores: number; percentual: number }
  /** Pronto = nenhum BLOQUEADOR pendente. Motivos listados quando não. */
  pronto: boolean
  bloqueadores: { requerenteId: number; nome: string; rotulo: string; natureza: string }[]
}

/** Idade em anos completos NA DATA DE REFERÊNCIA. Nunca persistida. */
export function idadeEm(nascimento: Date | null | undefined, referencia = new Date()): number | null {
  if (!nascimento) return null
  const n = new Date(nascimento)
  if (Number.isNaN(n.getTime())) return null
  let idade = referencia.getFullYear() - n.getFullYear()
  const m = referencia.getMonth() - n.getMonth()
  if (m < 0 || (m === 0 && referencia.getDate() < n.getDate())) idade--
  return idade
}

/**
 * A avaliação de UM processo.
 *
 * Consulta em bloco de propósito: uma varredura por pessoa multiplicaria as
 * idas ao banco pelo tamanho da família, e este motor precisa servir também o
 * relatório, que roda sobre muitos processos.
 */
export async function completudeDoProcesso(
  processoId: number, referencia = new Date(),
): Promise<CompletudeDoProcesso | null> {
  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: {
      id: true, paisId: true,
      paisCanonico: { select: { id: true, countryKey: true, countryLabel: true } },
      tiposServico: { select: { id: true } },
      enquadramentoLegal: { select: { modalidadeLegalId: true, modalidadeLegal: { select: { id: true, nome: true } } } },
      requerentes: {
        select: {
          requerente: {
            select: {
              id: true, nome: true, cpf: true, rg: true, dataNascimento: true, sexo: true, estadoCivil: true,
              email: true, telefone: true, endereco: true, numero: true, bairro: true, cidade: true,
              estado: true, cep: true, passaporte: true, crnm: true, personId: true,
            },
          },
        },
      },
    },
  })
  if (!processo) return null

  // IDENTIDADE, E SÓ. A resolução pelo texto legado deixou de existir junto com
  // a coluna: o país do processo é a relação, carregada no mesmo select.
  const paisCanonico = processo.paisCanonico

  const modalidadeId = processo.enquadramentoLegal?.modalidadeLegalId ?? null

  // ── REQUISITOS CADASTRAIS APLICÁVEIS ─────────────────────────────────────
  // Escopo NULO significa "qualquer". A vigência é comparada com a referência:
  // regra que ainda não começou ou já terminou não incide.
  const requisitos = await prisma.requisitoCadastral.findMany({
    where: {
      ativo: true,
      OR: [{ paisId: null }, ...(paisCanonico ? [{ paisId: paisCanonico.id }] : [])],
      // Sem filtro de vigência: cadastro vale até ser inativado (regra do
      // produto). O recorte temporal de uma pendência vem do FATO, não daqui.
      AND: [
        { OR: [{ modalidadeLegalId: null }, ...(modalidadeId ? [{ modalidadeLegalId: modalidadeId }] : [])] },
      ],
    },
    orderBy: [{ ordem: "asc" }, { nome: "asc" }],
  })

  // ── OBRIGAÇÕES DOCUMENTAIS DO PROCESSO ───────────────────────────────────
  const necessidades = await prisma.necessidadeDocumental.findMany({
    where: { processoId, supersedePorId: null },
    select: {
      id: true, status: true, obrigatoriedade: true, pessoaId: true,
      matrizRegraId: true, matrizRegraVersao: true, motivoAplicabilidade: true,
      itemCatalogo: { select: { id: true, name: true, code: true } },
    },
  })

  const pessoas: CompletudeDaPessoa[] = []
  const bloqueadores: CompletudeDoProcesso["bloqueadores"] = []

  for (const { requerente: r } of processo.requerentes) {
    const idade = idadeEm(r.dataNascimento, referencia)
    const avaliados: RequisitoAvaliado[] = []

    for (const req of requisitos) {
      // FAIXA ETÁRIA — sem data de nascimento a idade é desconhecida, e um
      // requisito por faixa NÃO se aplica a quem não se sabe a idade. Presumir
      // que se aplica criaria pendência sobre suposição.
      if (req.idadeMinima != null || req.idadeMaxima != null) {
        if (idade == null) continue
        if (req.idadeMinima != null && idade < req.idadeMinima) continue
        if (req.idadeMaxima != null && idade > req.idadeMaxima) continue
      }
      const campo = campoPorChave(req.campoKey)
      // Requisito apontando para campo que não existe no catálogo é
      // configuração quebrada, não pendência da pessoa: não vira cobrança.
      if (!campo || campo.entidade !== "Requerente") continue

      const satisfeito = valorSatisfaz(campo, r as unknown as Record<string, unknown>)
      avaliados.push({
        chave: `cad:${req.code}`,
        natureza: "CADASTRAL",
        rotulo: req.nome,
        estado: satisfeito ? "SATISFEITO" : "PENDENTE",
        bloqueante: req.bloqueante,
        origem: {
          fonte: "RequisitoCadastral",
          id: req.id,
          code: req.code,
          motivo: req.descricao,
          entidade: campo.entidade,
          campo: campo.colunas.join(", "),
        },
      })
    }

    // As obrigações documentais desta pessoa. O vínculo é pelo nó da árvore
    // (`personId`) porque a necessidade é do SUJEITO genealógico, não do
    // cliente — a mesma pessoa pode ser requerente e ascendente de outra.
    for (const n of necessidades.filter((n) => r.personId != null && n.pessoaId === r.personId)) {
      const estado: EstadoRequisito =
        n.status === "ATENDIDA" ? "SATISFEITO"
        : n.status === "DISPENSADA" ? "DISPENSADO"
        : n.status === "NAO_LOCALIZADA" ? "NAO_LOCALIZADA"
        : n.status === "EM_ATENDIMENTO" ? "EM_ATENDIMENTO"
        : "PENDENTE"
      avaliados.push({
        chave: `doc:${n.id}`,
        natureza: "DOCUMENTAL",
        rotulo: n.itemCatalogo?.name ?? `Documento #${n.id}`,
        estado,
        bloqueante: n.obrigatoriedade === "OBRIGATORIA",
        origem: {
          fonte: "NecessidadeDocumental",
          id: n.id,
          regraId: n.matrizRegraId,
          regraVersao: n.matrizRegraVersao,
          motivo: n.motivoAplicabilidade,
        },
      })
    }

    // DISPENSADO sai do denominador: ele incidia, mas deixou de ser exigido.
    // Mantê-lo puxaria a completude para baixo por algo que já foi resolvido.
    const aplicaveis = avaliados.filter((a) => a.estado !== "DISPENSADO")
    const satisfeitos = aplicaveis.filter((a) => a.estado === "SATISFEITO")
    const pendentes = aplicaveis.filter((a) => a.estado !== "SATISFEITO")
    const bloq = pendentes.filter((a) => a.bloqueante)

    for (const b of bloq) bloqueadores.push({ requerenteId: r.id, nome: r.nome, rotulo: b.rotulo, natureza: b.natureza })

    pessoas.push({
      requerenteId: r.id,
      nome: r.nome,
      aplicaveis: aplicaveis.length,
      satisfeitos: satisfeitos.length,
      pendentes: pendentes.length,
      bloqueadores: bloq.length,
      dispensados: avaliados.length - aplicaveis.length,
      percentual: aplicaveis.length === 0 ? 100 : Math.round((satisfeitos.length / aplicaveis.length) * 1000) / 10,
      requisitos: avaliados,
    })
  }

  const t = pessoas.reduce(
    (acc, p) => ({
      aplicaveis: acc.aplicaveis + p.aplicaveis,
      satisfeitos: acc.satisfeitos + p.satisfeitos,
      pendentes: acc.pendentes + p.pendentes,
      bloqueadores: acc.bloqueadores + p.bloqueadores,
    }),
    { aplicaveis: 0, satisfeitos: 0, pendentes: 0, bloqueadores: 0 },
  )

  return {
    processoId,
    pais: paisCanonico?.countryLabel ?? null,
    modalidadeLegal: processo.enquadramentoLegal?.modalidadeLegal?.nome ?? null,
    pessoas,
    totais: {
      ...t,
      percentual: t.aplicaveis === 0 ? 100 : Math.round((t.satisfeitos / t.aplicaveis) * 1000) / 10,
    },
    pronto: t.bloqueadores === 0,
    bloqueadores,
  }
}
