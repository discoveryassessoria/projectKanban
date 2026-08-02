// lib/saude/verificacoes/filas.ts
//
// FILAS E EVENTOS — o motor de efeitos do Discovery.
//
// Aqui mora a correção do diagnóstico antigo: "49 eventos aguardando despacho"
// era exibido como OK porque só se olhava a existência da fila. Fila não se
// julga por número absoluto: julga-se por IDADE do item mais antigo, por
// TENDÊNCIA (está crescendo?) e por ATIVIDADE do dispatcher. Uma fila pequena e
// recente é saudável; um único evento preso há horas é erro; dispatcher parado
// com fila é crítico.

import { prisma } from '@/lib/prisma'
import { TIPOS_DRENADOS } from '@/src/services/outbox-dispatcher'
import { registrar } from '../catalogo'
import type { Achado, ResultadoVerificacao } from '../tipos'

const ROTA_MOTOR = '/administrator?screen=execmotor'
const ROTA_RUNTIME = '/administrator?screen=runtimediag'

// Limites — pequenos o bastante para pegar problema cedo, largos o bastante
// para não gritar por operação normal.
export const LIMITES_FILA = {
  /** quantidade pendente */
  quantidadeAtencao: 25,
  quantidadeDegradado: 100,
  quantidadeCritico: 500,
  /** idade do item mais antigo, em minutos */
  idadeAtencaoMin: 15,
  idadeErroMin: 60,
  idadeCriticoMin: 240,
  /** silêncio do dispatcher com fila pendente, em minutos */
  silencioDispatcherMin: 30,
  /** tentativas antes de considerar item envenenado */
  tentativasMax: 5,
}

const minutosDesde = (d: Date, agora: Date) => Math.floor((agora.getTime() - d.getTime()) / 60000)
const humano = (min: number) => (min < 60 ? `${min} min` : min < 1440 ? `${Math.floor(min / 60)} h` : `${Math.floor(min / 1440)} d`)

registrar({
  id: 'saude.filas.outbox-pendente',
  codigo: 'FILA-001',
  nome: 'Fila de eventos (outbox) sob controle',
  descricao: 'Avalia a fila de efeitos do motor por quantidade, idade do evento mais antigo e atividade do dispatcher — não apenas pelo total.',
  dominio: 'FILAS',
  modulo: 'Motor / Outbox',
  severidadePadrao: 'ALERTA',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 15_000,
  orientacao: 'Abra o Executor do Motor e despache a fila. Se o dispatcher estiver parado, reative-o; se houver evento com erro, trate a causa antes de reprocessar.',
  rotaCorrecao: ROTA_MOTOR,
  correcaoAutomatica: 'reprocessar-outbox',
  responsavel: 'Motor',
  ativo: true,
  executar: async ({ agora }): Promise<ResultadoVerificacao> => {
    const achados: Achado[] = []

    const [pendentes, maisAntigo, ultimoProcessado, comErro, envenenados] = await Promise.all([
      prisma.domainOutbox.count({ where: { status: 'PENDENTE' } }),
      prisma.domainOutbox.findFirst({ where: { status: 'PENDENTE' }, orderBy: { criadoEm: 'asc' }, select: { id: true, criadoEm: true, tipo: true } }),
      prisma.domainOutbox.findFirst({ where: { status: 'ENVIADO' }, orderBy: { processadoEm: 'desc' }, select: { processadoEm: true } }),
      prisma.domainOutbox.count({ where: { status: 'ERRO' } }),
      prisma.domainOutbox.count({ where: { status: 'PENDENTE', tentativas: { gte: LIMITES_FILA.tentativasMax } } }),
    ])

    const idadeMin = maisAntigo ? minutosDesde(maisAntigo.criadoEm, agora) : 0
    const silencioMin = ultimoProcessado?.processadoEm ? minutosDesde(ultimoProcessado.processadoEm, agora) : null

    // ── idade do evento mais antigo: o sinal mais honesto ────────────────────
    if (maisAntigo && idadeMin >= LIMITES_FILA.idadeAtencaoMin) {
      const severidade = idadeMin >= LIMITES_FILA.idadeCriticoMin ? 'CRITICO'
        : idadeMin >= LIMITES_FILA.idadeErroMin ? 'ERRO' : 'ALERTA'
      achados.push({
        chave: 'evento-antigo-na-fila',
        severidade,
        titulo: `Evento parado na fila há ${humano(idadeMin)}`,
        descricao: `O evento mais antigo aguardando despacho entrou há ${humano(idadeMin)} (outbox #${maisAntigo.id}, tipo ${maisAntigo.tipo}). Há ${pendentes} evento(s) pendente(s).`,
        explicacao: 'O dispatcher consome a DomainOutbox em ordem. Evento antigo significa que a fila não está sendo drenada — por dispatcher parado, erro repetido ou volume acima da capacidade.',
        impacto: 'Efeitos do motor (tarefas, lançamentos financeiros, eventos de fase) não chegam ao processo. A operação enxerga o processo como se nada tivesse acontecido.',
        entidade: 'DomainOutbox',
        registroId: String(maisAntigo.id),
        quantidade: pendentes,
        link: ROTA_MOTOR,
        recomendacao: 'Despache a fila no Executor do Motor e investigue por que o evento não foi consumido.',
        correcaoAutomatica: 'reprocessar-outbox',
        evidencia: { pendentes, idadeMinutos: idadeMin, outboxId: maisAntigo.id, tipo: maisAntigo.tipo },
      })
    }

    // ── volume ───────────────────────────────────────────────────────────────
    if (pendentes >= LIMITES_FILA.quantidadeAtencao) {
      const severidade = pendentes >= LIMITES_FILA.quantidadeCritico ? 'CRITICO'
        : pendentes >= LIMITES_FILA.quantidadeDegradado ? 'ERRO' : 'ALERTA'
      achados.push({
        chave: 'fila-acumulada',
        severidade,
        titulo: `${pendentes} eventos aguardando despacho`,
        descricao: `A fila acumulou ${pendentes} evento(s) pendente(s) — acima do limite de ${LIMITES_FILA.quantidadeAtencao}.`,
        explicacao: 'Acúmulo indica que a produção de eventos está maior que o consumo do dispatcher.',
        impacto: 'Quanto maior a fila, maior a defasagem entre o que a operação fez e o que o sistema efetivou.',
        entidade: 'DomainOutbox',
        quantidade: pendentes,
        link: ROTA_MOTOR,
        recomendacao: 'Despache a fila e verifique a frequência do dispatcher.',
        correcaoAutomatica: 'reprocessar-outbox',
        evidencia: { pendentes, limiteAtencao: LIMITES_FILA.quantidadeAtencao },
      })
    }

    // ── dispatcher parado ────────────────────────────────────────────────────
    if (pendentes > 0 && (silencioMin === null || silencioMin >= LIMITES_FILA.silencioDispatcherMin)) {
      achados.push({
        chave: 'dispatcher-sem-atividade',
        severidade: 'CRITICO',
        titulo: silencioMin === null ? 'Dispatcher nunca processou eventos' : `Dispatcher sem atividade há ${humano(silencioMin)}`,
        descricao: `Existem ${pendentes} evento(s) pendente(s) e ${silencioMin === null ? 'nenhum evento jamais foi processado' : `o último despacho foi há ${humano(silencioMin)}`}.`,
        explicacao: 'Fila com itens + dispatcher silencioso = consumo interrompido. Não é volume: é parada.',
        impacto: 'Nenhum efeito do motor está sendo aplicado. Processos param de avançar e lançamentos deixam de ser gerados.',
        entidade: 'DomainOutbox',
        quantidade: pendentes,
        link: ROTA_MOTOR,
        recomendacao: 'Reative o dispatcher no Executor do Motor e acompanhe o consumo da fila.',
        correcaoAutomatica: 'reprocessar-outbox',
        evidencia: { pendentes, silencioMinutos: silencioMin },
      })
    }

    // ── itens em erro e envenenados ──────────────────────────────────────────
    if (comErro > 0) {
      achados.push({
        chave: 'eventos-com-erro',
        severidade: 'ERRO',
        titulo: `${comErro} evento(s) em erro`,
        descricao: `${comErro} evento(s) da outbox terminaram em erro e não produziram efeito.`,
        explicacao: 'Evento em ERRO já esgotou o caminho normal: o efeito que ele carregava simplesmente não aconteceu.',
        impacto: 'Efeito perdido silenciosamente — tarefa não criada, lançamento não gerado, fase não avançada.',
        entidade: 'DomainOutbox',
        quantidade: comErro,
        link: ROTA_MOTOR,
        recomendacao: 'Abra os eventos em erro, corrija a causa e reprocesse.',
        evidencia: { comErro },
      })
    }
    if (envenenados > 0) {
      achados.push({
        chave: 'eventos-envenenados',
        severidade: 'ERRO',
        titulo: `${envenenados} evento(s) com tentativas esgotadas`,
        descricao: `${envenenados} evento(s) pendente(s) já foram tentados ${LIMITES_FILA.tentativasMax}× ou mais.`,
        explicacao: 'Item que falha repetidamente trava a vazão e tende a nunca ser consumido (dead letter de fato).',
        impacto: 'A fila não drena e os eventos seguintes ficam atrás de um item que não passa.',
        entidade: 'DomainOutbox',
        quantidade: envenenados,
        link: ROTA_MOTOR,
        recomendacao: 'Trate a causa do item e reprocesse, ou marque-o como descartado com justificativa.',
        evidencia: { envenenados, tentativasMax: LIMITES_FILA.tentativasMax },
      })
    }

    return {
      achados,
      metricas: {
        pendentes,
        comErro,
        envenenados,
        idadeMaisAntigoMin: idadeMin,
        silencioDispatcherMin: silencioMin,
      },
      resumo: pendentes === 0
        ? 'Fila vazia e dispatcher ativo.'
        : `${pendentes} pendente(s), o mais antigo há ${humano(idadeMin)} — dentro dos limites.`,
    }
  },
})

registrar({
  id: 'saude.filas.workflow-evento-sem-processo',
  codigo: 'FILA-002',
  nome: 'Eventos de workflow com processo válido',
  descricao: 'Detecta evento de workflow apontando para processo inexistente — referência órfã que quebra a Timeline.',
  dominio: 'EVENTOS',
  modulo: 'Motor / WorkflowEvento',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 20_000,
  orientacao: 'Evento órfão indica processo removido sem limpeza da trilha. Verifique a origem antes de qualquer remoção.',
  rotaCorrecao: ROTA_RUNTIME,
  responsavel: 'Motor',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const orfaos = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM "WorkflowEvento" e
        WHERE NOT EXISTS (SELECT 1 FROM "Processo" p WHERE p.id = e."processoId")`,
    )
    const n = orfaos?.[0]?.n ?? 0
    if (!n) return { achados: [], metricas: { orfaos: 0 }, resumo: 'Todo evento de workflow aponta para um processo existente.' }
    return {
      achados: [{
        chave: 'workflow-evento-orfao',
        severidade: 'ERRO',
        titulo: `${n} evento(s) de workflow sem processo`,
        descricao: `${n} registro(s) de WorkflowEvento referenciam um processo que não existe mais.`,
        explicacao: 'A trilha cronológica do processo é montada a partir destes eventos; órfãos indicam remoção incompleta.',
        impacto: 'Timeline e Histórico podem exibir movimentação de processo inexistente, e consultas por processo ficam inconsistentes.',
        entidade: 'WorkflowEvento',
        quantidade: n,
        link: ROTA_RUNTIME,
        recomendacao: 'Investigue a origem dos eventos antes de remover — pode indicar exclusão de processo sem limpeza da trilha.',
        evidencia: { orfaos: n },
      }],
      metricas: { orfaos: n },
    }
  },
})


registrar({
  id: 'saude.filas.tipo-sem-consumidor',
  codigo: 'FILA-003',
  nome: 'Todo evento pendente tem consumidor registrado',
  descricao: 'Detecta evento EMITIDO cujo tipo o dispatcher não drena — a fila cresce em silêncio, sem nada em estado de erro.',
  dominio: 'FILAS',
  modulo: 'Motor / Outbox',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.1',
  timeoutMs: 15_000,
  orientacao: 'Registre o tipo em TIPOS_DRENADOS do dispatcher — com efeito, se houver, ou em TIPOS_SEM_EFEITO para arquivar.',
  rotaCorrecao: '/administrator?screen=execmotor',
  responsavel: 'Motor',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const pendentesPorTipo = await prisma.$queryRawUnsafe<{ tipo: string; n: number }[]>(
      `SELECT tipo, COUNT(*)::int AS n FROM "DomainOutbox" WHERE status = 'PENDENTE' GROUP BY tipo`,
    )
    const drenados = new Set<string>(TIPOS_DRENADOS)
    const orfaos = pendentesPorTipo.filter((t) => !drenados.has(t.tipo))
    if (!orfaos.length) {
      return {
        achados: [],
        metricas: { tiposDrenados: drenados.size, tiposPendentes: pendentesPorTipo.length },
        resumo: 'Todo evento pendente tem consumidor registrado.',
      }
    }
    return {
      achados: orfaos.map((t): Achado => ({
        chave: `tipo-sem-consumidor:${t.tipo}`,
        severidade: 'CRITICO',
        titulo: `Evento "${t.tipo}" não é consumido por ninguém`,
        descricao: `${t.n} evento(s) do tipo "${t.tipo}" estão pendentes, mas o dispatcher não drena este tipo.`,
        explicacao: 'O dispatcher só lê os tipos declarados. Tipo emitido e não declarado fica PENDENTE para sempre — sem erro, sem alarme, apenas acumulando.',
        impacto: 'A fila cresce indefinidamente e qualquer efeito que dependa deste evento nunca acontece.',
        entidade: 'DomainOutbox',
        quantidade: t.n,
        link: '/administrator?screen=execmotor',
        recomendacao: `Declare "${t.tipo}" em TIPOS_DRENADOS — com consumidor, se houver efeito, ou em TIPOS_SEM_EFEITO para arquivar.`,
        evidencia: { tipo: t.tipo, pendentes: t.n, tiposDrenados: [...drenados] },
      })),
      metricas: { tiposOrfaos: orfaos.length },
    }
  },
})
