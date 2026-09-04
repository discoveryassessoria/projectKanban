// lib/saude/verificacoes/acesso.ts
//
// USUÁRIOS, PERMISSÕES, AUDITORIA E TAREFAS.
//
// Quem pode o quê, e o que ficou sem dono.

import { prisma } from '@/lib/prisma'
import { registrar } from '../catalogo'
import type { Achado, ResultadoVerificacao } from '../tipos'
import { STATUS_TERMINAIS } from '@/lib/operacional/tarefa-canonica'

const ROTA_USUARIOS = '/administrator?screen=users'
const ROTA_PERFIS = '/administrator?screen=roles'
const ROTA_TAREFAS = '/operacao'

registrar({
  id: 'saude.usuarios.sem-perfil',
  codigo: 'USR-001',
  nome: 'Usuário com perfil de permissão',
  descricao: 'Usuário não-admin sem perfil não tem permissão nenhuma — ou tem por acidente.',
  dominio: 'USUARIOS',
  modulo: 'Usuários e Acessos',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 10_000,
  orientacao: 'Atribua um perfil ao usuário em Usuários e Acessos.',
  rotaCorrecao: ROTA_USUARIOS,
  responsavel: 'Acessos',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.usuario.findMany({
      where: { perfilId: null, tipo: { not: 'admin' } },
      select: { id: true, nome: true, email: true }, take: 50,
    })
    if (!linhas.length) return { achados: [], metricas: { semPerfil: 0 }, resumo: 'Todo usuário não-admin tem perfil.' }
    return {
      achados: [{
        chave: 'usuario-sem-perfil',
        severidade: 'ERRO',
        titulo: `${linhas.length} usuário(s) sem perfil`,
        descricao: `${linhas.length} usuário(s) não-admin estão sem perfil de permissão.`,
        explicacao: 'As permissões efetivas vêm do perfil (mais concessões custom). Sem perfil, o usuário fica sem base.',
        impacto: 'A pessoa não consegue operar — ou opera com um conjunto de permissões não intencional.',
        entidade: 'Usuario',
        registroId: String(linhas[0].id),
        registroNome: linhas[0].nome,
        quantidade: linhas.length,
        link: ROTA_USUARIOS,
        recomendacao: 'Atribua o perfil correto a cada usuário listado.',
        evidencia: { total: linhas.length, amostra: linhas.slice(0, 8).map((u) => ({ id: u.id, nome: u.nome })) },
      }],
      metricas: { semPerfil: linhas.length },
    }
  },
})

registrar({
  id: 'saude.permissoes.perfil-vazio',
  codigo: 'PERM-001',
  nome: 'Perfil com permissões declaradas',
  descricao: 'Perfil sem nenhuma permissão entrega usuário que não consegue trabalhar.',
  dominio: 'PERMISSOES',
  modulo: 'Perfis e Permissões',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 10_000,
  orientacao: 'Configure as permissões do perfil ou remova-o se não for usado.',
  rotaCorrecao: ROTA_PERFIS,
  responsavel: 'Acessos',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const perfis = await prisma.perfil.findMany({ select: { id: true, nome: true, permissoes: true } })
    const vazios = perfis.filter((p) => {
      const perms = p.permissoes as Record<string, boolean> | null
      return !perms || Object.values(perms).filter(Boolean).length === 0
    })
    if (!vazios.length) return { achados: [], metricas: { perfisVazios: 0, perfis: perfis.length }, resumo: `${perfis.length} perfil(is) com permissões.` }
    return {
      achados: [{
        chave: 'perfil-sem-permissao',
        severidade: 'ERRO',
        titulo: `${vazios.length} perfil(is) sem nenhuma permissão`,
        descricao: `Os perfis ${vazios.map((p) => p.nome).join(', ')} não concedem nada.`,
        explicacao: 'Perfil é o conjunto de permissões do usuário. Vazio, não habilita nenhuma ação.',
        impacto: 'Usuário com esse perfil vê o sistema mas não consegue operar.',
        entidade: 'Perfil',
        registroId: String(vazios[0].id),
        registroNome: vazios[0].nome,
        quantidade: vazios.length,
        link: ROTA_PERFIS,
        recomendacao: 'Configure as permissões ou remova o perfil.',
        evidencia: { perfis: vazios.map((p) => ({ id: p.id, nome: p.nome })) },
      }],
      metricas: { perfisVazios: vazios.length, perfis: perfis.length },
    }
  },
})

registrar({
  id: 'saude.usuarios.email-invalido',
  codigo: 'USR-002',
  nome: 'Usuário com e-mail válido',
  descricao: 'E-mail malformado impede login, convite e notificação.',
  dominio: 'USUARIOS',
  modulo: 'Usuários e Acessos',
  severidadePadrao: 'ALERTA',
  obrigatoria: false,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 10_000,
  orientacao: 'Corrija o e-mail do usuário.',
  rotaCorrecao: ROTA_USUARIOS,
  responsavel: 'Acessos',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const usuarios = await prisma.usuario.findMany({ select: { id: true, nome: true, email: true } })
    const invalidos = usuarios.filter((u) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email ?? ''))
    if (!invalidos.length) return { achados: [], metricas: { invalidos: 0 }, resumo: 'Todos os e-mails são válidos.' }
    return {
      achados: [{
        chave: 'usuario-email-invalido',
        severidade: 'ALERTA',
        titulo: `${invalidos.length} usuário(s) com e-mail inválido`,
        descricao: `${invalidos.length} usuário(s) têm e-mail em formato inválido.`,
        explicacao: 'O e-mail é a identidade de login e o canal de comunicação.',
        impacto: 'Login e notificações falham para estas pessoas.',
        entidade: 'Usuario',
        quantidade: invalidos.length,
        link: ROTA_USUARIOS,
        recomendacao: 'Corrija o endereço de cada usuário listado.',
        evidencia: { amostra: invalidos.slice(0, 5).map((u) => ({ id: u.id, nome: u.nome })) },
      }],
      metricas: { invalidos: invalidos.length },
    }
  },
})

registrar({
  id: 'saude.auditoria.registrando',
  codigo: 'AUD-001',
  nome: 'Trilha de auditoria ativa',
  descricao: 'O sistema precisa estar registrando ações — trilha parada é ponto cego.',
  dominio: 'AUDITORIA',
  modulo: 'Auditoria e Logs',
  severidadePadrao: 'ALERTA',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 10_000,
  orientacao: 'Verifique se as rotas administrativas continuam chamando registrarAuditoria.',
  rotaCorrecao: '/administrator?screen=audit',
  responsavel: 'Governança',
  ativo: true,
  executar: async ({ agora }): Promise<ResultadoVerificacao> => {
    const ultimo = await prisma.logAuditoria.findFirst({ orderBy: { criadoEm: 'desc' }, select: { criadoEm: true } })
    const total = await prisma.logAuditoria.count()
    if (!ultimo) {
      return {
        achados: [{
          chave: 'auditoria-vazia',
          severidade: 'ALERTA',
          titulo: 'Nenhum registro de auditoria',
          descricao: 'A trilha de auditoria está vazia.',
          explicacao: 'Toda ação administrativa relevante deveria deixar rastro.',
          impacto: 'Não há como reconstruir quem fez o quê.',
          entidade: 'LogAuditoria',
          quantidade: 0,
          recomendacao: 'Confirme que as rotas administrativas registram auditoria.',
          evidencia: { total: 0 },
        }],
        metricas: { total: 0 },
      }
    }
    const dias = Math.floor((agora.getTime() - ultimo.criadoEm.getTime()) / 86_400_000)
    if (dias >= 7) {
      return {
        achados: [{
          chave: 'auditoria-parada',
          severidade: 'ALERTA',
          titulo: `Auditoria sem registro há ${dias} dias`,
          descricao: `O último registro de auditoria é de ${dias} dias atrás.`,
          explicacao: 'Silêncio prolongado costuma indicar que a chamada de auditoria deixou de acontecer.',
          impacto: 'Ações administrativas recentes podem não ter rastro.',
          entidade: 'LogAuditoria',
          quantidade: total,
          recomendacao: 'Confirme se houve operação no período; se houve, a trilha parou.',
          evidencia: { diasSemRegistro: dias, total },
        }],
        metricas: { total, diasSemRegistro: dias },
      }
    }
    return { achados: [], metricas: { total, diasSemRegistro: dias }, resumo: `${total} registros; último há ${dias} dia(s).` }
  },
})

registrar({
  id: 'saude.tarefas.sem-responsavel',
  codigo: 'TAR-001',
  nome: 'Tarefa aberta com responsável',
  descricao: 'Tarefa aberta sem responsável não é de ninguém — e não sai do lugar.',
  dominio: 'TAREFAS',
  modulo: 'Tarefas e Projetos',
  severidadePadrao: 'ALERTA',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 15_000,
  orientacao: 'Atribua responsável às tarefas abertas.',
  rotaCorrecao: ROTA_TAREFAS,
  responsavel: 'Operação',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    // `concluida` nunca vira `true` para CANCELADA/SUPERSEDIDA — sem excluir o
    // status terminal, tarefa já encerrada contava como "aberta sem responsável".
    const n = await prisma.tarefa.count({ where: { concluida: false, responsavelId: null, statusTarefa: { notIn: STATUS_TERMINAIS } } })
    if (!n) return { achados: [], metricas: { semResponsavel: 0 }, resumo: 'Toda tarefa aberta tem responsável.' }
    return {
      achados: [{
        chave: 'tarefa-sem-responsavel',
        severidade: 'ALERTA',
        titulo: `${n} tarefa(s) aberta(s) sem responsável`,
        descricao: `${n} tarefa(s) não concluídas estão sem responsável atribuído.`,
        explicacao: 'Tarefa sem dono não entra na fila de trabalho de ninguém.',
        impacto: 'O trabalho fica parado sem que ninguém perceba.',
        entidade: 'Tarefa',
        quantidade: n,
        link: ROTA_TAREFAS,
        recomendacao: 'Atribua responsável ou conclua as tarefas que não são mais necessárias.',
        evidencia: { semResponsavel: n },
      }],
      metricas: { semResponsavel: n },
    }
  },
})

registrar({
  id: 'saude.tarefas.vencidas',
  codigo: 'TAR-002',
  nome: 'Tarefas dentro do prazo',
  descricao: 'Tarefa vencida e aberta é SLA violado na prática.',
  dominio: 'SLA',
  modulo: 'Tarefas e Projetos',
  severidadePadrao: 'ALERTA',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 15_000,
  orientacao: 'Repactue o prazo ou conclua as tarefas vencidas.',
  rotaCorrecao: ROTA_TAREFAS,
  responsavel: 'Operação',
  ativo: true,
  executar: async ({ agora }): Promise<ResultadoVerificacao> => {
    const vencidas = await prisma.tarefa.count({ where: { concluida: false, dataPrazo: { lt: agora }, statusTarefa: { notIn: STATUS_TERMINAIS } } })
    if (!vencidas) return { achados: [], metricas: { vencidas: 0 }, resumo: 'Nenhuma tarefa aberta vencida.' }
    const severidade = vencidas >= 50 ? 'ERRO' : 'ALERTA'
    return {
      achados: [{
        chave: 'tarefas-vencidas',
        severidade,
        titulo: `${vencidas} tarefa(s) vencida(s)`,
        descricao: `${vencidas} tarefa(s) abertas passaram do prazo.`,
        explicacao: 'Prazo vencido com tarefa aberta indica capacidade insuficiente ou prazo irreal.',
        impacto: 'Processos atrasam e o SLA prometido ao cliente deixa de ser cumprido.',
        entidade: 'Tarefa',
        quantidade: vencidas,
        link: ROTA_TAREFAS,
        recomendacao: 'Repactue prazos ou redistribua a carga.',
        evidencia: { vencidas },
      }],
      metricas: { vencidas },
    }
  },
})
