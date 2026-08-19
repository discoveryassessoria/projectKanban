// src/components/gerenciamentoComponents/managementNavigation.tsx
//
// CONFIGURAÇÃO CENTRAL E DECLARATIVA da navegação do Gerenciamento.
// FONTE ÚNICA (módulos, agrupamentos internos, itens, ordem, ícones, busca,
// permissão, descrições, status). Alimenta TUDO: sidebar, busca, breadcrumbs e
// navegação contextual. O page.tsx apenas RENDERIZA isto — não hardcoda
// navegação no JSX e não mantém uma segunda fonte concorrente.
//
// ARQUITETURA OFICIAL (reestruturação 25/07) — ordem obrigatória dos módulos:
//   1. Visão Geral   2. Processos   3. Workflow   4. Automações
//   5. Documentos e Protocolos      6. Serviços   7. Financeiro
//   8. Órgãos e Organizações        9. Usuários e Acessos
//  10. Sistema      11. Relatórios e Indicadores
//
// REGRAS DE ESTRUTURA
// - `key` é ESTÁVEL e, quando `status:"active"`, é a MESMA screen key do MAPA DE
//   TELAS do page.tsx (deep-link ?screen=<key> preservado). NENHUMA key existente
//   foi removida ou renomeada nesta reestruturação — só reagrupada/renomeada de
//   RÓTULO. Keys aposentadas viram ALIAS no page.tsx (URL antiga continua válida).
// - `section` é o AGRUPAMENTO INTERNO (título discreto em caixa alta na sidebar).
//   Item SEM `section` renderiza direto sob o módulo (sem cabeçalho). A ordem de
//   renderização é a ORDEM DO ARRAY — seções e itens soltos podem se intercalar.
// - `status:"active"` = tela existe e navega. `"coming_soon"` = item da estrutura
//   oficial SEM implementação própria: aparece DESABILITADO com tooltip honesto
//   (`note`), nunca como página falsa. `"hidden"` = não renderiza (a tela segue
//   acessível por ?screen=<key> — compatibilidade de URL/bookmark).
// - Módulo com `screen` e SEM `children` navega DIRETO (sem seta/submenu).
// - `hiddenAsModule` não é mais usado para esconder módulo algum: todos os 11
//   módulos oficiais aparecem, na ordem oficial.
//
// REGRAS DE DOMÍNIO REFLETIDAS AQUI
// - Fases são cadastradas EXCLUSIVAMENTE em Processos › Estrutura › Fases.
//   Workflow apenas REFERENCIA as fases (Fluxos/Transições).
// - Automações são só financeiras ou de eventos (sem motor paralelo de tarefas).
// - Serviços nunca guarda preço — preço só na Tabela de Valores (Financeiro).
// - "Órgãos e Organizações" substitui "Pessoas e Organizações" (entidades
//   institucionais/jurídicas, não pessoas físicas).

import type { ComponentType } from "react"
import {
  LayoutDashboard, GitBranch, Workflow, Zap, FileText, Briefcase, DollarSign,
  Building2, Users2, Settings2, BarChart3,
} from "lucide-react"

export type NavStatus = "active" | "coming_soon" | "hidden"

export interface ManagementNavigationItem {
  key: string
  label: string
  /** nome completo p/ tooltip/aria/busca quando o label exibido é encurtado (módulos). */
  fullLabel?: string
  /** descrição curta — subtítulo do módulo. */
  description?: string
  /** agrupamento interno (título em caixa alta). Ausente = item solto sob o módulo. */
  section?: string
  /** módulo SEM submenu: navega direto para esta screen key. */
  screen?: string
  href?: string
  icon?: ComponentType<{ className?: string }>
  permission?: string
  keywords?: string[]
  children?: ManagementNavigationItem[]
  status: NavStatus
  technicalOnly?: boolean
  /** grupo existe, mas NÃO aparece como card na home (tela segue acessível por URL). */
  hiddenAsModule?: boolean
  /** tooltip honesto do item `coming_soon` (por que ainda não abre / onde vive hoje). */
  note?: string
  order: number
}

// Gate de todo o Gerenciamento — a página inteira já é gated por esta permissão.
export const GESTAO_PERMISSION = "usuarios.gerenciar"

// Accordion da sidebar (regra ÚNICA): 1 módulo aberto por vez, clicar no módulo
// aberto fecha, clicar em outro troca, todos podem ficar fechados. Puro/testável.
export const toggleAccordion = (current: string | null, clicked: string): string | null =>
  current === clicked ? null : clicked

// ─────────────────────────────────────────────────────────────────────────────
// DERIVAÇÃO DA SIDEBAR (pura e testável) — usada pelo page.tsx e pelos testes.
// Uma única implementação: não existe segunda regra de submenu em componente.
// ─────────────────────────────────────────────────────────────────────────────
export type PodePermissao = (p: string) => boolean
const permitido = (it: ManagementNavigationItem, pode?: PodePermissao) =>
  !it.permission || !pode || pode(it.permission)

/** itens que ABREM tela (navegáveis). */
export const itensAtivosDoModulo = (g: ManagementNavigationItem, pode?: PodePermissao) =>
  (g.children ?? []).filter((it) => it.status === "active" && permitido(it, pode))

/** itens RENDERIZADOS na sidebar: ativos + `coming_soon` (desabilitados). */
export const itensVisiveisDoModulo = (g: ManagementNavigationItem, pode?: PodePermissao) =>
  (g.children ?? []).filter(
    (it) => (it.status === "active" || it.status === "coming_soon") && permitido(it, pode),
  )

/** módulo SEM submenu: navega direto, sem seta. */
export const moduloEhDireto = (g: ManagementNavigationItem, pode?: PodePermissao) =>
  !!g.screen && itensVisiveisDoModulo(g, pode).length === 0

/** bloco da sidebar: item solto ou agrupamento em caixa alta. */
export type BlocoNavegacao =
  | { tipo: "item"; item: ManagementNavigationItem }
  | { tipo: "secao"; nome: string; itens: ManagementNavigationItem[] }

/** blocos NA ORDEM DO ARRAY — itens soltos e agrupamentos podem se intercalar. */
export const blocosDoModulo = (g: ManagementNavigationItem, pode?: PodePermissao): BlocoNavegacao[] => {
  const blocos: BlocoNavegacao[] = []
  for (const it of itensVisiveisDoModulo(g, pode)) {
    if (!it.section) { blocos.push({ tipo: "item", item: it }); continue }
    const ultimo = blocos[blocos.length - 1]
    if (ultimo && ultimo.tipo === "secao" && ultimo.nome === it.section) ultimo.itens.push(it)
    else blocos.push({ tipo: "secao", nome: it.section, itens: [it] })
  }
  return blocos
}

/** entradas oficiais do módulo, na ordem: nome do item solto ou do agrupamento. */
export const entradasOficiais = (g: ManagementNavigationItem, pode?: PodePermissao): string[] =>
  blocosDoModulo(g, pode).map((b) => (b.tipo === "item" ? b.item.label : b.nome))

/** primeira tela útil do módulo (defaultRoute). */
export const primeiraTelaDoModulo = (g: ManagementNavigationItem, pode?: PodePermissao): string | undefined =>
  (moduloEhDireto(g, pode) ? g.screen : undefined) ?? itensAtivosDoModulo(g, pode)[0]?.key ?? g.screen

/** módulo dono de uma screen key (cobre módulo direto). */
export const moduloDaScreen = (key: string): ManagementNavigationItem | undefined =>
  MANAGEMENT_NAVIGATION.find((g) => g.screen === key || (g.children ?? []).some((it) => it.key === key))

// item ATIVO: a(order, key, label, keywords?, section?)
const a = (
  order: number, key: string, label: string, keywords?: string[], section?: string,
): ManagementNavigationItem =>
  ({ key, label, keywords, section, status: "active", order })
// item da ESTRUTURA OFICIAL ainda SEM implementação própria: aparece desabilitado
// com tooltip honesto. Nunca vira página falsa nem botão morto.
const s = (
  order: number, key: string, label: string, note: string, section?: string, keywords?: string[],
): ManagementNavigationItem =>
  ({ key, label, note, section, keywords, status: "coming_soon", order })
// item OCULTO (tela existe e continua acessível por ?screen=, fora do menu).
const h = (order: number, key: string, label: string): ManagementNavigationItem =>
  ({ key, label, status: "hidden", order })

export const MANAGEMENT_NAVIGATION: ManagementNavigationItem[] = [
  // ══════════════════════════════ 1. VISÃO GERAL ══════════════════════════════
  // Sem submenu: clique navega direto para o painel geral.
  {
    key: "grp_visao", label: "Visão Geral", icon: LayoutDashboard, order: 10, status: "active",
    screen: "overview",
    description: "Painel geral do Gerenciamento.",
    keywords: ["painel", "dashboard", "resumo", "inicio", "home", "visao", "visão"],
  },

  // ══════════════════════════════ 2. PROCESSOS ════════════════════════════════
  // REGRA: fases são cadastradas AQUI e em nenhum outro módulo.
  {
    key: "grp_processos", label: "Processos", icon: GitBranch, order: 20, status: "active",
    description: "Cadastros, estrutura de fases e configurações do processo.",
    children: [
      a(10, "proctypes", "Tipos de Processo", ["processo", "tipo", "nacionalidade", "cidadania"], "Cadastros"),
      a(20, "modalidades", "Modalidades", ["modalidade", "judicial", "administrativo", "via"], "Cadastros"),
      a(30, "countrycatalog", "Países e Regiões", ["pais", "país", "regiao", "região", "italia", "portugal", "nacionalidade"], "Cadastros"),

      // ESTRUTURA — o catálogo de fases é a fonte única das fases do sistema.
      a(40, "fases", "Fases", ["fase", "fases", "catalogo", "catálogo", "etapa", "phase"], "Estrutura"),

      // CONFIGURAÇÕES
      a(70, "sla", "SLA", ["sla", "prazo", "vencimento", "alerta"], "Configurações"),
      a(80, "cfgversions", "Versões", ["versao", "versão", "config", "publicacao", "publicação"], "Configurações"),
      a(90, "proccfg", "Configurações Gerais", ["configuracao", "configuração", "padrao", "padrão", "identidade", "situacao"], "Configurações"),

      // RASCUNHOS do mockup: as telas reais acima os substituíram no menu, mas eles
      // continuam acessíveis por ?screen= (nada foi apagado).
      h(900, "sla-rascunho", "SLA e Prazos (rascunho do mockup)"),
      h(910, "cfgversions-rascunho", "Versionamento e Publicação (rascunho do mockup)"),
    ],
  },

  // ══════════════════════════════ 3. WORKFLOW ═════════════════════════════════
  // REGRA: Workflow NÃO cria fases — só referencia o catálogo de Processos.
  {
    key: "grp_workflow", label: "Workflow", icon: Workflow, order: 30, status: "active",
    description: "Fluxos, transições e parâmetros do motor de workflow.",
    children: [
      a(10, "macrokanban", "Workflow Macro", ["workflow", "macro", "kanban", "fluxo", "sequencia", "sequência", "coluna", "sla"], "Fluxos"),
      a(20, "phaseiwf", "Workflow Interno", ["workflow", "interno", "passo", "fluxo", "tarefa"], "Fluxos"),


      a(30, "transicoes", "Transições", ["transicao", "transição", "caminho", "entrada", "avanco", "avanço", "regra"]),

      a(40, "execmotor", "Executor do Motor", ["executor", "motor", "execucao", "execução", "gatilho"], "Configurações"),
      a(50, "runtimediag", "Diagnóstico de Runtime", ["runtime", "diagnostico", "diagnóstico", "v2", "motor"], "Configurações"),
      a(60, "migmotor", "Migração do Motor", ["migracao", "migração", "motor", "runtime"], "Configurações"),
    ],
  },

  // ═════════════════════════════ 4. AUTOMAÇÕES ════════════════════════════════
  // REGRA: automações são SÓ financeiras ou de eventos — efeitos adicionais.
  // Nada de motor paralelo de tarefas, BPM paralelo ou cadastro de fases aqui.
  {
    key: "grp_automacoes", label: "Automações", icon: Zap, order: 40, status: "active",
    description: "Efeitos financeiros e de evento disparados pelas fases.",
    children: [
      a(10, "autofin", "Financeiras", ["automacao", "automação", "financeiro", "receita", "custo", "regra", "fase"]),
      a(20, "autoevt", "Eventos", ["automacao", "automação", "evento", "gatilho", "fase"]),

      a(30, "simfase", "Simulação", ["simulacao", "simulação", "fase", "teste"], "Configurações"),
      a(40, "execmatrix", "Histórico de Execuções", ["historico", "histórico", "execucao", "execução", "log"], "Configurações"),

      // ?screen=opauto (key antiga da tela unificada) resolve por ALIAS_TELAS → autofin.
      h(900, "execmatrix-rascunho", "Painel Executivo de Configuração (rascunho do mockup)"),
    ],
  },

  // ══════════════════ 5. DOCUMENTOS E PROTOCOLOS ══════════════════════════════
  // REGRA: só Documentos e Regras. PROTOCOLO NÃO É CADASTRO — é uma OCORRÊNCIA
  // operacional registrada dentro do Processo (aba Protocolos), que alimenta a
  // Timeline/Histórico. Não existe cadastro mestre de protocolo no Gerenciamento.
  {
    key: "grp_documentos", label: "Documentos", fullLabel: "Documentos e Protocolos", icon: FileText, order: 50, status: "active",
    description: "Cadastros documentais e políticas documentais.",
    children: [
      a(10, "doctypes", "Tipos de Documento", ["documento", "certidao", "certidão", "tipo", "nascimento", "casamento", "obito"], "Documentos"),
      a(20, "doccats", "Categorias Documentais", ["categoria", "categorias", "documental", "classificacao", "classificação"], "Documentos"),

      a(40, "docrules", "Regras Documentais", ["aplicabilidade", "regra", "documento", "documental", "matriz", "obrigatorio", "obrigatório"], "Regras"),

      // OCULTOS (telas existentes, acessíveis por ?screen=) — sem cadastro paralelo no menu.
      h(900, "certtypes", "Tipos de Certidão (consolidado em Tipos de Documento)"),
      h(910, "docmatrix", "Matriz Documental (visão técnica)"),
    ],
  },

  // ══════════════════════════════ 6. SERVIÇOS ═════════════════════════════════
  // REGRA: "Serviços" (nunca "Produtos") e SEM preço — preço só na Tabela de Valores.
  // O "Catálogo de Serviços" é a ÚNICA face de usuário do cadastro mestre: serviços
  // e itens técnicos cobráveis (documentos, taxas, etapas, pacotes) no mesmo cadastro.
  {
    key: "grp_servicos", label: "Serviços", icon: Briefcase, order: 60, status: "active",
    description: "Catálogo operacional de serviços prestados (sem preço).",
    children: [
      a(10, "products", "Catálogo de Serviços", ["servico", "serviço", "traducao", "tradução", "apostilamento", "retificacao", "cidadania", "genealogia", "logistica", "assessoria", "catalogo", "catálogo", "mestre", "item", "cadastro", "documento", "taxa", "pacote"]),
      a(20, "servcats", "Categorias", ["categoria", "servico", "serviço", "organizacao"]),
    ],
  },

  // ═════════════════════════════ 7. FINANCEIRO ════════════════════════════════
  // REGRA: Configurações Financeiras define COMPORTAMENTO (nunca preço).
  //        Tabela de Valores é a ÚNICA origem oficial de preços/valores.
  {
    key: "grp_financeiro", label: "Financeiro", icon: DollarSign, order: 70, status: "active",
    description: "Comportamento financeiro dos cadastros mestres, valores e cobrança.",
    children: [
      // REGRA: o comportamento financeiro pertence ao CADASTRO MESTRE, na sua própria
      // Configuração Financeira. Não existe seção "Classificação" nem cadastro
      // intermediário (Categorias Financeiras, Plano de Contas, Centros de Custo
      // foram eliminados em 02/08/2026). Preço é assunto da Tabela de Valores.
      a(10, "catalog", "Configurações Financeiras", ["configuracao", "config", "financeiro", "catalogo", "papel", "custo", "receita", "natureza", "cobravel", "reembolsavel", "comissao"]),


      a(50, "pricingtable", "Tabelas de Preços", ["preco", "preço", "tabela", "valor", "vigencia", "vigência"], "Tabela de Valores"),
      a(60, "discrules", "Regras de Precificação", ["preco", "preço", "regra", "desconto", "economica"], "Tabela de Valores"),
      a(70, "pricing", "Aplicabilidade Econômica", ["preco", "preço", "aplicabilidade", "economica", "econômica"], "Tabela de Valores"),
      // A Planilha Documental é PROJEÇÃO: aqui se escolhe QUAIS itens do cadastro
      // viram coluna. Preço continua só na Tabela de Preços.
      a(75, "planilhacolunas", "Planilha Documental", ["planilha", "coluna", "documental", "custo", "projecao", "projeção"], "Tabela de Valores"),

      a(80, "accounts", "Contas Bancárias", ["conta", "banco", "bancaria", "tesouraria"], "Tesouraria"),
      a(90, "banks", "Bancos", ["banco", "tesouraria"], "Tesouraria"),
      a(100, "wallets", "Carteiras de Recebimento", ["carteira", "recebimento", "tesouraria"], "Tesouraria"),

      a(110, "currencies", "Moedas", ["moeda", "currency"], "Moedas"),
      a(120, "fx", "Câmbio", ["cambio", "câmbio", "cotacao", "cotação", "moeda"], "Moedas"),

      a(130, "methods", "Formas de Pagamento", ["forma", "pagamento", "cobranca", "cobrança", "pix", "boleto", "cartao"], "Cobrança"),
      a(140, "paycond", "Condições de Pagamento", ["condicao", "condição", "pagamento", "parcelamento", "cobranca"], "Cobrança"),
      a(150, "fees", "Taxas de Pagamento", ["taxa", "pagamento", "encargo", "cobranca"], "Cobrança"),

      a(160, "credito", "Crédito", ["credito", "crédito", "saldo", "disponivel", "utilizado"]),

      a(170, "taxes", "Impostos", ["imposto", "tributo", "fiscal"], "Fiscal"),

      a(180, "commrules", "Regras de Comissão", ["comissao", "comissão", "regra"], "Comissões"),

      a(190, "docfin", "Documentos Financeiros", ["recibo", "fatura", "nota", "documento", "financeiro", "numeracao"]),
      a(200, "governanca", "Governança", ["governanca", "governança", "auditoria", "trilha", "alteracao", "historico"]),

      // Sem telas legadas: as concentradoras e o CRUD de Honorário foram REMOVIDOS.
      // Os deep-links antigos (?screen=estruturafin|precificacao|comercial|pagamentos|
      // fornecedoresconc|integracaofin|honorariums) são resolvidos por ALIAS_TELAS
      // para a tela que hoje é dona da função.
    ],
  },

  // ═══════════════════ 8. ÓRGÃOS E ORGANIZAÇÕES ═══════════════════════════════
  // REGRA: entidades institucionais/jurídicas (cartórios, consulados, tribunais,
  // órgãos, empresas, escritórios, bancos, tradutores, parceiros, fornecedores).
  // NÃO é cadastro de pessoa física. Sem cadastros separados por tipo de órgão.
  {
    key: "grp_orgaos", label: "Órgãos", fullLabel: "Órgãos e Organizações", icon: Building2, order: 80, status: "active",
    description: "Entidades institucionais e jurídicas que participam dos processos.",
    children: [
      a(10, "organs", "Cartórios e Órgãos", ["cartorio", "cartório", "orgao", "órgão", "consulado", "tribunal", "prefeitura", "comune", "protocolo", "organizacao", "organização"], "Organizações"),
      a(20, "suppliers", "Fornecedores", ["fornecedor", "parceiro", "tradutor", "advogado", "escritorio", "banco", "empresa", "organizacao"], "Organizações"),
      a(30, "orgcats", "Categorias", ["categoria", "tipo", "orgao", "organizacao"]),
    ],
  },

  // ═══════════════════ 9. USUÁRIOS E ACESSOS ══════════════════════════════════
  {
    key: "grp_usuarios", label: "Usuários", fullLabel: "Usuários e Acessos", icon: Users2, order: 90, status: "active",
    description: "Identidade de acesso, autorização, organização operacional e trilha de acesso.",
    children: [
      // ─── quem entra e o que pode ───────────────────────────────────────────
      a(10, "users", "Usuários", ["usuario", "usuário", "user", "conta", "acesso", "login"]),
      a(20, "roles", "Perfis", ["perfil", "papel", "role", "permissao", "permissão", "acesso"]),
      a(30, "permmotor", "Permissões", ["permissao", "permissão", "autorizacao", "autorização", "perfil", "motor"]),

      // ─── COMO O TRABALHO SE ORGANIZA ───────────────────────────────────────
      // A seção deixou de se chamar "Grupos": Capacidade Operacional não é um
      // grupo de pessoas, é a condição de cada uma para receber trabalho.
      // Departamentos e Cargos saíram daqui — eram cadastros sem consumidor:
      // nenhuma FK apontava para eles, nenhuma regra os lia, e ninguém podia
      // sequer ser associado a um deles.
      a(40, "teams", "Equipes", ["equipe", "time", "grupo", "departamento", "setor"], "Organização operacional"),
      a(45, "opcapacity", "Capacidade Operacional",
        ["capacidade", "aptidao", "aptidão", "disponibilidade", "ferias", "férias", "carga", "equipe", "cargo", "funcao", "função"],
        "Organização operacional"),

      // ─── rastro ────────────────────────────────────────────────────────────
      a(70, "accaudit", "Auditoria de Acessos", ["auditoria", "acesso", "sessao", "sessão", "login", "bloqueio"], "Controle"),

      // alias histórico da mesma tela de perfis/permissões (deep-link preservado).
      h(900, "permprofiles", "Perfis de Permissão (alias)"),
      h(910, "teams-rascunho", "Equipes (rascunho do mockup)"),
    ],
  },

  // ══════════════════════════════ 10. SISTEMA ═════════════════════════════════
  // REGRA: só configurações globais e técnicas transversais. Regra de domínio
  // continua no seu módulo. Auditoria aqui é técnica e global.
  {
    key: "grp_sistema", label: "Sistema", icon: Settings2, order: 100, status: "active",
    description: "Configurações globais, cadastros transversais e trilha técnica.",
    children: [
      a(10, "settings", "Configurações Gerais", ["configuracao", "configuração", "geral", "empresa", "moeda", "fuso"]),

      // ASSISTENTE DE PARAMETRIZAÇÃO — camada de CONDUÇÃO sobre as telas que já
      // existem (Regras Documentais, Serviços, Fornecedores, Aplicabilidade
      // Econômica, Tabela de Valores, Moedas). Ele não cadastra nada por conta
      // própria: embute a tela oficial de cada etapa. Fica em Sistema porque é
      // transversal — atravessa Documentos, Serviços e Financeiro.
      a(20, "paramwizard", "Assistente de Parametrização",
        ["assistente", "parametrizacao", "parametrização", "configuracao inicial", "configuração inicial", "wizard", "onboarding", "matriz", "preco", "preço"]),

      // "Catálogo Mestre" SAIU do menu: o cadastro mestre (ItemCatalogo) é
      // ESTRUTURA TÉCNICA INTERNA — todos os registros, ids e vínculos seguem
      // intactos, mas a única tela de usuário sobre ele é Serviços › Catálogo de
      // Serviços. ?screen=catalogmestre resolve por ALIAS_TELAS → products.
      a(30, "templates", "Modelos", ["modelo", "template"], "Cadastros Auxiliares"),

      a(40, "identidade", "Identidade Visual", ["identidade", "visual", "tema", "cor", "logo", "marca"]),

      a(50, "notifications", "Notificações", ["notificacao", "notificação", "email", "aviso", "comunicacao"], "Comunicações"),

      a(60, "integracoes", "Integrações", ["integracao", "integração", "api", "webhook", "cron", "cambio", "storage"]),

      a(70, "audit", "Auditoria e Logs", ["auditoria", "log", "trilha", "historico", "histórico"]),

      // OCULTOS — telas existentes, acessíveis por ?screen=.
      h(900, "backup", "Backup e Restauração (rascunho)"),
      h(910, "settings-rascunho", "Configurações Gerais (rascunho do mockup)"),
      h(920, "templates-rascunho", "Modelos (rascunho do mockup)"),
      h(930, "notifications-rascunho", "Notificações (rascunho do mockup)"),
    ],
  },

  // ═══════════════ 11. RELATÓRIOS E INDICADORES ═══════════════════════════════
  {
    key: "grp_relatorios", label: "Relatórios", fullLabel: "Relatórios e Indicadores", icon: BarChart3, order: 110, status: "active",
    description: "Consultas detalhadas, KPIs, composições visuais e exportações.",
    children: [
      a(10, "diagnostics", "Diagnóstico do Sistema", ["diagnostico", "diagnóstico", "relatorio", "relatório"], "Relatórios"),
      a(20, "cfgdiagnosis", "Diagnóstico de Configuração", ["diagnostico", "diagnóstico", "config", "relatorio"], "Relatórios"),

      a(30, "mgmthealth", "Diagnóstico Executivo", ["indicador", "kpi", "saude", "saúde", "executivo", "score"], "Indicadores"),
      a(40, "syshealth", "Saúde do Sistema", ["saude", "saúde", "indicador", "score", "auditoria"], "Indicadores"),

      a(50, "dashboards", "Dashboards", ["dashboard", "painel", "grafico", "gráfico", "indicador"]),

      a(60, "impexp", "Importação / Exportação", ["exportacao", "exportação", "importacao", "csv", "json"], "Exportações"),

      // RASCUNHO do mockup substituído pela tela real de Diagnóstico de Configuração.
      h(900, "cfgdiagnosis-rascunho", "Diagnóstico de Configuração (rascunho do mockup)"),
      h(910, "diagnostics-rascunho", "Diagnóstico do Sistema (rascunho do mockup)"),
      h(920, "mgmthealth-rascunho", "Diagnóstico Executivo (rascunho do mockup)"),
      h(930, "syshealth-rascunho", "Saúde do Sistema (rascunho do mockup)"),
      // Visão de integridade ANTERIOR ao motor de auditoria — preservada e acessível
      // por ?screen= até a validação completa do motor novo em produção.
      h(940, "syshealth-legado", "Saúde do Sistema (visão anterior)"),
      h(940, "impexp-rascunho", "Importação / Exportação (rascunho do mockup)"),
    ],
  },
]
