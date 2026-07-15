// src/components/gerenciamentoComponents/managementNavigation.tsx
//
// CONFIGURAÇÃO CENTRAL E DECLARATIVA da navegação do Gerenciamento.
// FONTE ÚNICA (módulos, grupos visuais, itens, ordem, ícones, busca, permissão,
// descrições, status). Alimenta TUDO: cards da home, busca, páginas de módulo,
// navegação contextual e breadcrumbs. O page.tsx apenas RENDERIZA isto — não
// hardcoda navegação no JSX e não mantém uma segunda fonte concorrente.
//
// REGRAS:
// - `key` é estável e, quando `status:"active"`, é a MESMA screen key do MAPA
//   DE TELAS (deep-link ?screen=<key> preservado). Nenhuma key existente foi
//   removida ou renomeada — só reorganizada e enriquecida com metadados visuais.
// - `status:"active"` = tela existe (aparece no menu/cards). `"coming_soon"` =
//   mostra desabilitado. `"hidden"` = existe na estrutura oficial mas NÃO
//   renderiza (sem página falsa).
// - `section` agrupa os itens ATIVOS de um módulo em blocos visuais na página do
//   módulo e na navegação contextual (ex.: Financeiro → Configuração / Precificação
//   / Bancos e moedas / Pagamentos / Fiscal e comercial).
// - `description` (nos grupos = módulos) é a descrição curta do card e o subtítulo
//   da página do módulo.
// - `hiddenAsModule` esconde o grupo da HOME em cards (ex.: Painel/Visão Geral, cuja
//   função foi substituída pela própria home). A tela continua acessível por URL.
// - `technicalOnly` (grupo 16) só aparece com permissão técnica.
// - `permission` é opcional; a página inteira já é gated por usuarios.gerenciar.

import type { ComponentType } from "react"
import {
  LayoutDashboard, GitBranch, Workflow, FileText, DollarSign, Users2,
  Library, Zap, MessageSquare, CalendarClock, Brain, BarChart3, Plug,
  ShieldCheck, Cpu, Briefcase,
} from "lucide-react"

export type NavStatus = "active" | "coming_soon" | "hidden"

export interface ManagementNavigationItem {
  key: string
  label: string
  /** nome completo p/ tooltip/aria/busca quando o label exibido é encurtado (grupos). */
  fullLabel?: string
  /** descrição curta — card da home e subtítulo da página do módulo (usada nos grupos). */
  description?: string
  /** bloco visual do item dentro do módulo (página do módulo + nav contextual). */
  section?: string
  href?: string
  icon?: ComponentType<{ className?: string }>
  permission?: string
  keywords?: string[]
  children?: ManagementNavigationItem[]
  status: NavStatus
  technicalOnly?: boolean
  /** grupo existe, mas NÃO aparece como card na home (tela segue acessível por URL). */
  hiddenAsModule?: boolean
  order: number
}

// Gate do grupo 16 (Motor Técnico): usa EXATAMENTE a mesma regra dos demais
// módulos administrativos do Gerenciamento — a permissão existente
// "usuarios.gerenciar", que é o próprio gate da página (isAdmin = pode(
// "usuarios.gerenciar")). Assim o grupo aparece para o MESMO conjunto de
// admins que já têm acesso administrativo completo ao Gerenciamento.
// Nenhuma permissão nova; nenhum papel/auth/backend alterado.
export const GESTAO_PERMISSION = "usuarios.gerenciar"

// item ATIVO: a(order, key, label, keywords?, section?)
const a = (
  order: number, key: string, label: string, keywords?: string[], section?: string,
): ManagementNavigationItem =>
  ({ key, label, keywords, section, status: "active", order })
// item OCULTO (estrutura oficial, sem tela ainda): não renderiza.
const h = (order: number, key: string, label: string): ManagementNavigationItem =>
  ({ key, label, status: "hidden", order })

export const MANAGEMENT_NAVIGATION: ManagementNavigationItem[] = [
  {
    key: "grp_visao", label: "Painel", fullLabel: "Visão Geral", icon: LayoutDashboard, order: 10, status: "active",
    hiddenAsModule: true,
    description: "Visão geral do Gerenciamento.",
    children: [
      a(10, "overview", "Painel do Gerenciamento", ["dashboard", "resumo", "inicio", "home"], "Visão"),
      h(20, "pendencias_config", "Pendências de Configuração"),
      h(30, "alteracoes_recentes", "Alterações Recentes"),
    ],
  },
  {
    key: "grp_processos", label: "Processos", icon: GitBranch, order: 20, status: "active",
    description: "Tipos de processo, países e versões de configuração.",
    children: [
      a(10, "proctypes", "Tipos de Processo", ["processo", "tipo", "nacionalidade", "cidadania"], "Cadastros"),
      a(20, "countrycatalog", "Países e Regiões", ["pais", "país", "regiao", "região", "italia", "portugal"], "Cadastros"),
      a(50, "cfgversions", "Versões por Processo", ["versao", "versão", "config"], "Cadastros"),
      h(60, "modalidades", "Modalidades"),
      h(70, "linhas_servico", "Linhas de Serviço"),
      h(80, "config_padrao", "Configurações Padrão"),
    ],
  },
  {
    key: "grp_workflow", label: "Workflow", icon: Workflow, order: 30, status: "active",
    description: "Estrutura de fases, modelos e regras de workflow.",
    children: [
      a(10, "macrokanban", "Workflow Macro / Kanban", ["workflow", "macro", "kanban", "fase", "coluna"], "Estrutura"),
      a(20, "phaseiwf", "Workflow Interno das Fases", ["workflow", "interno", "passo", "fase"], "Estrutura"),
      a(30, "phasemodes", "Modos Internos", ["modo", "interno", "fase"], "Estrutura"),
      a(40, "workflowsphases", "Hub de Workflows das Fases", ["workflow", "hub", "fase"], "Estrutura"),
      a(50, "iwtemplates", "Modelos de Workflow Interno", ["modelo", "template", "workflow", "interno"], "Modelos"),
      a(70, "crossrules", "Tarefas Transversais", ["tarefa", "transversal", "regra"], "Modelos"),
      a(75, "prottypes", "Tipos de Protocolo", ["protocolo", "orgao", "órgão", "tipo"], "Modelos"),
      h(80, "mod_wfmacro", "Modelos de Workflow Macro"),
      h(90, "wf_conclusao", "Regras de Conclusão"),
      h(100, "wf_dependencias", "Dependências e Paralelismo"),
      h(110, "wf_blockers", "Blockers"),
      h(120, "wf_politicas", "Políticas de Entrada e Saída"),
      h(130, "wf_avanco", "Avanço, Exceção e Reabertura"),
      h(140, "wf_pacotes", "Pacotes Operacionais"),
    ],
  },
  {
    key: "grp_documentos", label: "Documentos", icon: FileText, order: 40, status: "active",
    description: "Tipos, categorias, matriz e regras documentais.",
    children: [
      a(10, "doctypes", "Tipos de Documento", ["documento", "certidao", "certidão", "tipo", "nascimento", "casamento", "obito"], "Cadastros"),
      a(15, "doccats", "Categorias Documentais", ["categoria", "categorias", "documental", "classificacao", "classificação"], "Cadastros"),
      // CONSOLIDADO em "Tipos de Documento" (cadastro mestre). Removido da sidebar;
      // a rota ?screen=certtypes vira alias/redirect para doctypes (page.tsx).
      h(20, "certtypes", "Tipos de Certidão"),
      a(30, "docmatrix", "Matriz Documental", ["matriz", "documento", "obrigatorio"], "Regras"),
      a(40, "docrules", "Aplicabilidade", ["aplicabilidade", "regra", "documento"], "Regras"),
      h(50, "doc_categorias", "Categorias Documentais"),
      h(60, "doc_estados", "Estados Documentais"),
      h(70, "mod_documento", "Modelos de Documento"),
      h(80, "doc_checklists", "Checklists"),
      h(90, "doc_motivos_pend", "Motivos de Pendência"),
      h(100, "doc_motivos_inval", "Motivos de Invalidação"),
    ],
  },
  {
    key: "grp_servicos", label: "Serviços", icon: Briefcase, order: 45, status: "active",
    description: "Catálogo operacional de serviços prestados.",
    children: [
      // Cadastro MESTRE operacional de Serviços (o que a empresa vende/executa). Sem financeiro.
      a(10, "products", "Catálogo de Serviços", ["servico", "serviço", "traducao", "tradução", "apostilamento", "retificacao", "cidadania", "genealogia", "logistica", "assessoria"], "Cadastros"),
    ],
  },
  {
    key: "grp_financeiro", label: "Financeiro", icon: DollarSign, order: 50, status: "active",
    description: "Cadastros, precificação, bancos, pagamentos e configurações financeiras.",
    children: [
      // MENU FINAL do Financeiro (arquitetura canônica) — exatamente estes 18 itens.
      a(10, "catalog", "Configurações Financeiras", ["configuracao", "config", "produto", "financeiro", "catalogo", "preco", "preço", "papel", "custo", "receita"], "Configuração"),
      a(60, "categories", "Categorias Financeiras", ["categoria", "financeiro"], "Configuração"),
      a(70, "coa", "Plano de Contas", ["plano", "conta", "contabil"], "Configuração"),
      a(80, "costcenters", "Centros de Custo", ["centro", "custo"], "Configuração"),
      a(50, "suppliers", "Fornecedores", ["fornecedor", "parceiro", "cartorio", "tradutor"], "Configuração"),
      a(20, "pricingtable", "Tabelas de Preços", ["preco", "preço", "tabela", "valor"], "Precificação"),
      a(40, "discrules", "Regras de Precificação", ["preco", "preço", "regra", "desconto", "economica"], "Precificação"),
      a(30, "pricing", "Aplicabilidade Econômica", ["preco", "preço", "aplicabilidade", "economica"], "Precificação"),
      a(90, "accounts", "Contas Bancárias", ["conta", "banco", "bancaria"], "Bancos e moedas"),
      a(100, "banks", "Bancos", ["banco"], "Bancos e moedas"),
      a(110, "wallets", "Carteiras de Recebimento", ["carteira", "recebimento"], "Bancos e moedas"),
      a(120, "currencies", "Moedas", ["moeda", "cambio", "câmbio"], "Bancos e moedas"),
      a(130, "fx", "Câmbio", ["cambio", "câmbio", "cotacao", "moeda"], "Bancos e moedas"),
      a(140, "methods", "Formas de Pagamento", ["forma", "pagamento"], "Pagamentos"),
      a(150, "paycond", "Condições de Pagamento", ["condicao", "condição", "pagamento", "parcelamento"], "Pagamentos"),
      a(160, "fees", "Taxas de Pagamento", ["taxa", "pagamento"], "Pagamentos"),
      a(170, "taxes", "Impostos", ["imposto", "tributo"], "Fiscal e comercial"),
      a(180, "commrules", "Comissões", ["comissao", "comissão"], "Fiscal e comercial"),
      // LEGADOS — OCULTOS da sidebar (status hidden). A rota/tela permanece acessível
      // como alias/read-only (page.tsx), sem exibição como cadastro paralelo.
      // (Serviços NÃO é legado: virou cadastro mestre operacional em grp_servicos.)
      h(910, "honorariums", "Honorários"),
      h(920, "catalogmestre", "Catálogo Mestre"),
      h(930, "estruturafin", "Estrutura Financeira"),
      h(940, "precificacao", "Precificação"),
      h(950, "comercial", "Comercial"),
      h(960, "pagamentos", "Pagamentos"),
      h(970, "fornecedoresconc", "Concentradoras e Adquirentes"),
      h(980, "integracaofin", "Integração com o Financeiro Geral"),
    ],
  },
  {
    key: "grp_pessoas", label: "Pessoas", fullLabel: "Pessoas e Organizações", icon: Users2, order: 60, status: "active",
    description: "Fornecedores, cartórios e órgãos.",
    children: [
      // Dono canônico de Fornecedor é o Financeiro → aqui é ATALHO para a mesma tela.
      a(10, "suppliers", "Fornecedores (Financeiro)", ["fornecedor", "parceiro", "tradutor", "advogado"], "Cadastros"),
      a(20, "organs", "Cartórios e Órgãos", ["cartorio", "cartório", "orgao", "órgão", "protocolo"], "Cadastros"),
      h(30, "clientes", "Clientes"),
      h(40, "requerentes", "Requerentes"),
      h(50, "familiares", "Familiares"),
      h(60, "pessoas_juridicas", "Pessoas Jurídicas"),
      h(70, "tradutores", "Tradutores"),
      h(80, "advogados", "Advogados"),
      h(90, "parceiros", "Parceiros"),
      h(100, "tipos_relacionamento", "Tipos de Relacionamento"),
    ],
  },
  {
    key: "grp_biblioteca", label: "Biblioteca", fullLabel: "Biblioteca Operacional", icon: Library, order: 70, status: "active",
    description: "Modelos, SLAs e templates operacionais.",
    children: [
      a(10, "crosstpl", "Modelos de Tarefas", ["modelo", "tarefa", "template"], "Modelos"),
      a(15, "imtemplates", "Modelos de Passos", ["modelo", "passo", "step", "template"], "Modelos"),
      a(30, "templates", "Templates Diversos", ["template", "modelo"], "Modelos"),
      a(20, "sla", "SLAs", ["sla", "prazo", "acordo"], "Prazos"),
      h(40, "bib_prioridades", "Prioridades"),
      h(50, "bib_prazos", "Prazos"),
      h(60, "bib_followups", "Follow-ups"),
      h(70, "bib_tipos_evento", "Tipos de Evento"),
      h(80, "bib_estrategias", "Estratégias de Responsável"),
      h(90, "bib_filas", "Filas e Distribuição"),
      h(100, "bib_motivos", "Motivos Padronizados"),
      h(110, "bib_tags", "Tags Operacionais"),
    ],
  },
  {
    key: "grp_automacoes", label: "Automações", icon: Zap, order: 80, status: "active",
    description: "Regras, presets e execuções de automação.",
    children: [
      a(10, "opauto", "Regras de Automação", ["automacao", "automação", "regra", "fase"], "Regras"),
      a(15, "phasemap", "Regras por Fase", ["regra", "fase", "gatilho", "disparo", "trigger"], "Regras"),
      a(20, "amtemplates", "Presets", ["preset", "modelo", "automacao"], "Regras"),
      a(30, "finauto", "Automações Financeiras", ["automacao", "financeiro"], "Regras"),
      a(35, "simfase", "Simulação", ["simulacao", "simulação", "fase", "teste"], "Execução"),
      a(40, "execmatrix", "Histórico de Execuções", ["historico", "histórico", "execucao", "execução", "log"], "Execução"),
      h(50, "auto_eventos", "Eventos e Gatilhos"),
      h(60, "auto_condicoes", "Condições"),
      h(70, "auto_acoes", "Ações e Efeitos"),
      h(80, "auto_aplicadas", "Regras Aplicadas"),
      h(100, "auto_conflitos", "Conflitos"),
      h(110, "auto_filas", "Filas"),
    ],
  },
  {
    key: "grp_comunicacao", label: "Comunicação", icon: MessageSquare, order: 90, status: "active",
    description: "Notificações e canais de comunicação.",
    children: [
      a(10, "notifications", "Notificações", ["notificacao", "aviso", "email", "whatsapp"], "Canais"),
      h(20, "com_emails", "E-mails"),
      h(30, "com_whatsapp", "WhatsApp e Mensagens"),
      h(40, "com_sms", "SMS"),
      h(50, "mod_email", "Modelos de E-mail"),
      h(60, "mod_mensagem", "Modelos de Mensagem"),
      h(70, "com_assinaturas", "Assinaturas"),
      h(80, "com_regras", "Regras de Comunicação"),
    ],
  },
  {
    key: "grp_agenda", label: "Agenda e Prazos", icon: CalendarClock, order: 100, status: "active",
    description: "Calendários, feriados e regras de prazo.",
    children: [
      // Tipos de Evento tem dono canônico na Biblioteca Operacional (não duplicar).
      h(10, "agenda_calendarios", "Calendários"),
      h(20, "agenda_feriados", "Feriados"),
      h(30, "agenda_horarios", "Horários Úteis"),
      h(40, "agenda_lembretes", "Lembretes"),
      h(50, "agenda_regras_prazo", "Regras de Prazo"),
      h(60, "agenda_escalonamentos", "Escalonamentos"),
      h(70, "agenda_disponibilidade", "Disponibilidade"),
    ],
  },
  {
    key: "grp_ia", label: "Inteligência Artificial", icon: Brain, order: 110, status: "active",
    description: "Prompts, OCR e regras de revisão humana.",
    children: [
      h(10, "ia_config", "Configurações Gerais"),
      h(20, "ia_prompts", "Prompts"),
      h(30, "ia_ocr", "OCR"),
      h(40, "ia_extracao", "Extração de Dados"),
      h(50, "ia_classificacao", "Classificação"),
      h(60, "ia_analise", "Análise Documental"),
      h(70, "ia_revisao", "Regras de Revisão Humana"),
      h(80, "ia_modelos", "Modelos e Provedores"),
    ],
  },
  {
    key: "grp_relatorios", label: "Relatórios", fullLabel: "Relatórios e Indicadores", icon: BarChart3, order: 120, status: "active",
    description: "Diagnósticos e indicadores executivos.",
    children: [
      a(10, "mgmthealth", "Diagnóstico Executivo", ["diagnostico", "saude", "indicador", "dashboard"], "Diagnósticos"),
      a(20, "diagnostics", "Diagnósticos", ["diagnostico", "relatorio"], "Diagnósticos"),
      a(30, "cfgdiagnosis", "Diagnóstico de Configuração", ["diagnostico", "config"], "Diagnósticos"),
      h(40, "rel_dashboards", "Dashboards"),
      h(50, "rel_indicadores", "Indicadores"),
      h(60, "rel_relatorios", "Relatórios"),
      h(70, "rel_exportacoes", "Exportações"),
      h(80, "rel_agendados", "Relatórios Agendados"),
    ],
  },
  {
    key: "grp_integracoes", label: "Integrações", icon: Plug, order: 130, status: "active",
    description: "Importações, exportações e serviços externos.",
    children: [
      a(10, "impexp", "Importações e Exportações", ["importacao", "exportacao", "csv", "excel"], "Dados"),
      h(20, "integ_painel", "Painel de Integrações"),
      h(30, "integ_apis", "APIs"),
      h(40, "integ_webhooks", "Webhooks"),
      h(50, "integ_armazenamento", "Armazenamento"),
      h(60, "integ_assinatura", "Assinatura Digital"),
      h(70, "integ_ocr", "OCR e Extração"),
      h(80, "integ_externos", "Serviços Externos"),
      h(90, "integ_monitoramento", "Monitoramento"),
    ],
  },
  {
    key: "grp_usuarios", label: "Usuários", fullLabel: "Usuários e Acessos", icon: Users2, order: 140, status: "active",
    description: "Usuários, equipes, cargos e permissões.",
    children: [
      a(10, "users", "Usuários", ["usuario", "user", "conta", "acesso", "login"], "Estrutura"),
      a(20, "teams", "Equipes", ["equipe", "time"], "Estrutura"),
      a(30, "departments", "Departamentos", ["departamento", "setor"], "Estrutura"),
      a(40, "rolecat", "Cargos", ["cargo", "funcao"], "Estrutura"),
      // roles e permprofiles usam o MESMO componente (RolesTab). Mostramos 1 item
      // canônico (key roles); permprofiles segue como alias/deep-link via TELAS.
      a(50, "roles", "Perfis e Permissões", ["perfil", "papel", "role", "permissao", "permissão", "acesso"], "Acessos"),
      h(70, "acc_papeis", "Papéis"),
      h(80, "acc_perm_tarefas", "Permissões de Tarefas"),
      h(90, "acc_filas", "Filas"),
      h(100, "acc_delegacoes", "Delegações"),
      h(110, "acc_alcadas", "Alçadas"),
    ],
  },
  {
    key: "grp_governanca", label: "Sistema", fullLabel: "Governança e Sistema", icon: ShieldCheck, order: 150, status: "active",
    description: "Configurações gerais, auditoria, saúde e backup.",
    children: [
      a(10, "settings", "Configurações Gerais", ["config", "configuracao", "sistema", "geral"], "Configuração"),
      a(20, "audit", "Auditoria Geral", ["auditoria", "log", "historico"], "Operação"),
      a(30, "syshealth", "Saúde do Sistema", ["saude", "saúde", "sistema", "health", "log"], "Operação"),
      a(40, "backup", "Backup", ["backup", "restauracao"], "Operação"),
      h(50, "gov_aprovacoes", "Aprovações"),
      h(60, "gov_politicas_aprov", "Políticas de Aprovação"),
      h(70, "gov_versionamento", "Versionamento"),
      h(80, "gov_publicacoes", "Publicações"),
      h(90, "gov_overrides", "Overrides e Exceções"),
      h(100, "adm_featureflags", "Feature Flags"),
      h(110, "gov_migracao", "Migração do Legado"),
    ],
  },
  {
    key: "grp_motor", label: "Motor", fullLabel: "Motor Técnico", icon: Cpu, order: 160, status: "active",
    technicalOnly: true, permission: GESTAO_PERMISSION,
    description: "Diagnóstico técnico do motor e do runtime.",
    children: [
      { key: "execmotor", label: "Visão Geral do Motor", keywords: ["motor", "executor", "tecnico"], section: "Diagnóstico", status: "active", technicalOnly: true, order: 10 },
      { key: "runtimediag", label: "Diagnóstico do Runtime", keywords: ["runtime", "diagnostico", "diagnóstico", "v2", "readiness", "gate", "workflow"], section: "Diagnóstico", status: "active", technicalOnly: true, order: 15 },
      h(20, "mt_eventos", "Eventos"),
      h(30, "mt_execucoes", "Execuções"),
      h(40, "mt_efeitos", "Efeitos Executados"),
      h(50, "mt_outbox", "Outbox"),
      h(60, "mt_idempotencia", "Idempotência"),
      h(70, "mt_conflitos", "Conflitos"),
      h(80, "mt_retry", "Retry"),
      h(90, "mt_deadletter", "Dead Letter"),
      h(100, "mt_reconciliacao", "Reconciliação"),
      h(110, "mt_logs", "Logs Técnicos"),
      h(120, "mt_metricas", "Métricas"),
    ],
  },
]
