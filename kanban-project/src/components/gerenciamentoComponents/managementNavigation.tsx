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
  BarChart3, Briefcase,
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
    // ARQUITETURA: "Automações" NÃO é módulo. Toda a automação de fase (regras,
    // simulação, histórico) e as bibliotecas de modelos vivem DENTRO do Workflow —
    // é o mesmo motor de eventos/efeitos. O Financeiro tem sua própria vitrine
    // ("Regras Financeiras por Fase") reutilizando este mesmo motor.
    key: "grp_workflow", label: "Workflow", icon: Workflow, order: 30, status: "active",
    description: "Fases, automações, regras e modelos do workflow.",
    children: [
      // Fases (nomes exatamente como a árvore aprovada)
      a(10, "macrokanban", "Workflow Macro", ["workflow", "macro", "kanban", "fase", "coluna"], "Fases"),
      a(20, "phaseiwf", "Workflow Interno", ["workflow", "interno", "passo", "fase"], "Fases"),
      a(30, "phasemodes", "Variações da Fase", ["variacao", "variação", "modo", "interno", "fase"], "Fases"),
      // Automações e regras (ex-módulo "Automações", agora dentro do Workflow)
      a(40, "opauto", "Automações por Fase", ["automacao", "automação", "efeito", "fase", "regra", "gatilho", "workflow"], "Automações e regras"),
      a(50, "crossrules", "Regras Transversais", ["regra", "transversal", "tarefa"], "Automações e regras"),
      a(60, "simfase", "Simulação", ["simulacao", "simulação", "fase", "teste"], "Automações e regras"),
      a(70, "execmatrix", "Histórico de Execuções", ["historico", "histórico", "execucao", "execução", "log"], "Automações e regras"),
      // "Tipos de Protocolo" NÃO pertence ao Workflow → mudou para o módulo
      // "Documentos e Protocolos" (é configuração operacional, não estrutura de fase).
      // Biblioteca de Modelos (sub-seção do Workflow)
      a(100, "iwtemplates", "Modelos de Workflow Interno", ["modelo", "template", "workflow", "interno"], "Biblioteca de Modelos"),
      a(110, "imtemplates", "Modelos de Variações da Fase", ["modelo", "variacao", "variação", "fase", "passo", "step"], "Biblioteca de Modelos"),
      a(120, "amtemplates", "Modelos de Automação", ["modelo", "automacao", "automação", "preset"], "Biblioteca de Modelos"),
      a(130, "crosstpl", "Modelos de Regras Transversais", ["modelo", "transversal", "tarefa", "regra"], "Biblioteca de Modelos"),
      // OCULTO: Hub redundante (as telas já são itens próprios acima).
      h(200, "workflowsphases", "Hub de Workflows das Fases"),
      h(210, "mod_wfmacro", "Modelos de Workflow Macro"),
      h(220, "wf_conclusao", "Regras de Conclusão"),
      h(230, "wf_dependencias", "Dependências e Paralelismo"),
      h(240, "wf_blockers", "Blockers"),
      h(250, "wf_politicas", "Políticas de Entrada e Saída"),
      h(260, "wf_avanco", "Avanço, Exceção e Reabertura"),
      h(270, "wf_pacotes", "Pacotes Operacionais"),
    ],
  },
  {
    key: "grp_documentos", label: "Documentos", fullLabel: "Documentos e Protocolos", icon: FileText, order: 40, status: "active",
    description: "Tipos e categorias de documento, matriz, regras e tipos de protocolo.",
    children: [
      a(10, "doctypes", "Tipos de Documento", ["documento", "certidao", "certidão", "tipo", "nascimento", "casamento", "obito"], "Cadastros"),
      a(15, "doccats", "Categorias Documentais", ["categoria", "categorias", "documental", "classificacao", "classificação"], "Cadastros"),
      // CONSOLIDADO em "Tipos de Documento" (cadastro mestre). Removido da sidebar;
      // a rota ?screen=certtypes vira alias/redirect para doctypes (page.tsx).
      h(20, "certtypes", "Tipos de Certidão"),
      a(30, "docmatrix", "Matriz Documental", ["matriz", "documento", "obrigatorio"], "Regras"),
      // Renomeado de "Aplicabilidade" → "Regras Documentais" (evita colisão com
      // "Aplicabilidade Econômica" do Financeiro). Keywords preservadas p/ busca.
      a(40, "docrules", "Regras Documentais", ["aplicabilidade", "regra", "documento", "documental"], "Regras"),
      // Tipos de Protocolo: configuração operacional (tipos/modalidades de protocolo
      // usados nos processos) — pertence a Documentos e Protocolos, não ao Workflow.
      // (Cartórios/Órgãos, por serem ENTIDADES, seguem em Pessoas e Organizações.)
      a(45, "prottypes", "Tipos de Protocolo", ["protocolo", "orgao", "órgão", "tipo", "modalidade"], "Protocolos"),
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
      // MENU FINAL do Financeiro (arquitetura canônica) — os 18 cadastros/config +
      // "Regras Financeiras por Fase" (vitrine do motor de efeitos do Workflow).
      a(10, "catalog", "Configurações Financeiras", ["configuracao", "config", "produto", "financeiro", "catalogo", "preco", "preço", "papel", "custo", "receita"], "Configuração"),
      a(60, "categories", "Categorias Financeiras", ["categoria", "financeiro"], "Configuração"),
      a(70, "coa", "Plano de Contas", ["plano", "conta", "contabil"], "Configuração"),
      a(80, "costcenters", "Centros de Custo", ["centro", "custo"], "Configuração"),
      a(50, "suppliers", "Fornecedores", ["fornecedor", "parceiro", "cartorio", "tradutor"], "Configuração"),
      a(20, "pricingtable", "Tabelas de Preços", ["preco", "preço", "tabela", "valor"], "Precificação"),
      a(40, "discrules", "Regras de Precificação", ["preco", "preço", "regra", "desconto", "economica"], "Precificação"),
      a(30, "pricing", "Aplicabilidade Econômica", ["preco", "preço", "aplicabilidade", "economica"], "Precificação"),
      // Vitrine financeira do MESMO motor de eventos/efeitos do Workflow: as regras
      // que geram receita/custo ao entrar numa fase moram aqui (não em Automações).
      a(45, "phasemap", "Regras Financeiras por Fase", ["regra", "fase", "financeiro", "gatilho", "disparo", "receita", "custo"], "Regras por fase"),
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
  // ESCOPO DEFINITIVO (16/07): módulos "Comunicação", "Integrações", "Governança e
  // Sistema", "Motor Técnico" e "Biblioteca Operacional" foram REMOVIDOS da navegação
  // (serão redesenhados em outra etapa). As telas permanecem apenas tecnicamente
  // acessíveis por ?screen=<key> (mantidas no mapa screen→component em page.tsx),
  // sem exposição na navegação comum. Grupos vazios "Agenda" e "IA" também removidos.
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
]
