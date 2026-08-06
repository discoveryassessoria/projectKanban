// lib/saude/verificacoes/plataforma.ts
//
// PLATAFORMA — rotas, APIs, interface, arquivos, integrações, comunicações,
// relatórios, import/export, configurações, legado, performance, segurança,
// observabilidade, backup, recuperação e deploy.
//
// Estas verificações olham o SISTEMA, não os dados. Várias inspecionam o próprio
// código-fonte e o ambiente — e é justamente por isso que elas conseguem provar
// coisas que consulta em banco nenhuma prova (rota morta, secret ausente,
// componente legado ainda referenciado).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/prisma'
import { registrar } from '../catalogo'
import type { Achado, ResultadoVerificacao } from '../tipos'

const RAIZ = process.cwd()
const existe = (p: string) => existsSync(join(RAIZ, p))
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

/** Lista recursiva de arquivos (usada para varrer rotas e componentes). */
function varrer(dir: string, filtro: (p: string) => boolean, limite = 4000): string[] {
  const raiz = join(RAIZ, dir)
  if (!existsSync(raiz)) return []
  const achados: string[] = []
  const pilha = [raiz]
  while (pilha.length && achados.length < limite) {
    const atual = pilha.pop()!
    for (const nome of readdirSync(atual)) {
      if (nome === 'node_modules' || nome === '.next' || nome.startsWith('.')) continue
      const caminho = join(atual, nome)
      const st = statSync(caminho)
      if (st.isDirectory()) pilha.push(caminho)
      else if (filtro(caminho)) achados.push(caminho.replace(RAIZ + '/', ''))
    }
  }
  return achados
}

// ── ROTAS E INTERFACE ────────────────────────────────────────────────────────

registrar({
  id: 'saude.rotas.menu-sem-tela',
  codigo: 'ROT-001',
  nome: 'Todo item de menu abre uma tela real',
  descricao: 'Item de menu apontando para tela não registrada resulta em clique que não leva a lugar nenhum.',
  dominio: 'ROTAS',
  modulo: 'Gerenciamento / Navegação',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 10_000,
  orientacao: 'Registre a tela no mapa TELAS do Gerenciamento ou remova/desative o item de menu.',
  rotaCorrecao: '/administrator',
  responsavel: 'Plataforma',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const nav = ler('src/components/gerenciamentoComponents/managementNavigation.tsx')
    const page = ler('src/app/administrator/page.tsx')
    // itens ATIVOS declarados com o helper a(order, key, ...)
    const itens = [...nav.matchAll(/\ba\(\s*\d+\s*,\s*"([\w-]+)"/g)].map((m) => m[1])
    const bloco = page.split('const TELAS: Record<string, React.ComponentType>')[1]?.split('\n}')[0] ?? ''
    const telas = new Set([...bloco.matchAll(/^\s{2}"?([a-zA-Z_][\w-]*)"?:/gm)].map((m) => m[1]))
    const alias = page.match(/ALIAS_TELAS: Record<string, string> = \{([^}]*)\}/)?.[1] ?? ''
    const aliases = new Set([...alias.matchAll(/"?([\w-]+)"?\s*:/g)].map((m) => m[1]))
    const quebrados = [...new Set(itens)].filter((k) => !telas.has(k) && !aliases.has(k))
    if (!quebrados.length) {
      return { achados: [], metricas: { itens: itens.length, telas: telas.size }, resumo: `${itens.length} item(ns) de menu, todos com tela.` }
    }
    return {
      achados: [{
        chave: 'menu-sem-tela',
        severidade: 'ERRO',
        titulo: `${quebrados.length} item(ns) de menu sem tela`,
        descricao: `Os itens ${quebrados.join(', ')} não têm componente registrado nem alias.`,
        explicacao: 'O shell do Gerenciamento resolve a tela pelo mapa TELAS. Sem registro, o clique abre vazio.',
        impacto: 'O operador clica e não acontece nada — funcionalidade inacessível.',
        entidade: 'managementNavigation',
        quantidade: quebrados.length,
        link: '/administrator',
        recomendacao: 'Registre a tela ou remova o item do menu.',
        evidencia: { itens: quebrados },
      }],
      metricas: { quebrados: quebrados.length },
    }
  },
})

registrar({
  id: 'saude.interface.rota-app-existe',
  codigo: 'INT-001',
  nome: 'Links da navegação principal existem',
  descricao: 'Verifica se cada rota da sidebar tem página correspondente no App Router.',
  dominio: 'INTERFACE',
  modulo: 'Navegação principal',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 10_000,
  orientacao: 'Crie a página ou remova o item da sidebar — link morto é botão morto.',
  responsavel: 'Plataforma',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const sidebar = ler('src/components/bitrix-sidebar.tsx')
    const rotas = [...sidebar.matchAll(/url:\s*"(\/[\w/-]*)"/g)].map((m) => m[1])
    const quebradas = rotas.filter((r) => {
      const base = r.replace(/^\//, '')
      return !(existe(`src/app/${base}/page.tsx`) || (base === '' && existe('src/app/page.tsx')))
    })
    if (!quebradas.length) return { achados: [], metricas: { rotas: rotas.length }, resumo: `${rotas.length} rota(s) da sidebar existem.` }
    return {
      achados: [{
        chave: 'sidebar-rota-inexistente',
        severidade: 'ERRO',
        titulo: `${quebradas.length} link(s) da sidebar sem página`,
        descricao: `As rotas ${quebradas.join(', ')} não têm página no App Router.`,
        explicacao: 'A sidebar é a navegação principal; link sem página devolve 404.',
        impacto: 'Menu principal com item que não abre.',
        entidade: 'bitrix-sidebar',
        quantidade: quebradas.length,
        recomendacao: 'Crie a página ou remova o item.',
        evidencia: { rotas: quebradas },
      }],
      metricas: { quebradas: quebradas.length },
    }
  },
})

registrar({
  id: 'saude.apis.rotas-registradas',
  codigo: 'API-001',
  nome: 'APIs internas presentes e protegidas',
  descricao: 'Conta as rotas de API e checa que as administrativas exigem permissão.',
  dominio: 'APIS',
  modulo: 'APIs internas',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 20_000,
  orientacao: 'Toda rota sob /api/gerenciamento precisa chamar verificarPermissao antes de qualquer leitura ou escrita.',
  responsavel: 'Plataforma',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const rotas = varrer('src/app/api', (p) => p.endsWith('route.ts'))
    const gerenciamento = rotas.filter((r) => r.includes('/api/gerenciamento/'))
    const desprotegidas = gerenciamento.filter((r) => {
      const src = ler(r)
      // `exigirPermissao` é a variante que lança em vez de retornar Response —
      // ambas autorizam. Reconhecer só uma delas gerava falso positivo.
      return !/verificarPermissao|exigirPermissao|extrairUsuarioComPermissoes/.test(src)
    })
    if (!desprotegidas.length) {
      return { achados: [], metricas: { rotas: rotas.length, gerenciamento: gerenciamento.length }, resumo: `${rotas.length} rotas de API; todas as administrativas exigem permissão.` }
    }
    return {
      achados: [{
        chave: 'api-gerenciamento-sem-permissao',
        severidade: 'CRITICO',
        titulo: `${desprotegidas.length} rota(s) administrativa(s) sem verificação de permissão`,
        descricao: `As rotas ${desprotegidas.slice(0, 5).join(', ')}${desprotegidas.length > 5 ? '…' : ''} não chamam verificarPermissao.`,
        explicacao: 'Rotas sob /api/gerenciamento manipulam cadastro mestre e configuração — exigem autorização explícita.',
        impacto: 'Dados administrativos podem ser lidos ou alterados sem autorização.',
        entidade: 'API',
        quantidade: desprotegidas.length,
        recomendacao: 'Adicione verificarPermissao no início de cada handler.',
        evidencia: { rotas: desprotegidas.slice(0, 20) },
      }],
      metricas: { rotas: rotas.length, desprotegidas: desprotegidas.length },
    }
  },
})

// ── ARQUIVOS ─────────────────────────────────────────────────────────────────

registrar({
  id: 'saude.arquivos.storage-configurado',
  codigo: 'ARQ-001',
  nome: 'Armazenamento de arquivos configurado',
  descricao: 'Sem credencial de storage, upload e download de documento não funcionam.',
  dominio: 'ARQUIVOS',
  modulo: 'Armazenamento',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 5_000,
  orientacao: 'Configure as variáveis do R2 no ambiente. Sem elas o Sistema Documental não recebe arquivo.',
  responsavel: 'Infraestrutura',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const obrigatorias = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']
    const ausentes = obrigatorias.filter((k) => !process.env[k])
    if (!ausentes.length) return { achados: [], metricas: { variaveis: obrigatorias.length }, resumo: 'Storage configurado.' }
    return {
      achados: [{
        chave: 'storage-sem-credencial',
        severidade: 'CRITICO',
        titulo: `${ausentes.length} variável(is) de storage ausente(s)`,
        descricao: `Faltam ${ausentes.join(', ')} no ambiente.`,
        explicacao: 'O Sistema Documental guarda os arquivos no R2; sem credencial não há upload nem download.',
        impacto: 'Nenhum documento pode ser anexado ou baixado.',
        entidade: 'Ambiente',
        quantidade: ausentes.length,
        recomendacao: 'Configure as variáveis no ambiente de execução (os VALORES nunca aparecem aqui).',
        evidencia: { ausentes },
      }],
      metricas: { ausentes: ausentes.length },
    }
  },
})

registrar({
  id: 'saude.arquivos.documento-url-invalida',
  codigo: 'ARQ-002',
  nome: 'Arquivo de documento com URL utilizável',
  descricao: 'URL vazia ou malformada é arquivo inacessível na prática.',
  dominio: 'ARQUIVOS',
  modulo: 'Sistema Documental',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 20_000,
  orientacao: 'Reenvie o arquivo do documento afetado.',
  responsavel: 'Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const r = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM "Documento"
        WHERE "arquivo_url" IS NOT NULL AND "arquivo_url" <> '' AND "arquivo_url" NOT LIKE 'http%'`,
    )
    const n = r?.[0]?.n ?? 0
    if (!n) return { achados: [], metricas: { invalidas: 0 }, resumo: 'Toda URL de arquivo é utilizável.' }
    return {
      achados: [{
        chave: 'documento-url-invalida',
        severidade: 'ERRO',
        titulo: `${n} documento(s) com URL de arquivo inválida`,
        descricao: `${n} documento(s) têm URL que não começa com http.`,
        explicacao: 'A URL é o caminho para o arquivo no storage; formato inválido não resolve.',
        impacto: 'O documento existe no cadastro mas não abre.',
        entidade: 'Documento',
        quantidade: n,
        recomendacao: 'Reenvie o arquivo para regenerar a URL.',
        evidencia: { invalidas: n },
      }],
      metricas: { invalidas: n },
    }
  },
})

// ── SEGURANÇA E CONFIGURAÇÃO ─────────────────────────────────────────────────

registrar({
  id: 'saude.seguranca.secrets-obrigatorios',
  codigo: 'SEC-001',
  nome: 'Segredos obrigatórios presentes',
  descricao: 'Confere a PRESENÇA (nunca o valor) dos segredos sem os quais autenticação e integrações não funcionam.',
  dominio: 'SEGURANCA',
  modulo: 'Segurança',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 5_000,
  orientacao: 'Configure os segredos no ambiente. Esta verificação nunca exibe valores.',
  responsavel: 'Segurança',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const obrigatorios = ['JWT_SECRET', 'APP_JWT_SECRET', 'PRISMA_DATABASE_URL']
    const ausentes = obrigatorios.filter((k) => !process.env[k])
    const fracos = obrigatorios.filter((k) => (process.env[k]?.length ?? 0) > 0 && (process.env[k]!.length < 24) && k.includes('SECRET'))
    const achados: Achado[] = []
    if (ausentes.length) {
      achados.push({
        chave: 'secrets-ausentes',
        severidade: 'CRITICO',
        titulo: `${ausentes.length} segredo(s) obrigatório(s) ausente(s)`,
        descricao: `Faltam ${ausentes.join(', ')} no ambiente.`,
        explicacao: 'Sem estes segredos a autenticação e o acesso ao banco não funcionam.',
        impacto: 'Login quebrado e/ou aplicação sem banco.',
        entidade: 'Ambiente',
        quantidade: ausentes.length,
        recomendacao: 'Configure no ambiente de execução (valores nunca são exibidos aqui).',
        evidencia: { ausentes },
      })
    }
    if (fracos.length) {
      achados.push({
        chave: 'secrets-curtos',
        severidade: 'ALERTA',
        titulo: `${fracos.length} segredo(s) curto(s)`,
        descricao: `${fracos.join(', ')} têm menos de 24 caracteres.`,
        explicacao: 'Segredo curto reduz a força da assinatura do token.',
        impacto: 'Maior risco de forja de token.',
        entidade: 'Ambiente',
        quantidade: fracos.length,
        recomendacao: 'Gere segredos longos e aleatórios.',
        evidencia: { chaves: fracos },
      })
    }
    return { achados, metricas: { obrigatorios: obrigatorios.length, ausentes: ausentes.length }, resumo: 'Segredos obrigatórios presentes.' }
  },
})

registrar({
  id: 'saude.seguranca.middleware-ativo',
  codigo: 'SEC-002',
  nome: 'Middleware de autenticação ativo',
  descricao: 'Sem middleware, rotas privadas ficam abertas.',
  dominio: 'SEGURANCA',
  modulo: 'Segurança',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 5_000,
  orientacao: 'O middleware.ts precisa existir e declarar matcher das rotas privadas.',
  responsavel: 'Segurança',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    if (!existe('middleware.ts')) {
      return {
        achados: [{
          chave: 'middleware-ausente',
          severidade: 'CRITICO',
          titulo: 'Middleware de autenticação ausente',
          descricao: 'O arquivo middleware.ts não existe.',
          explicacao: 'É o middleware que barra acesso não autenticado às rotas privadas.',
          impacto: 'Rotas privadas podem ficar acessíveis sem login.',
          entidade: 'middleware',
          quantidade: 1,
          recomendacao: 'Restaure o middleware com o matcher das rotas privadas.',
          evidencia: { arquivo: 'middleware.ts' },
        }],
        metricas: { presente: 0 },
      }
    }
    const src = ler('middleware.ts')
    const temMatcher = /export const config[\s\S]{0,200}matcher/.test(src)
    if (!temMatcher) {
      return {
        achados: [{
          chave: 'middleware-sem-matcher',
          severidade: 'ERRO',
          titulo: 'Middleware sem matcher declarado',
          descricao: 'O middleware existe mas não declara em quais rotas atua.',
          explicacao: 'Sem matcher, a proteção pode não cobrir as rotas pretendidas.',
          impacto: 'Cobertura de autenticação incerta.',
          entidade: 'middleware',
          quantidade: 1,
          recomendacao: 'Declare o matcher das rotas privadas.',
          evidencia: { arquivo: 'middleware.ts' },
        }],
        metricas: { presente: 1 },
      }
    }
    return { achados: [], metricas: { presente: 1 }, resumo: 'Middleware presente com matcher declarado.' }
  },
})

registrar({
  id: 'saude.configuracoes.ambiente-completo',
  codigo: 'CFG-001',
  nome: 'Configuração de ambiente completa',
  descricao: 'Variáveis usadas pela operação (cron, storage público) precisam existir.',
  dominio: 'CONFIGURACOES',
  modulo: 'Configurações gerais',
  severidadePadrao: 'ALERTA',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 5_000,
  orientacao: 'Configure as variáveis opcionais conforme os recursos em uso.',
  responsavel: 'Infraestrutura',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const desejaveis = ['CRON_SECRET', 'R2_PUBLIC_URL']
    const ausentes = desejaveis.filter((k) => !process.env[k])
    if (!ausentes.length) return { achados: [], metricas: { ausentes: 0 }, resumo: 'Configuração de ambiente completa.' }
    return {
      achados: [{
        chave: 'ambiente-incompleto',
        severidade: 'ALERTA',
        titulo: `${ausentes.length} variável(is) de ambiente ausente(s)`,
        descricao: `Não estão definidas: ${ausentes.join(', ')}.`,
        explicacao: 'CRON_SECRET protege os jobs agendados; R2_PUBLIC_URL monta o link público do arquivo.',
        impacto: 'Jobs podem ficar desprotegidos e links de arquivo podem sair incompletos.',
        entidade: 'Ambiente',
        quantidade: ausentes.length,
        recomendacao: 'Defina as variáveis no ambiente.',
        evidencia: { ausentes },
      }],
      metricas: { ausentes: ausentes.length },
    }
  },
})

// ── LEGADO ───────────────────────────────────────────────────────────────────

registrar({
  id: 'saude.legado.cadastros-eliminados',
  codigo: 'LEG-001',
  nome: 'Cadastros eliminados não voltaram',
  descricao: 'Marcos, Tipos de Protocolo, Categorias Financeiras, Plano de Contas e Centros de Custo foram eliminados por decisão de arquitetura.',
  dominio: 'LEGADO',
  modulo: 'Arquitetura',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 15_000,
  orientacao: 'Estrutura eliminada não deve ser recriada. Se voltou, houve regressão de arquitetura.',
  responsavel: 'Arquitetura',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const eliminadas = ['MarcoProcesso', 'TipoProtocoloCadastro', 'CategoriaFinanceira', 'PlanoConta', 'CentroCusto']
    const r = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1)`,
      eliminadas,
    )
    if (!r.length) return { achados: [], metricas: { ressuscitadas: 0 }, resumo: 'Nenhuma estrutura eliminada voltou.' }
    return {
      achados: [{
        chave: 'estrutura-eliminada-presente',
        severidade: 'ERRO',
        titulo: `${r.length} estrutura(s) eliminada(s) presente(s) no banco`,
        descricao: `As tabelas ${r.map((x) => x.table_name).join(', ')} deveriam ter sido removidas.`,
        explicacao: 'Estes cadastros foram eliminados por decisão de arquitetura; a presença indica regressão ou migration não aplicada.',
        impacto: 'Risco de o sistema voltar a gravar em estrutura abandonada, criando fonte de verdade paralela.',
        entidade: 'Banco',
        quantidade: r.length,
        recomendacao: 'Confirme se as migrations de remoção foram aplicadas neste ambiente.',
        evidencia: { tabelas: r.map((x) => x.table_name) },
      }],
      metricas: { ressuscitadas: r.length },
    }
  },
})

// ── PERFORMANCE E OBSERVABILIDADE ────────────────────────────────────────────

registrar({
  id: 'saude.performance.tabelas-grandes',
  codigo: 'PERF-001',
  nome: 'Crescimento de tabelas sob controle',
  descricao: 'Mede o tamanho das maiores tabelas para detectar crescimento anormal.',
  dominio: 'PERFORMANCE',
  modulo: 'Banco de dados',
  severidadePadrao: 'INFORMATIVO',
  obrigatoria: false,
  modos: ['PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 20_000,
  orientacao: 'Tabela muito grande pede índice, particionamento ou política de retenção.',
  responsavel: 'Infraestrutura',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<{ tabela: string; bytes: number }[]>(
      `SELECT relname AS tabela, pg_total_relation_size(relid)::bigint AS bytes
         FROM pg_catalog.pg_statio_user_tables
        ORDER BY pg_total_relation_size(relid) DESC LIMIT 10`,
    )
    const maiores = linhas.map((l) => ({ tabela: l.tabela, mb: Math.round(Number(l.bytes) / 1_048_576) }))
    const grandes = maiores.filter((m) => m.mb >= 500)
    if (!grandes.length) {
      return { achados: [], metricas: { maiorMb: maiores[0]?.mb ?? 0 }, resumo: `Maior tabela: ${maiores[0]?.tabela ?? '—'} (${maiores[0]?.mb ?? 0} MB).` }
    }
    return {
      achados: [{
        chave: 'tabelas-grandes',
        severidade: 'INFORMATIVO',
        titulo: `${grandes.length} tabela(s) acima de 500 MB`,
        descricao: `Maiores: ${grandes.map((g) => `${g.tabela} (${g.mb} MB)`).join(', ')}.`,
        explicacao: 'Crescimento acelerado costuma preceder lentidão de consulta.',
        impacto: 'Não bloqueia hoje; é sinal de atenção para índice e retenção.',
        entidade: 'Banco',
        quantidade: grandes.length,
        recomendacao: 'Avalie índices e política de retenção para estas tabelas.',
        evidencia: { maiores },
      }],
      metricas: { maiorMb: maiores[0]?.mb ?? 0 },
    }
  },
})

registrar({
  id: 'saude.observabilidade.execucoes-registradas',
  codigo: 'OBS-001',
  nome: 'Diagnóstico sendo executado com regularidade',
  descricao: 'Saúde que não é medida com frequência vira retrato velho.',
  dominio: 'OBSERVABILIDADE',
  modulo: 'Saúde do Sistema',
  severidadePadrao: 'ALERTA',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 10_000,
  orientacao: 'Agende a execução automática do diagnóstico ou execute manualmente com regularidade.',
  rotaCorrecao: '/administrator?screen=syshealth',
  responsavel: 'Plataforma',
  ativo: true,
  executar: async ({ agora }): Promise<ResultadoVerificacao> => {
    const ultima = await prisma.saudeExecucao.findFirst({ orderBy: { criadoEm: 'desc' }, select: { criadoEm: true } })
    const total = await prisma.saudeExecucao.count()
    if (!ultima) return { achados: [], metricas: { execucoes: 0 }, resumo: 'Primeira execução em andamento.' }
    const horas = Math.floor((agora.getTime() - ultima.criadoEm.getTime()) / 3_600_000)
    if (horas >= 48) {
      return {
        achados: [{
          chave: 'diagnostico-desatualizado',
          severidade: 'ALERTA',
          titulo: `Último diagnóstico há ${Math.floor(horas / 24)} dia(s)`,
          descricao: `A execução mais recente foi há ${horas} horas.`,
          explicacao: 'Retrato velho não representa o estado atual do sistema.',
          impacto: 'Problemas novos podem estar acontecendo sem detecção.',
          entidade: 'SaudeExecucao',
          quantidade: total,
          link: '/administrator?screen=syshealth',
          recomendacao: 'Execute o diagnóstico ou agende a execução automática.',
          evidencia: { horasDesdeUltima: horas, execucoes: total },
        }],
        metricas: { execucoes: total, horasDesdeUltima: horas },
      }
    }
    return { achados: [], metricas: { execucoes: total, horasDesdeUltima: horas }, resumo: `${total} execução(ões); última há ${horas}h.` }
  },
})

// ── BACKUP E RECUPERAÇÃO ─────────────────────────────────────────────────────

registrar({
  id: 'saude.backup.evidencia',
  codigo: 'BKP-001',
  nome: 'Existe evidência verificável de backup',
  descricao: 'Não assume backup por existir configuração: exige evidência. Sem evidência, alerta.',
  dominio: 'BACKUP',
  modulo: 'Backup',
  severidadePadrao: 'ALERTA',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 10_000,
  orientacao: 'Registre a evidência do último backup (data e origem). Sem prova, o sistema assume que não há.',
  responsavel: 'Infraestrutura',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const registro = await prisma.configuracaoSistema.findUnique({ where: { chave: 'backup.ultimo' } }).catch(() => null)
    if (registro?.valor) {
      return { achados: [], metricas: { evidencia: 1 }, resumo: `Último backup registrado: ${registro.valor}.` }
    }
    return {
      achados: [{
        chave: 'backup-sem-evidencia',
        severidade: 'ALERTA',
        titulo: 'Sem evidência verificável de backup',
        descricao: 'Não há registro do último backup neste sistema.',
        explicacao: 'O provedor pode fazer backup automático, mas isso não é verificável daqui — e o que não é verificável não pode ser afirmado.',
        impacto: 'Em caso de incidente, não se sabe a que ponto é possível voltar.',
        entidade: 'ConfiguracaoSistema',
        quantidade: 0,
        recomendacao: 'Registre a evidência do backup (chave backup.ultimo) e teste a restauração.',
        evidencia: { chave: 'backup.ultimo', encontrado: false },
      }],
      metricas: { evidencia: 0 },
    }
  },
})

registrar({
  id: 'saude.recuperacao.teste-restauracao',
  codigo: 'REC-001',
  nome: 'Restauração já foi testada',
  descricao: 'Backup nunca restaurado é backup não comprovado.',
  dominio: 'RECUPERACAO',
  modulo: 'Recuperação',
  severidadePadrao: 'ALERTA',
  obrigatoria: true,
  modos: ['PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 10_000,
  orientacao: 'Registre a data do último teste de restauração após executá-lo.',
  responsavel: 'Infraestrutura',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const registro = await prisma.configuracaoSistema.findUnique({ where: { chave: 'backup.ultimoTesteRestauracao' } }).catch(() => null)
    if (registro?.valor) return { achados: [], metricas: { testado: 1 }, resumo: `Última restauração testada em ${registro.valor}.` }
    return {
      achados: [{
        chave: 'restauracao-nao-testada',
        severidade: 'ALERTA',
        titulo: 'Restauração nunca testada',
        descricao: 'Não há registro de teste de restauração.',
        explicacao: 'Só a restauração comprova que o backup serve.',
        impacto: 'Risco de descobrir que o backup não presta justamente no incidente.',
        entidade: 'ConfiguracaoSistema',
        quantidade: 0,
        recomendacao: 'Execute uma restauração de teste e registre a data.',
        evidencia: { chave: 'backup.ultimoTesteRestauracao', encontrado: false },
      }],
      metricas: { testado: 0 },
    }
  },
})

// ── DEPLOY ───────────────────────────────────────────────────────────────────

registrar({
  id: 'saude.deploy.schema-x-banco',
  codigo: 'DEP-001',
  nome: 'Schema do código corresponde ao banco',
  descricao: 'Compara a última migration do repositório com a última aplicada no banco.',
  dominio: 'DEPLOY',
  modulo: 'Deploy e versão',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 15_000,
  orientacao: 'Aplique as migrations pendentes antes de operar — código à frente do banco quebra em runtime.',
  responsavel: 'Infraestrutura',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const dir = join(RAIZ, 'prisma', 'migrations')
    const noRepo = existsSync(dir)
      ? readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory()).sort()
      : []
    const aplicadas = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`,
    )
    const nomes = new Set(aplicadas.map((a) => a.migration_name))
    const pendentes = noRepo.filter((m) => !nomes.has(m))
    if (!pendentes.length) {
      return { achados: [], metricas: { noRepo: noRepo.length, aplicadas: nomes.size }, resumo: `${noRepo.length} migrations no repositório, todas aplicadas.` }
    }
    return {
      achados: [{
        chave: 'migrations-pendentes',
        severidade: 'CRITICO',
        titulo: `${pendentes.length} migration(s) pendente(s)`,
        descricao: `O código traz migrations que o banco ainda não tem: ${pendentes.join(', ')}.`,
        explicacao: 'Código novo esperando coluna que ainda não existe falha em runtime, de forma imprevisível.',
        impacto: 'Erros de coluna/tabela inexistente durante a operação normal.',
        entidade: '_prisma_migrations',
        quantidade: pendentes.length,
        recomendacao: 'Aplique as migrations pelo guard oficial de produção.',
        evidencia: { pendentes },
      }],
      metricas: { pendentes: pendentes.length, noRepo: noRepo.length },
    }
  },
})

// ── DEMAIS DOMÍNIOS DECLARADOS ───────────────────────────────────────────────


registrar({
  id: 'saude.transicoes.destino-valido',
  codigo: 'TRA-001',
  nome: 'Transições apontam para fases existentes',
  descricao: 'Transição para fase inexistente é caminho morto no fluxo.',
  dominio: 'TRANSICOES',
  modulo: 'Transições',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 15_000,
  orientacao: 'Corrija o destino da transição ou remova-a.',
  rotaCorrecao: '/administrator?screen=transicoes',
  responsavel: 'Workflow',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    // A tabela de transições é opcional no schema atual; ausência não é falha.
    const existeTabela = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='PhaseTransition'`,
    )
    if (!(existeTabela?.[0]?.n ?? 0)) {
      return { achados: [], metricas: { transicoes: 0 }, resumo: 'Sem tabela de transições explícitas — o fluxo é sequencial pelo Workflow Macro.' }
    }
    const r = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM "PhaseTransition" t
        WHERE NOT EXISTS (SELECT 1 FROM "CatalogoFase" c WHERE c."phaseKey" = t."paraFase")`,
    )
    const n = r?.[0]?.n ?? 0
    if (!n) return { achados: [], metricas: { quebradas: 0 }, resumo: 'Toda transição tem destino válido.' }
    return {
      achados: [{
        chave: 'transicao-destino-inexistente',
        severidade: 'ERRO',
        titulo: `${n} transição(ões) com destino inexistente`,
        descricao: `${n} transição(ões) apontam para fase que não existe.`,
        explicacao: 'Transição é a aresta do fluxo; destino inválido é caminho morto.',
        impacto: 'O processo pode ficar sem próxima transição possível.',
        entidade: 'PhaseTransition',
        quantidade: n,
        link: '/administrator?screen=transicoes',
        recomendacao: 'Corrija o destino ou remova a transição.',
        evidencia: { quebradas: n },
      }],
      metricas: { quebradas: n },
    }
  },
})

registrar({
  id: 'saude.integracoes.cambio-configurada',
  codigo: 'ITG-001',
  nome: 'Integração de câmbio configurada',
  descricao: 'Verifica a PRESENÇA da credencial da integração (nunca o valor) e o status do último sincronismo.',
  dominio: 'INTEGRACOES',
  modulo: 'Integrações externas',
  severidadePadrao: 'ALERTA',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 10_000,
  orientacao: 'Configure a credencial do provedor de câmbio ou mantenha a cotação manual atualizada.',
  rotaCorrecao: '/cambio',
  responsavel: 'Financeiro',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const temCredencial = !!process.env.CONFIDENCE_COTACAO_URL || !!process.env.CONFIDENCE_API_KEY
    const ultima = await prisma.cotacaoCambio.findFirst({
      where: { origem: 'CONFIDENCE_AUTOMATICO' }, orderBy: { consultadoEm: 'desc' },
      select: { consultadoEm: true, statusIntegracao: true },
    })
    if (temCredencial && ultima) {
      return { achados: [], metricas: { credencial: 1 }, resumo: `Integração ativa (status: ${ultima.statusIntegracao ?? '—'}).` }
    }
    return {
      achados: [{
        chave: 'integracao-cambio-inativa',
        severidade: 'ALERTA',
        titulo: temCredencial ? 'Integração de câmbio sem sincronismo registrado' : 'Integração de câmbio sem credencial',
        descricao: temCredencial
          ? 'A credencial existe, mas não há cotação automática registrada.'
          : 'Não há credencial configurada para o provedor de câmbio.',
        explicacao: 'Sem integração, a cotação depende de lançamento manual.',
        impacto: 'Risco de conversão desatualizada em cobranças e relatórios.',
        entidade: 'Integração',
        quantidade: 1,
        link: '/cambio',
        recomendacao: 'Configure a credencial do provedor ou mantenha a cotação manual em dia.',
        evidencia: { credencialPresente: temCredencial, ultimoSincronismo: ultima?.consultadoEm ?? null },
      }],
      metricas: { credencial: temCredencial ? 1 : 0 },
    }
  },
})

registrar({
  id: 'saude.comunicacoes.templates',
  codigo: 'COM-001',
  nome: 'Modelos de comunicação disponíveis',
  descricao: 'Automação de comunicação sem modelo cadastrado não envia nada.',
  dominio: 'COMUNICACOES',
  modulo: 'Comunicações',
  severidadePadrao: 'INFORMATIVO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 10_000,
  orientacao: 'Cadastre os modelos de documento/comunicação usados pelas automações.',
  rotaCorrecao: '/administrator?screen=templates',
  responsavel: 'Operação',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const modelos = await prisma.modeloDocumento.count({ where: { ativo: true } })
    const regras = await prisma.regraNotificacao.count({ where: { ativo: true } })
    const achados: Achado[] = []
    if (regras > 0 && modelos === 0) {
      achados.push({
        chave: 'notificacao-sem-modelo',
        severidade: 'ERRO',
        titulo: `${regras} regra(s) de notificação sem nenhum modelo cadastrado`,
        descricao: 'Existem regras de notificação ativas, mas nenhum modelo de documento ativo.',
        explicacao: 'A regra dispara e busca o modelo para montar a mensagem.',
        impacto: 'A notificação não é enviada — falha silenciosa.',
        entidade: 'RegraNotificacao',
        quantidade: regras,
        link: '/administrator?screen=templates',
        recomendacao: 'Cadastre os modelos referenciados pelas regras.',
        evidencia: { regras, modelos },
      })
    } else if (modelos === 0) {
      achados.push({
        chave: 'sem-modelos-comunicacao',
        severidade: 'INFORMATIVO',
        titulo: 'Nenhum modelo de comunicação cadastrado',
        descricao: 'Não há modelo de documento ativo.',
        explicacao: 'Modelos padronizam ofícios, cartas e mensagens ao cliente.',
        impacto: 'Não bloqueia: as comunicações seguem manuais.',
        entidade: 'ModeloDocumento',
        quantidade: 0,
        link: '/administrator?screen=templates',
        recomendacao: 'Cadastre os modelos quando padronizar a comunicação.',
        evidencia: { modelos: 0, regras },
      })
    }
    return { achados, metricas: { modelos, regras }, resumo: `${modelos} modelo(s) e ${regras} regra(s) ativas.` }
  },
})

registrar({
  id: 'saude.relatorios.fontes',
  codigo: 'REL-001',
  nome: 'Relatórios com fonte de dados real',
  descricao: 'As telas de relatório precisam consumir rota existente.',
  dominio: 'RELATORIOS',
  modulo: 'Relatórios e Indicadores',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 10_000,
  orientacao: 'Toda tela de relatório precisa apontar para uma rota de API existente.',
  rotaCorrecao: '/administrator?screen=diagnostics',
  responsavel: 'Plataforma',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const telas = ['src/components/gerenciamentoComponents/DiagnosticoViews.tsx']
    const quebradas: string[] = []
    for (const t of telas) {
      if (!existe(t)) { quebradas.push(`${t} (arquivo ausente)`); continue }
      const src = ler(t)
      for (const rota of [...src.matchAll(/"(\/api\/[\w/[\]-]+)"/g)].map((m) => m[1])) {
        const caminho = `src/app${rota.split('?')[0]}/route.ts`
        if (!existe(caminho)) quebradas.push(`${t} → ${rota}`)
      }
    }
    if (!quebradas.length) return { achados: [], metricas: { telas: telas.length }, resumo: 'Relatórios apontam para rotas existentes.' }
    return {
      achados: [{
        chave: 'relatorio-fonte-inexistente',
        severidade: 'ERRO',
        titulo: `${quebradas.length} relatório(s) apontando para rota inexistente`,
        descricao: quebradas.join(' · '),
        explicacao: 'A tela chama a API para montar os números; rota ausente devolve erro.',
        impacto: 'Relatório abre vazio ou com erro.',
        entidade: 'Relatório',
        quantidade: quebradas.length,
        recomendacao: 'Crie a rota ou corrija a chamada.',
        evidencia: { quebradas },
      }],
      metricas: { quebradas: quebradas.length },
    }
  },
})

registrar({
  id: 'saude.importexport.rota-viva',
  codigo: 'IMP-001',
  nome: 'Exportações apontam para rotas existentes',
  descricao: 'Entrada de exportação apontando para rota removida gera download quebrado.',
  dominio: 'IMPORT_EXPORT',
  modulo: 'Exportações',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.0.0',
  timeoutMs: 10_000,
  orientacao: 'Remova a entrada de exportação ou recrie a rota correspondente.',
  rotaCorrecao: '/administrator?screen=impexp',
  responsavel: 'Plataforma',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const src = ler('src/components/gerenciamentoComponents/ExportacoesTab.tsx')
    const rotas = [...src.matchAll(/url:\s*"(\/api\/[\w/-]+)"/g)].map((m) => m[1])
    const quebradas = rotas.filter((r) => {
      // rotas genéricas de cadastro resolvem por [entidade]
      if (r.startsWith('/api/gerenciamento/cadastros/')) {
        return !existe('src/app/api/gerenciamento/cadastros/[entidade]/route.ts')
      }
      return !existe(`src/app${r}/route.ts`)
    })
    if (!quebradas.length) return { achados: [], metricas: { rotas: rotas.length }, resumo: `${rotas.length} exportação(ões) com rota viva.` }
    return {
      achados: [{
        chave: 'exportacao-rota-inexistente',
        severidade: 'ERRO',
        titulo: `${quebradas.length} exportação(ões) apontando para rota inexistente`,
        descricao: `Sem rota: ${quebradas.join(', ')}.`,
        explicacao: 'A tela de exportações lista fontes; rota removida gera download com erro.',
        impacto: 'O operador clica em exportar e recebe falha.',
        entidade: 'ExportacoesTab',
        quantidade: quebradas.length,
        link: '/administrator?screen=impexp',
        recomendacao: 'Remova a entrada ou recrie a rota.',
        evidencia: { rotas: quebradas },
      }],
      metricas: { quebradas: quebradas.length },
    }
  },
})
