// src/app/administrator/page.tsx
//
// GERENCIAMENTO GERAL — navegação lateral em ÁRVORE (padrão ERP). Sem mudança de
// regras de negócio, rotas de API ou dados. Duas views derivadas da URL:
//   • HOME  (sem parâmetro)          → visão geral opcional: módulos em CARDS + busca.
//   • TELA  (?screen=<key>)           → SHELL do Gerenciamento: uma ÚNICA árvore lateral
//                                       com TODOS os módulos (cada um expansível, itens
//                                       em lista) + a tela selecionada. A árvore é a
//                                       navegação principal e permanece visível ao trocar
//                                       de tela.
//
// Ao entrar num módulo (card da home, ?module=<grupo> legado, ou clique no título na
// árvore) abre-se DIRETAMENTE a primeira tela útil do módulo (defaultRoute) — sem página
// intermediária de cards. NÃO há mais a view de cards internos por módulo.
//
// FONTE ÚNICA de navegação: managementNavigation.tsx (módulos, seções, itens, ícones,
// descrições, keywords, permissão, status). Este arquivo apenas RENDERIZA. Deep-links
// ?screen= preservados (bookmarks continuam válidos); ?module= legado redireciona para a
// primeira tela do módulo; ALIAS de keys mantém compat.

"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { HeaderBar } from "@/src/components/header-bar"
import {
  Search, Loader2, Settings2, ChevronRight, Home,
  Menu, X, PanelLeftClose, PanelLeftOpen,
} from "lucide-react"
import dynamic from "next/dynamic"
import {
  MANAGEMENT_NAVIGATION,
  toggleAccordion,
  itensAtivosDoModulo as itensAtivos,
  itensVisiveisDoModulo as itensVisiveis,
  blocosDoModulo,
  moduloEhDireto,
  primeiraTelaDoModulo,
  moduloDaScreen as grupoDaKey,
  type ManagementNavigationItem,
} from "@/src/components/gerenciamentoComponents/managementNavigation"

// Lote 1 — telas bespoke (só as REGISTRADAS no mapa TELAS abaixo)
import {
  TeamsTab, ProtocolsTab,
  SLATab, TemplatesTab, NotificationsTab, ImportExportTab,
  BackupTab, SettingsTab,
} from "@/src/components/gerenciamentoComponents/GerenciamentoScaffolds"

// Lote 2 — Diagnóstico Executivo
import { HealthTab } from "@/src/components/gerenciamentoComponents/GerenciamentoScaffolds2"

// Lote 3 — Centro do Processo (fases): telas substituídas pelas versões reais
// (PhaseWorkflowsFasesTab / ModosInternosFasesTab) — nada a importar aqui.

// Lote 4 — Diagnóstico do Sistema
import { DiagnosticsTab } from "@/src/components/gerenciamentoComponents/GerenciamentoScaffolds4"

// Lote 5 — Biblioteca de Modelos: REMOVIDA (legado eliminado).

// Lote 6 — Cadastros do Motor + Saúde do Sistema (telas que faltavam)
import {
  ExecMatrixTab, SystemHealthTab, RoleCatalogTab,
  DocMatrixTab, ConfigVersionsTab, ConfigDiagnosisTab,
} from "@/src/components/gerenciamentoComponents/GerenciamentoScaffolds6"
import { useDadosHeaderBar } from "@/src/hooks/use-dados-headerbar"

// ============================================================
// MAPA DE TELAS (screen key → componente). Inalterado — só as views que o
// envolvem foram reorganizadas. As keys são as mesmas do deep-link ?screen=.
// ============================================================
const OverviewTab = dynamic(() => import("@/src/components/gerenciamentoComponents/OverviewTab"), {
  ssr: false, loading: () => <CarregandoTela />,
})
const UsersTab = dynamic(() => import("@/src/components/gerenciamentoComponents/UsersTab"), {
  ssr: false, loading: () => <CarregandoTela />,
})
const RolesTab = dynamic(() => import("@/src/components/gerenciamentoComponents/RolesTab"), { ssr: false })
const AplicabilidadeEconomicaTab = dynamic(() => import("@/src/components/gerenciamentoComponents/AplicabilidadeEconomicaTab"), { ssr: false, loading: () => <CarregandoTela /> })
const CatalogTab = dynamic(() => import("@/src/components/gerenciamentoComponents/CatalogTab"), {
  ssr: false, loading: () => <CarregandoTela />,
})

const CentrosCustoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/CentrosCustoTab"), { ssr: false, loading: () => <CarregandoTela /> })
const CategoriasTab = dynamic(() => import("@/src/components/gerenciamentoComponents/CategoriasTab"), { ssr: false, loading: () => <CarregandoTela /> })
const ContasTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ContasTab"), { ssr: false, loading: () => <CarregandoTela /> })
const BancosTab = dynamic(() => import("@/src/components/gerenciamentoComponents/BancosTab"), { ssr: false, loading: () => <CarregandoTela /> })
const FornecedoresTab = dynamic(() => import("@/src/components/gerenciamentoComponents/FornecedoresTab"), { ssr: false, loading: () => <CarregandoTela /> })
const CambioTab = dynamic(() => import("@/src/components/gerenciamentoComponents/CambioTab"), { ssr: false, loading: () => <CarregandoTela /> })
const ImpostosTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ImpostosTab"), { ssr: false, loading: () => <CarregandoTela /> })
const PlanoContasTab = dynamic(() => import("@/src/components/gerenciamentoComponents/PlanoContasTab"), { ssr: false, loading: () => <CarregandoTela /> })
const CarteirasTab = dynamic(() => import("@/src/components/gerenciamentoComponents/CarteirasTab"), { ssr: false, loading: () => <CarregandoTela /> })
const ProdutosTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ProdutosTab"), { ssr: false, loading: () => <CarregandoTela /> })
const TabelaValoresTab = dynamic(() => import("@/src/components/gerenciamentoComponents/TabelaValoresTab"), { ssr: false, loading: () => <CarregandoTela /> })
const CondicoesPagamentoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/CondicoesPagamentoTab"), { ssr: false, loading: () => <CarregandoTela /> })
const RegrasComissaoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/RegrasComissaoTab"), { ssr: false, loading: () => <CarregandoTela /> })
const RegrasDescontoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/RegrasDescontoTab"), { ssr: false, loading: () => <CarregandoTela /> })
const ProdutosServicosTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ProdutosServicosTab"), { ssr: false, loading: () => <CarregandoTela /> })
const MoedasTab = dynamic(() => import("@/src/components/gerenciamentoComponents/MoedasTab"), { ssr: false, loading: () => <CarregandoTela /> })
const FormasPagamentoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/FormasPagamentoTab"), { ssr: false, loading: () => <CarregandoTela /> })
const TaxasPagamentoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/TaxasPagamentoTab"), { ssr: false, loading: () => <CarregandoTela /> })
const TipoProcessoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/TipoProcessoTab"), { ssr: false, loading: () => <CarregandoTela /> })
const MacroKanbanTab = dynamic(() => import("@/src/components/gerenciamentoComponents/MacroKanbanTab"), { ssr: false, loading: () => <CarregandoTela /> })
// LEGADO REMOVIDO — Biblioteca de Modelos (Workflow Interno / Variações da Fase / Automação)
// eliminada. Fonte de verdade é o Workflow Macro/Interno + config real por fase. Ver migração.
const ModosInternosFasesTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ModosInternosFasesTab"), { ssr: false, loading: () => <CarregandoTela /> })
const PhaseWorkflowsFasesTab = dynamic(() => import("@/src/components/gerenciamentoComponents/PhaseWorkflowsFasesTab"), { ssr: false, loading: () => <CarregandoTela /> })
const PhaseAutomationsFasesTab = dynamic(() => import("@/src/components/gerenciamentoComponents/PhaseAutomationsFasesTab"), { ssr: false, loading: () => <CarregandoTela /> })
const DepartamentosTab = dynamic(() => import("@/src/components/gerenciamentoComponents/DepartamentosTab"), { ssr: false, loading: () => <CarregandoTela /> })
const TiposDocumentoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/TiposDocumentoTab"), { ssr: false, loading: () => <CarregandoTela /> })
const CategoriasDocumentaisTab = dynamic(() => import("@/src/components/gerenciamentoComponents/CategoriasDocumentaisTab"), { ssr: false, loading: () => <CarregandoTela /> })
const RuntimeWorkflowDiagnostics = dynamic(() => import("@/src/components/gerenciamentoComponents/RuntimeWorkflowDiagnostics"), { ssr: false, loading: () => <CarregandoTela /> })
const OrgaosProtocoloTab = dynamic(() => import("@/src/components/gerenciamentoComponents/OrgaosProtocoloTab"), { ssr: false, loading: () => <CarregandoTela /> })
const MatrizDocumentalTab = dynamic(() => import("@/src/components/gerenciamentoComponents/MatrizDocumentalTab"), { ssr: false, loading: () => <CarregandoTela /> })
const RegrasDocumentaisTab = dynamic(() => import("@/src/components/gerenciamentoComponents/RegrasDocumentaisTab"), { ssr: false, loading: () => <CarregandoTela /> })
const LogAuditoriaTab = dynamic(() => import("@/src/components/gerenciamentoComponents/LogAuditoriaTab"), { ssr: false, loading: () => <CarregandoTela /> })
const SimulacaoFaseTab = dynamic(() => import("@/src/components/gerenciamentoComponents/SimulacaoFaseTab"), { ssr: false, loading: () => <CarregandoTela /> })
const ExecutorMotorTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ExecutorMotorTab"), { ssr: false, loading: () => <CarregandoTela /> })
// ARQUITETURA NOVA — imports das telas de Tarefa Transversal removidos (telas
// retiradas da navegação; criavam tarefas nativas, agora do Workflow Interno).
const PerfisPermissaoMotorTab = dynamic(() => import("@/src/components/gerenciamentoComponents/PerfisPermissaoMotorTab"), { ssr: false, loading: () => <CarregandoTela /> })
const MigracaoMotorTab = dynamic(() => import("@/src/components/gerenciamentoComponents/MigracaoMotorTab"), { ssr: false, loading: () => <CarregandoTela /> })
// REESTRUTURAÇÃO 25/07 — telas dedicadas dos cadastros que já tinham API e antes
// só existiam como modal dentro de Tipos de Processo (países/modalidades) ou como
// scaffold sem persistência (países). Mesmas rotas, mesmo contrato, mesmas regras.
const CatalogoFasesTab = dynamic(() => import("@/src/components/gerenciamentoComponents/CatalogoFasesTab"), { ssr: false, loading: () => <CarregandoTela /> })
const ModalidadesTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ModalidadesTab"), { ssr: false, loading: () => <CarregandoTela /> })
const PaisesRegioesTab = dynamic(() => import("@/src/components/gerenciamentoComponents/PaisesRegioesTab"), { ssr: false, loading: () => <CarregandoTela /> })
const IntegracoesTab = dynamic(() => import("@/src/components/gerenciamentoComponents/IntegracoesTab"), { ssr: false, loading: () => <CarregandoTela /> })
// CONSULTAS CONSOLIDADAS da configuração por tipo de processo — todas sobre o MESMO
// read-model (/api/gerenciamento/configuracao-processo). Só leitura: a edição segue
// nas telas donas (Fluxos, Tipos de Processo, Automações...).
const SLAConfiguracaoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ConfiguracaoProcessoViews").then(m => m.SLAConfiguracaoTab), { ssr: false, loading: () => <CarregandoTela /> })
const VersoesConfiguracaoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ConfiguracaoProcessoViews").then(m => m.VersoesConfiguracaoTab), { ssr: false, loading: () => <CarregandoTela /> })
const ConfiguracoesGeraisProcessoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ConfiguracaoProcessoViews").then(m => m.ConfiguracoesGeraisProcessoTab), { ssr: false, loading: () => <CarregandoTela /> })
const TransicoesTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ConfiguracaoProcessoViews").then(m => m.TransicoesTab), { ssr: false, loading: () => <CarregandoTela /> })
const DiagnosticoConfiguracaoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ConfiguracaoProcessoViews").then(m => m.DiagnosticoConfiguracaoTab), { ssr: false, loading: () => <CarregandoTela /> })
// CADASTROS GENÉRICOS — a forma de cada um vem do registro único no backend.
const CadastroGenericoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/CadastroGenericoTab"), { ssr: false, loading: () => <CarregandoTela /> })
const cad = (entidade: string) => {
  const Tela = () => <CadastroGenericoTab entidade={entidade} />
  Tela.displayName = `Cadastro(${entidade})`
  return Tela
}
// CONFIGURAÇÃO GLOBAL (ConfiguracaoSistema) — dois grupos, uma fonte.
const ConfiguracoesGeraisSistemaTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ConfiguracaoSistemaTab").then(m => m.ConfiguracoesGeraisSistemaTab), { ssr: false, loading: () => <CarregandoTela /> })
const IdentidadeVisualTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ConfiguracaoSistemaTab").then(m => m.IdentidadeVisualTab), { ssr: false, loading: () => <CarregandoTela /> })
// DIAGNÓSTICOS — quatro lentes sobre o mesmo read-model.
const DiagnosticoSistemaTab = dynamic(() => import("@/src/components/gerenciamentoComponents/DiagnosticoViews").then(m => m.DiagnosticoSistemaTab), { ssr: false, loading: () => <CarregandoTela /> })
const DiagnosticoExecutivoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/DiagnosticoViews").then(m => m.DiagnosticoExecutivoTab), { ssr: false, loading: () => <CarregandoTela /> })
const SaudeSistemaTab = dynamic(() => import("@/src/components/gerenciamentoComponents/DiagnosticoViews").then(m => m.SaudeSistemaTab), { ssr: false, loading: () => <CarregandoTela /> })
const HistoricoExecucoesTab = dynamic(() => import("@/src/components/gerenciamentoComponents/DiagnosticoViews").then(m => m.HistoricoExecucoesTab), { ssr: false, loading: () => <CarregandoTela /> })
// GESTÃO FINANCEIRA (consulta) + exportações + índice de dashboards.
const CreditoTab = dynamic(() => import("@/src/components/gerenciamentoComponents/FinanceiroGestaoViews").then(m => m.CreditoTab), { ssr: false, loading: () => <CarregandoTela /> })
const DocumentosFinanceirosTab = dynamic(() => import("@/src/components/gerenciamentoComponents/FinanceiroGestaoViews").then(m => m.DocumentosFinanceirosTab), { ssr: false, loading: () => <CarregandoTela /> })
const ExportacoesTab = dynamic(() => import("@/src/components/gerenciamentoComponents/ExportacoesTab"), { ssr: false, loading: () => <CarregandoTela /> })
const DashboardsTab = dynamic(() => import("@/src/components/gerenciamentoComponents/DashboardsTab"), { ssr: false, loading: () => <CarregandoTela /> })

// cada catálogo do menu aponta pro CatalogTab com a chave do mockup
const cat = (k: string) => {
  const Tela = () => <CatalogTab catalogKey={k} />
  Tela.displayName = `CatalogTab(${k})`
  return Tela
}

const TELAS: Record<string, React.ComponentType> = {
  // reais
  overview: OverviewTab,
  users: UsersTab,
  roles: RolesTab,

  // catálogos (genérico CatalogTab)
  doctypes: TiposDocumentoTab,
  doccats: CategoriasDocumentaisTab,
  docrules: RegrasDocumentaisTab, // fonte única de Regras Documentais (absorve a Matriz)
  // certtypes NÃO tem tela própria: consolidado em doctypes (Tipos de Documento).
  // O deep-link ?screen=certtypes é resolvido por ALIAS_TELAS → doctypes (abaixo).
  currencies: MoedasTab,
  fx: CambioTab,
  methods: FormasPagamentoTab,
  banks: BancosTab,
  accounts: ContasTab,
  wallets: CarteirasTab,
  coa: PlanoContasTab,
  // As concentradoras legadas (estruturafin, precificacao, fornecedoresconc, comercial,
  // pagamentos, integracaofin) foram removidas: eram invólucros de abas que só reusavam
  // as telas reais. Os deep-links continuam vivos por ALIAS_TELAS → tela dona da função.
  categories: CategoriasTab,
  costcenters: CentrosCustoTab,
  taxes: ImpostosTab,
  fees: TaxasPagamentoTab,
  organs: OrgaosProtocoloTab,
  prottypes: cad("tipos-protocolo"),
  "prottypes-rascunho": cat("op_prottypes"),
  suppliers: FornecedoresTab,
  departments: DepartamentosTab,
  // Países e Regiões: era um scaffold de catálogo sem persistência; agora é a tela
  // real sobre a MESMA API que o modal "Gerenciar países" já usava. Key preservada.
  countrycatalog: PaisesRegioesTab,
  modalidades: ModalidadesTab,
  // Processos → Estrutura → Fases: cadastro ÚNICO das fases (CatalogoFase).
  fases: CatalogoFasesTab,

  // bespoke (lote 1)
  // Cadastros REAIS (motor genérico). Os rascunhos do mockup seguem acessíveis
  // por ?screen=<key>-rascunho.
  teams: cad("grupos"),
  "teams-rascunho": TeamsTab,
  marcos: cad("marcos"),
  servcats: cad("categorias-servico"),
  orgcats: cad("categorias-organizacao"),
  // Automações por fase — MESMA tela para os itens oficiais "Financeiras" e
  // "Eventos" (só muda a aba inicial). A key antiga `opauto` não tem mais registro
  // próprio: vira alias para `autofin` (deep-link preservado).
  autofin: function AutomacoesFinanceiras() { return <PhaseAutomationsFasesTab kindInicial="financial" /> },
  autoevt: function AutomacoesEventos() { return <PhaseAutomationsFasesTab kindInicial="event" /> },
  protocols: ProtocolsTab,
  // SLA consolidado (real, sobre a configuração de cada processo). O rascunho antigo
  // continua acessível por ?screen=sla-rascunho.
  sla: SLAConfiguracaoTab,
  "sla-rascunho": SLATab,
  proccfg: ConfiguracoesGeraisProcessoTab,
  transicoes: TransicoesTab,
  integracoes: IntegracoesTab,
  governanca: function GovernancaFinanceira() { return <LogAuditoriaTab escopo="financeiro" /> },
  templates: cad("modelos"),
  "templates-rascunho": TemplatesTab,
  notifications: cad("notificacoes"),
  "notifications-rascunho": NotificationsTab,
  audit: LogAuditoriaTab,
  impexp: ExportacoesTab,
  "impexp-rascunho": ImportExportTab,
  backup: BackupTab,
  settings: ConfiguracoesGeraisSistemaTab,
  "settings-rascunho": SettingsTab,
  identidade: IdentidadeVisualTab,

  // bespoke (lote 2)
  proctypes: TipoProcessoTab,
  macrokanban: MacroKanbanTab,
  mgmthealth: DiagnosticoExecutivoTab,
  "mgmthealth-rascunho": HealthTab,

  // bespoke (lote 3)
  phaseiwf: PhaseWorkflowsFasesTab,
  phasemodes: ModosInternosFasesTab,

  // bespoke (lote 4)
  catalog: ProdutosTab,
  // `catalogmestre` (tela técnica sobre ItemCatalogo) foi REMOVIDA: o cadastro
  // mestre continua como estrutura interna (dados/ids/vínculos intactos), mas a
  // única tela de usuário é `products` (Catálogo de Serviços). Alias abaixo.
  products: ProdutosServicosTab,
  // honorariums (CRUD legado da tabela Honorario) removido: honorário é item do
  // cadastro mestre + Configuração Financeira + Tabela de Preços. Alias abaixo.
  paycond: CondicoesPagamentoTab,
  commrules: RegrasComissaoTab,
  discrules: RegrasDescontoTab,
  pricing: AplicabilidadeEconomicaTab,
  // ARQUITETURA NOVA — telas de Regras/Modelos de Tarefa Transversal REMOVIDAS da
  // interface (criavam tarefas nativas da operação; agora exclusivo do Workflow
  // Interno). Componentes e dados preservados, apenas inacessíveis pela navegação.
  simfase: SimulacaoFaseTab,
  execmotor: ExecutorMotorTab,
  runtimediag: RuntimeWorkflowDiagnostics,
  migmotor: MigracaoMotorTab,
  diagnostics: DiagnosticoSistemaTab,
  "diagnostics-rascunho": DiagnosticsTab,
  dashboards: DashboardsTab,
  credito: CreditoTab,
  docfin: DocumentosFinanceirosTab,
  accaudit: function AuditoriaDeAcessos() { return <LogAuditoriaTab escopo="acessos" /> },

  // bespoke (lote 6) — Cadastros do Motor + Saúde
  rolecat: cad("cargos"),
  "rolecat-rascunho": RoleCatalogTab,
  permprofiles: RolesTab,
  // Usuários e Acessos → Permissões (perfis de permissão do motor).
  permmotor: PerfisPermissaoMotorTab,
  pricingtable: TabelaValoresTab,
  docmatrix: MatrizDocumentalTab,
  // Versões e Diagnóstico de Configuração passam a ser telas REAIS sobre o
  // read-model; os rascunhos seguem acessíveis por ?screen=<key>-rascunho.
  cfgversions: VersoesConfiguracaoTab,
  "cfgversions-rascunho": ConfigVersionsTab,
  cfgdiagnosis: DiagnosticoConfiguracaoTab,
  "cfgdiagnosis-rascunho": ConfigDiagnosisTab,
  execmatrix: HistoricoExecucoesTab,
  "execmatrix-rascunho": ExecMatrixTab,
  syshealth: SaudeSistemaTab,
  "syshealth-rascunho": SystemHealthTab,
}

function CarregandoTela() {
  return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/60" /></div>
}

// fallback de segurança (não deve aparecer — todas as telas estão registradas)
function EmBreve({ titulo }: { titulo: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-10 text-center">
      <Settings2 className="mx-auto mb-3 h-10 w-10 text-white/40" />
      <div className="font-semibold text-white/90">{titulo}</div>
      <div className="mt-1 text-sm text-white/50">Esta área será portada em breve.</div>
    </div>
  )
}

// ── helpers de navegação: TODOS derivam da FONTE ÚNICA (managementNavigation).
// Nenhuma regra de submenu/seção vive neste componente — só renderização.
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

// ALIASES DE MÓDULO: ?module=<key> antigo → módulo oficial correspondente.
// "Pessoas e Organizações" virou "Órgãos e Organizações" (mesmo conteúdo);
// "Automações" voltou a ser módulo próprio (saiu de dentro do Workflow).
const ALIAS_MODULOS: Record<string, string> = { grp_pessoas: "grp_orgaos" }
const resolverModulo = (k: string): string => ALIAS_MODULOS[k] || k

interface UserData { nome: string; email?: string; tipo?: string }

type View = "home" | "screen"

export default function GerenciamentoPage() {
  const router = useRouter()
  const { pode, carregando: permLoading } = usePermissoes()
  const isAdmin = pode("usuarios.gerenciar")

  // ALIASES DE TELA: keys antigas → tela real (bookmarks/deep-links continuam
  // funcionando). NENHUMA rota antiga foi perdida na reestruturação de 25/07:
  //  • certtypes  → doctypes  (Tipos de Certidão consolidado em Tipos de Documento)
  //  • opauto     → autofin   (Automações por Fase virou Automações › Financeiras;
  //                            é a MESMA tela, só muda a aba inicial)
  // Removidas as telas LEGADAS (concentradoras que só reusavam abas + CRUD de
  // Honorário): cada key antiga aponta para a tela que hoje é dona da função.
  const ALIAS_TELAS: Record<string, string> = {
    certtypes: "doctypes",
    opauto: "autofin",
    estruturafin: "currencies",      // Estrutura Financeira → Moedas (1ª aba real)
    precificacao: "pricingtable",    // Precificação → Tabelas de Preços
    comercial: "paycond",            // Comercial → Condições de Pagamento
    pagamentos: "methods",           // Pagamentos → Formas de Pagamento
    fornecedoresconc: "suppliers",   // Fornecedores (concentradora) → Fornecedores
    integracaofin: "pricing",        // Integração Financeira → Aplicabilidade Econômica
    // Cadastro mestre: a tela técnica saiu da navegação; o cadastro segue vivo por
    // baixo. Toda URL antiga cai na tela oficial (Serviços › Catálogo de Serviços).
    catalogmestre: "products",       // Catálogo Mestre (tela técnica) → Catálogo de Serviços
    honorariums: "products",         // Honorários (legado) → Catálogo de Serviços
  }
  const resolverTela = useCallback((k: string | null): string => {
    if (!k) return "overview"
    return ALIAS_TELAS[k] || k
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── estado derivado da URL ─────────────────────────────────────────────────
  const [view, setView] = useState<View>("home")
  const [activeModule, setActiveModule] = useState<string | null>(null) // group key
  const [activeScreen, setActiveScreen] = useState<string | null>(null) // screen key
  const [busca, setBusca] = useState("")                                 // busca da home
  const [expandedModule, setExpandedModule] = useState<string | null>(null) // árvore: 1 módulo aberto
  const [navCollapsed, setNavCollapsed] = useState(false)                // árvore recolhida (rail)
  const [mobileNav, setMobileNav] = useState(false)

  // Usuário + processos + árvores do HeaderBar: hook único (sem efeito por tela).
  const { user, processos, arvores } = useDadosHeaderBar()

  // resolve a primeira tela útil de um módulo (defaultRoute). Se o módulo não tiver
  // tela ativa (não deveria, entre os visíveis), devolve null.
  const primeiraTela = useCallback((gkey: string): string | null => {
    const g = MANAGEMENT_NAVIGATION.find((x) => x.key === gkey)
    return g ? primeiraTelaDoModulo(g, pode) ?? null : null
  }, [pode])

  // Entrada SEM ?screen=: abre a ÚLTIMA tela usada (se ainda válida/permitida) ou a
  // 1ª tela permitida do 1º módulo visível. Nunca renderiza home de cards.
  const telaInicialPadrao = useCallback((): string | null => {
    if (typeof window !== "undefined") {
      const last = localStorage.getItem("gerenciamento:lastScreen")
      if (last && TELAS[last]) {
        const g = grupoDaKey(last)
        if (g && !g.hiddenAsModule && (!g.permission || pode(g.permission))) return last
      }
    }
    for (const g of MANAGEMENT_NAVIGATION) {
      if (g.hiddenAsModule || (g.permission && !pode(g.permission))) continue
      const first = primeiraTelaDoModulo(g, pode)
      if (first) return first
    }
    return null
  }, [pode])

  // lê a view atual a partir da URL (deep-link ?screen= ; ?module= legado → 1ª tela)
  const sincronizarDaURL = useCallback(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const screen = params.get("screen")
    const moduleKey = params.get("module")
    if (screen) {
      const key = resolverTela(screen)
      const g = grupoDaKey(key)
      setActiveScreen(key)
      setActiveModule(g?.key ?? null)
      setExpandedModule(g?.key ?? null)
      setView("screen")
    } else if (moduleKey && MANAGEMENT_NAVIGATION.some((g) => g.key === resolverModulo(moduleKey))) {
      // ?module= legado → abre direto a 1ª tela útil (sem página intermediária de cards).
      const alvoModulo = resolverModulo(moduleKey)
      const g = MANAGEMENT_NAVIGATION.find((x) => x.key === alvoModulo)!
      const first = primeiraTelaDoModulo(g, pode)
      if (first) {
        setActiveScreen(first); setActiveModule(alvoModulo); setExpandedModule(alvoModulo); setView("screen")
      } else {
        setView("home"); setActiveModule(null); setActiveScreen(null)
      }
    } else {
      // SEM tela na URL → entra direto na última/1ª tela (nunca home de cards).
      const alvo = telaInicialPadrao()
      if (alvo) {
        const g = grupoDaKey(alvo)
        const url = new URL(window.location.href); url.searchParams.set("screen", alvo)
        window.history.replaceState({}, "", url.toString())
        setActiveScreen(alvo); setActiveModule(g?.key ?? null); setExpandedModule(g?.key ?? null); setView("screen")
      } else {
        setView("home"); setActiveModule(null); setActiveScreen(null)
      }
    }
  }, [pode, resolverTela, telaInicialPadrao])

  // navegação: atualiza URL (pushState → botão voltar do browser funciona) + estado
  const pushURL = (params: { screen?: string }) => {
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    url.searchParams.delete("screen"); url.searchParams.delete("module"); url.searchParams.delete("tab")
    if (params.screen) url.searchParams.set("screen", params.screen)
    window.history.pushState({}, "", url.toString())
  }

  // "Gerenciamento" (raiz do breadcrumb) → 1ª/última tela útil, nunca home de cards.
  const irParaHome = () => {
    const alvo = telaInicialPadrao()
    if (alvo) { irParaTela(alvo); return }
    pushURL({}); setView("home"); setActiveModule(null); setActiveScreen(null); setBusca(""); setMobileNav(false)
  }
  // clique no TÍTULO do módulo (árvore ou card da home): abre a 1ª tela útil + expande.
  const irParaModulo = (gkey: string) => {
    const first = primeiraTela(gkey)
    if (first) { irParaTela(first); return }
    // módulo sem tela ativa: apenas expande na árvore (não deve ocorrer entre visíveis).
    setExpandedModule(gkey); setActiveModule(gkey)
  }
  const irParaTela = (key: string) => {
    const k = resolverTela(key)
    const g = grupoDaKey(k)
    pushURL({ screen: k })
    if (typeof window !== "undefined") localStorage.setItem("gerenciamento:lastScreen", k)
    setActiveScreen(k); setActiveModule(g?.key ?? null); setExpandedModule(g?.key ?? null)
    setView("screen"); setBusca(""); setMobileNav(false)
  }
  // árvore: expandir/recolher um módulo SEM navegar (peek). Accordion — 1 por vez.
  const toggleModulo = (gkey: string) => {
    setExpandedModule((prev) => toggleAccordion(prev, gkey))
  }

  const handleLogout = () => {
    localStorage.removeItem("authToken"); localStorage.removeItem("user"); router.push("/login")
  }


  // montagem: deep-link + sincronização com botão voltar/avançar do browser.
  // CRÍTICO (accordion): este sync SÓ pode rodar no MOUNT e no POPSTATE — nunca a
  // cada render. `pode` (usePermissoes) não é memoizado → sincronizarDaURL muda de
  // identidade a cada render; se este effect dependesse dela, re-rodaria sempre e
  // RESETARIA expandedModule para o grupo da tela ativa, desfazendo o toggle do
  // usuário (abria-e-reabria / não fechava). Usamos um ref p/ manter a versão
  // atual e deps [] para o effect não re-executar em re-renders.
  const sincronizarRef = useRef(sincronizarDaURL)
  useEffect(() => { sincronizarRef.current = sincronizarDaURL }, [sincronizarDaURL])
  useEffect(() => {
    sincronizarRef.current()
    const onPop = () => sincronizarRef.current()
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  // Porteiro da rota: sem token vai para o login; sem perfil de administrador
  // volta para o painel. Só navegação — nenhuma escrita de estado.
  useEffect(() => {
    const token = localStorage.getItem("authToken")
    if (!token) { router.push("/login"); return }
    if (!permLoading && !isAdmin) router.push("/dashboard")
  }, [isAdmin, permLoading, router])

  if (permLoading) {
    return (
      <div className="relative min-h-screen text-white">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center" />
        <div className="flex min-h-screen items-center justify-center bg-slate-950/70">
          <div className="text-center">
            <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-white" />
            <p className="text-lg">Verificando permissões…</p>
          </div>
        </div>
      </div>
    )
  }
  if (!isAdmin) return null

  // ── módulos visíveis: os 11 oficiais, na ORDEM OFICIAL (order ascendente).
  // Entra quem tem item renderizável OU é módulo direto (screen própria, sem submenu).
  const modulosVisiveis = MANAGEMENT_NAVIGATION
    .filter((g) => !g.hiddenAsModule)
    .filter((g) => !g.permission || pode(g.permission))
    .map((g) => ({ g, itens: itensVisiveis(g, pode) }))
    .filter((m) => m.itens.length > 0 || !!m.g.screen)
    .sort((x, y) => x.g.order - y.g.order)

  // ── busca global (home): módulos + telas ────────────────────────────────────
  const q = norm(busca.trim())
  const resultados = q
    ? MANAGEMENT_NAVIGATION
        .filter((g) => !g.permission || pode(g.permission))
        .flatMap((g) => [
          // módulo SEM submenu (ex.: Visão Geral) também é alcançável pela busca
          ...(moduloEhDireto(g, pode)
            ? [{
                key: g.screen!,
                label: g.fullLabel || g.label,
                modulo: g.fullLabel || g.label,
                secao: "",
                hay: norm([g.label, g.fullLabel ?? "", g.screen ?? "", ...(g.keywords ?? [])].join(" ")),
              }]
            : []),
          ...itensAtivos(g, pode).map((it) => ({
            key: it.key,
            label: it.label,
            modulo: g.fullLabel || g.label,
            secao: it.section || "",
            hay: norm([it.label, it.fullLabel ?? "", it.key, g.label, g.fullLabel ?? "", it.section ?? "", ...(it.keywords ?? [])].join(" ")),
          })),
        ])
        .filter((r) => r.hay.includes(q))
        .slice(0, 40)
    : []

  const moduloAtivo = activeModule ? MANAGEMENT_NAVIGATION.find((g) => g.key === activeModule) : undefined
  const TelaAtiva = activeScreen ? TELAS[activeScreen] : undefined
  const itemAtivo = activeScreen ? moduloAtivo?.children?.find((it) => it.key === activeScreen) : undefined
  const labelTela = activeScreen
    ? itemAtivo?.label
      ?? (moduloAtivo?.screen === activeScreen ? (moduloAtivo.fullLabel || moduloAtivo.label) : undefined)
      ?? "Tela"
    : ""
  // seção (agrupamento interno) da tela ativa — entra no breadcrumb quando existe.
  const secaoTela = itemAtivo?.section

  // classes de superfície — contraste real (fundo semissólido, blur discreto)
  const PANEL = "rounded-2xl border border-white/10 bg-slate-900/75 backdrop-blur-sm"

  return (
    <div className="relative min-h-screen overflow-x-hidden text-white">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
      {/* Scrim sólido: garante leitura sobre o fundo (menos transparência/blur excessivo) */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-slate-950/72" />

      <HeaderBar
        title="Gerenciamento Geral"
        subtitle="Cadastros, regras, valores, automações, permissões e configurações"
        userName={user.nome} userRole={user.tipo || "Usuário"} userEmail={user.email || ""}
        projetos={[]} processos={processos} arvores={arvores} onLogout={handleLogout}
      />

      <main className="relative mx-auto max-w-[1560px] px-5 py-7 md:px-9 md:pt-8">
        {/* ══════════════════════ HOME — MÓDULOS EM CARDS ══════════════════════ */}
        {view === "home" ? (
          <section aria-label="Módulos do Gerenciamento">
            <header className="mb-6">
              <h1 className="text-[30px] font-bold tracking-tight text-white md:text-[32px]">Gerenciamento Geral</h1>
              <p className="mt-1.5 max-w-3xl text-[15px] text-white/60">
                Cadastros, regras, valores, automações, permissões e configurações.
              </p>
              {/* Busca global */}
              <div className="relative mt-5 max-w-2xl">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/45" />
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar configuração, módulo ou tela…"
                  aria-label="Buscar configuração, módulo ou tela"
                  className="w-full rounded-xl border border-white/12 bg-slate-900/70 py-3.5 pl-12 pr-11 text-[15px] text-white placeholder:text-white/45 focus:border-white/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                />
                {busca ? (
                  <button
                    onClick={() => setBusca("")}
                    aria-label="Limpar busca"
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-white/50 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </header>

            {q ? (
              // ── resultados da busca ──────────────────────────────────────────
              <div className={`${PANEL} p-2.5`}>
                {resultados.length === 0 ? (
                  <div className="px-3 py-8 text-center text-sm text-white/50">Nada encontrado para “{busca}”.</div>
                ) : (
                  <ul className="divide-y divide-white/5">
                    {resultados.map((r) => (
                      <li key={`${r.modulo}-${r.key}`}>
                        <button
                          onClick={() => irParaTela(r.key)}
                          className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-medium text-white">{r.label}</span>
                            <span className="mt-0.5 block truncate text-[12.5px] text-white/50">
                              {r.modulo}{r.secao ? ` › ${r.secao}` : ""}
                            </span>
                          </span>
                          <ChevronRight className="h-4 w-4 flex-none text-white/40" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              // ── grid de cards de módulo ──────────────────────────────────────
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {modulosVisiveis.map(({ g }) => {
                  const Icon = g.icon
                  return (
                    <button
                      key={g.key}
                      onClick={() => irParaModulo(g.key)}
                      className="group flex min-h-[188px] flex-col rounded-2xl border border-white/10 bg-slate-900/75 p-5 text-left backdrop-blur-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-white/25 hover:bg-slate-900/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                    >
                      <div className="mb-3.5 flex h-12 w-12 flex-none items-center justify-center rounded-xl border border-white/10 bg-white/[0.07] text-white/85 transition-colors group-hover:bg-white/[0.12]">
                        {Icon ? <Icon className="h-6 w-6" /> : <Settings2 className="h-6 w-6" />}
                      </div>
                      <h2 className="text-[19px] font-semibold leading-tight text-white">{g.fullLabel || g.label}</h2>
                      <p className="mt-1.5 flex-1 text-[14px] leading-snug text-white/55">{g.description || ""}</p>
                      <span className="mt-4 inline-flex items-center gap-1 text-[14px] font-medium text-white/80 group-hover:text-white">
                        Acessar <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        ) : null}

        {/* ═══════════ SHELL DO GERENCIAMENTO — ÁRVORE LATERAL ÚNICA + CONTEÚDO ═══════════ */}
        {/* Um ÚNICO layout: a árvore lateral (fonte única: managementNavigation) lista
            TODOS os módulos, cada um expansível com seus itens em LISTA. É a navegação
            principal e permanece visível/fixa ao trocar de tela. O conteúdo é sempre a
            tela selecionada — NÃO há página intermediária de cards por módulo. */}
        {view === "screen" && moduloAtivo ? (
          <section aria-label="Gerenciamento">
            {/* abrir árvore em mobile */}
            <button
              onClick={() => setMobileNav(true)}
              aria-label="Abrir navegação do Gerenciamento"
              className="mb-3 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.08] px-3 py-2 text-[13px] md:hidden"
            >
              <Menu className="h-4 w-4" /> {moduloAtivo.fullLabel || moduloAtivo.label}
            </button>

            {mobileNav ? (
              <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setMobileNav(false)} aria-hidden="true" />
            ) : null}

            <div className="flex items-start gap-5">
              {/* ÁRVORE LATERAL — TODOS os módulos; accordion (1 módulo aberto por vez) */}
              <aside
                aria-label="Navegação do Gerenciamento"
                className={`mgmt-scroll fixed left-0 top-0 z-40 h-full flex-none overflow-y-auto overflow-x-hidden border-r border-white/10 bg-slate-900/95 p-3 transition-transform duration-200 motion-reduce:transition-none md:sticky md:top-4 md:z-auto md:h-auto md:max-h-[calc(100vh-96px)] md:rounded-2xl md:border md:bg-slate-900/80 md:backdrop-blur-sm ${mobileNav ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 ${navCollapsed ? "md:w-[60px]" : "w-[280px] md:w-[272px]"}`}
              >
                {navCollapsed ? (
                  // modo recolhido (rail com ícones de TODOS os módulos)
                  <div className="hidden flex-col items-center gap-2 md:flex">
                    <button
                      onClick={() => setNavCollapsed(false)}
                      aria-label="Expandir navegação"
                      title="Expandir navegação"
                      className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                    >
                      <PanelLeftOpen className="h-5 w-5" />
                    </button>
                    {modulosVisiveis.map(({ g }) => {
                      const Icon = g.icon
                      const ativo = activeModule === g.key
                      return (
                        <button
                          key={g.key}
                          onClick={() => irParaModulo(g.key)}
                          title={g.fullLabel || g.label}
                          aria-label={g.fullLabel || g.label}
                          aria-current={ativo ? "true" : undefined}
                          className={`flex h-10 w-10 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                            ativo ? "bg-white/[0.14] text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
                          }`}
                        >
                          {Icon ? <Icon className="h-5 w-5" /> : <Settings2 className="h-5 w-5" />}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <>
                    <div className="mb-2 flex items-center justify-between gap-2 px-1">
                      <button
                        onClick={irParaHome}
                        className="flex min-w-0 items-center gap-2 text-left text-[13px] font-bold uppercase tracking-wide text-white/75 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                        title="Início do Gerenciamento"
                      >
                        <Home className="h-4 w-4 flex-none text-white/60" />
                        <span className="truncate">Gerenciamento</span>
                      </button>
                      <button
                        onClick={() => setNavCollapsed(true)}
                        aria-label="Recolher navegação"
                        title="Recolher navegação"
                        className="hidden flex-none rounded-md p-1 text-white/45 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 md:block"
                      >
                        <PanelLeftClose className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setMobileNav(false)}
                        aria-label="Fechar navegação"
                        className="flex-none rounded-md p-1 text-white/45 hover:bg-white/10 hover:text-white md:hidden"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Árvore: LISTA VERTICAL de módulos. Módulo com submenu expande
                        (seta à direita); módulo sem submenu navega direto e NÃO
                        exibe seta. Agrupamentos internos em caixa alta, itens com
                        recuo e linha vertical — mesmo padrão visual de sempre. */}
                    <nav aria-label="Módulos do Gerenciamento" className="space-y-0.5">
                      {modulosVisiveis.map(({ g }) => {
                        const Icon = g.icon
                        const direto = moduloEhDireto(g, pode)
                        const moduloAberto = !direto && expandedModule === g.key
                        const moduloEhAtivo = activeModule === g.key
                        const blocos = direto ? [] : blocosDoModulo(g, pode)
                        const painelId = `mod-${g.key}`
                        // item do submenu (ativo ou desabilitado) — mesmo desenho.
                        const renderItem = (it: ManagementNavigationItem) => {
                          const ativo = activeScreen === it.key
                          const indisponivel = it.status !== "active"
                          return (
                            <button
                              key={it.key}
                              tabIndex={moduloAberto ? undefined : -1}
                              disabled={indisponivel}
                              onClick={() => { if (!indisponivel) irParaTela(it.key) }}
                              title={indisponivel ? (it.note || `${it.label} — ainda sem tela própria.`) : (it.fullLabel || it.label)}
                              aria-current={ativo ? "page" : undefined}
                              aria-disabled={indisponivel || undefined}
                              className={`flex min-h-[38px] w-full items-center gap-2 rounded-lg border-l-2 py-2 pl-3 pr-2.5 text-left text-[13.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                                ativo
                                  ? "border-sky-400/80 bg-white/[0.12] font-semibold text-white"
                                  : indisponivel
                                    ? "cursor-not-allowed border-transparent text-white/30"
                                    : "border-transparent text-white/65 hover:bg-white/[0.06] hover:text-white"
                              }`}
                            >
                              <span className="min-w-0 flex-1 truncate">{it.label}</span>
                            </button>
                          )
                        }
                        return (
                          <div key={g.key}>
                            {/* linha do módulo */}
                            <div
                              className={`flex items-stretch rounded-lg transition-colors ${
                                moduloEhAtivo ? "bg-white/[0.06]" : "hover:bg-white/[0.05]"
                              }`}
                            >
                              <button
                                onClick={() => (direto ? irParaModulo(g.key) : toggleModulo(g.key))}
                                aria-current={moduloEhAtivo ? "true" : undefined}
                                aria-expanded={direto ? undefined : moduloAberto}
                                aria-controls={direto ? undefined : painelId}
                                title={g.fullLabel || g.label}
                                className={`flex min-w-0 flex-1 items-center gap-2 rounded-l-lg py-2.5 pl-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${direto ? "rounded-r-lg pr-2.5" : "pr-1"}`}
                              >
                                {Icon ? (
                                  <Icon className={`h-4 w-4 flex-none ${moduloEhAtivo ? "text-white/85" : "text-white/55"}`} />
                                ) : null}
                                <span className={`min-w-0 flex-1 truncate text-[13.5px] font-semibold ${moduloEhAtivo ? "text-white" : "text-white/80"}`}>
                                  {g.fullLabel || g.label}
                                </span>
                              </button>
                              {/* seta SÓ existe quando há submenu */}
                              {direto ? null : (
                                <button
                                  onClick={() => toggleModulo(g.key)}
                                  aria-expanded={moduloAberto}
                                  aria-controls={painelId}
                                  aria-label={moduloAberto ? `Recolher ${g.fullLabel || g.label}` : `Expandir ${g.fullLabel || g.label}`}
                                  className="flex flex-none items-center rounded-r-lg px-2 text-white/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                                >
                                  <ChevronRight className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${moduloAberto ? "rotate-90" : ""}`} />
                                </button>
                              )}
                            </div>

                            {/* submenu do módulo */}
                            {direto ? null : (
                              <div
                                id={painelId}
                                aria-hidden={!moduloAberto}
                                className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${moduloAberto ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                              >
                                <div className="min-h-0 overflow-hidden">
                                  <div className={`ml-[13px] space-y-0.5 border-l border-white/10 pb-1 pl-2 pt-1 transition-opacity duration-200 motion-reduce:transition-none ${moduloAberto ? "opacity-100" : "opacity-0"}`}>
                                    {blocos.map((b, i) =>
                                      b.tipo === "item" ? (
                                        <div key={`i-${b.item.key}-${i}`}>{renderItem(b.item)}</div>
                                      ) : (
                                        <div key={`s-${b.nome}-${i}`}>
                                          <div className="px-2 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/40">
                                            {b.nome}
                                          </div>
                                          {b.itens.map(renderItem)}
                                        </div>
                                      ),
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </nav>
                  </>
                )}
              </aside>

              {/* CONTEÚDO — a tela selecionada (sem página intermediária de cards) */}
              <div className="min-w-0 flex-1">
                <Breadcrumb
                  trilha={[
                    { label: "Gerenciamento", onClick: irParaHome },
                    // módulo sem submenu (Visão Geral) já É a tela — não repete o nome
                    ...(moduloAtivo.screen === activeScreen
                      ? [{ label: moduloAtivo.fullLabel || moduloAtivo.label }]
                      : [
                          { label: moduloAtivo.fullLabel || moduloAtivo.label, onClick: () => irParaModulo(moduloAtivo.key) },
                          ...(secaoTela ? [{ label: secaoTela }] : []),
                          { label: labelTela },
                        ]),
                  ]}
                />

                <div className="mb-4 mt-1 flex items-center gap-3">
                  <h1 className="text-[22px] font-bold tracking-tight text-white md:text-[24px]">{labelTela}</h1>
                </div>
                {TelaAtiva ? <TelaAtiva /> : <EmBreve titulo={labelTela} />}
              </div>
            </div>
          </section>
        ) : null}

        <style>{`
          .mgmt-scroll{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent}
          .mgmt-scroll::-webkit-scrollbar{width:8px}
          .mgmt-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18);border-radius:8px}
          .mgmt-scroll::-webkit-scrollbar-track{background:transparent}
        `}</style>
      </main>
    </div>
  )
}

// ── Breadcrumb com links (Gerenciamento › Módulo › Tela) ─────────────────────
function Breadcrumb({ trilha }: { trilha: { label: string; onClick?: () => void }[] }) {
  return (
    <nav aria-label="Trilha de navegação" className="flex flex-wrap items-center gap-1 text-[13px] text-white/50">
      <Home className="mr-0.5 h-3.5 w-3.5 text-white/40" />
      {trilha.map((c, i) => {
        const ultimo = i === trilha.length - 1
        return (
          <span key={i} className="inline-flex items-center gap-1">
            {c.onClick && !ultimo ? (
              <button
                onClick={c.onClick}
                className="rounded px-0.5 text-white/60 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                {c.label}
              </button>
            ) : (
              <span className={ultimo ? "font-medium text-white/85" : "text-white/60"}>{c.label}</span>
            )}
            {!ultimo ? <ChevronRight className="h-3.5 w-3.5 text-white/30" /> : null}
          </span>
        )
      })}
    </nav>
  )
}
