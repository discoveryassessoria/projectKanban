// prisma/dados-orgaos-organizacoes.ts
//
// BASE OFICIAL do módulo Órgãos e Organizações — dados REAIS do negócio de
// cidadania, nacionalidade, imigração, registro civil e mobilidade internacional.
//
// REGRA DESTE ARQUIVO: nada de dado fabricado. Cada entidade entra com o NOME
// OFICIAL na língua do país e com os campos que se pode afirmar (país, cidade,
// idioma, moeda, site institucional estável). Endereço, CEP, telefone, e-mail,
// horário e responsável ficam VAZIOS de propósito: são dados de contato que
// mudam e que o escritório preenche conforme usa. Melhor um campo vazio do que
// um telefone inventado.
//
// Fonte de verdade dos vínculos: `categorias` referencia o CODE da categoria.

export interface CategoriaSeed {
  code: string
  nome: string
  descricao?: string
  ordem: number
}

/** Funções que a organização exerce — a MESMA organização pode ter várias. */
export type Funcao = 'ORGAO' | 'FORNECEDOR' | 'PARCEIRO' | 'CORRESPONDENTE' | 'CLIENTE_CORPORATIVO'

export interface OrganizacaoSeed {
  /** Nome OFICIAL — na língua e grafia da entidade. */
  name: string
  /** Sigla ou nome usual. */
  nomeFantasia?: string
  /** type legado (consulado|comune|tribunal|conservatoria|cartorio|ministerio|prefeitura|tradutor|apostilamento|outro) */
  type?: string
  country: string
  /** região / estado / província de 1º nível */
  state?: string
  /** província / distrito de 2º nível */
  provincia?: string
  city?: string
  site?: string
  idioma?: string
  moeda?: string
  observacoes?: string
  tags?: string[]
  /** codes de CategoriaOrganizacao */
  categorias: string[]
  /** funções explícitas; quando ausente, derivam das categorias (`funcoesDe`). */
  funcoes?: Funcao[]
}

// ── FUNÇÕES DERIVADAS DA CLASSIFICAÇÃO ──────────────────────────────────────
// Categorias que caracterizam ENTIDADE EMISSORA/PÚBLICA → função ORGAO.
const CATEGORIAS_ORGAO = new Set([
  'consulados', 'embaixadas', 'cartorios', 'registros-civis', 'comuni', 'tribunais', 'ministerios',
  'prefeituras', 'governos-estaduais', 'governos-nacionais', 'arquivos-historicos', 'arquivos-distritais',
  'arquivos-provinciais', 'arquivos-nacionais', 'igrejas', 'paroquias', 'dioceses', 'curias', 'notarios',
  'apostilamento', 'policia', 'receita-federal', 'justica', 'imigracao', 'universidades',
])
// Categorias cujo trabalho GERA custo, taxa, custa ou emolumento → função FORNECEDOR.
// Um órgão que cobra emolumento é Órgão E Fornecedor: um único cadastro, duas funções.
const CATEGORIAS_FORNECEDOR = new Set([
  'cartorios', 'registros-civis', 'comuni', 'tribunais', 'ministerios', 'prefeituras', 'consulados',
  'embaixadas', 'notarios', 'apostilamento', 'traducao-juramentada', 'tradutores', 'arquivos-historicos',
  'arquivos-distritais', 'arquivos-provinciais', 'arquivos-nacionais', 'igrejas', 'paroquias', 'dioceses',
  'curias', 'transportadoras', 'correios', 'bancos', 'certificacao-digital', 'digitalizacao', 'peritos',
  'advogados', 'correspondentes', 'despachantes', 'genealogistas', 'pesquisadores', 'escritorios-juridicos',
  'escritorios-advocacia', 'escritorios-contabeis', 'consultores', 'contadores', 'fornecedores',
])

/** Funções efetivas: as declaradas OU as derivadas da classificação. */
export function funcoesDe(o: OrganizacaoSeed): Funcao[] {
  if (o.funcoes?.length) return o.funcoes
  const f = new Set<Funcao>()
  for (const c of o.categorias) {
    if (CATEGORIAS_ORGAO.has(c)) f.add('ORGAO')
    if (CATEGORIAS_FORNECEDOR.has(c)) f.add('FORNECEDOR')
  }
  if (!f.size) f.add('ORGAO')
  return [...f]
}

// ══════════════════════════════ CATEGORIAS ══════════════════════════════════
export const CATEGORIAS: CategoriaSeed[] = [
  { code: 'consulados', nome: 'Consulados', descricao: 'Repartições consulares que recebem pedidos de nacionalidade e emitem documentos.', ordem: 10 },
  { code: 'embaixadas', nome: 'Embaixadas', descricao: 'Representações diplomáticas junto ao governo do país anfitrião.', ordem: 20 },
  { code: 'cartorios', nome: 'Cartórios', descricao: 'Serventias extrajudiciais brasileiras.', ordem: 30 },
  { code: 'registros-civis', nome: 'Registros Civis', descricao: 'Órgãos de registro civil de nascimento, casamento e óbito.', ordem: 40 },
  { code: 'tribunais', nome: 'Tribunais', descricao: 'Órgãos do Poder Judiciário.', ordem: 50 },
  { code: 'ministerios', nome: 'Ministérios', descricao: 'Pastas do governo central.', ordem: 60 },
  { code: 'prefeituras', nome: 'Prefeituras', descricao: 'Administrações municipais (Câmaras, Ayuntamientos, Mairies).', ordem: 70 },
  { code: 'comuni', nome: 'Comuni', descricao: 'Comuni italianos — Ufficio dello Stato Civile e Anagrafe; emitem os atti que sustentam a cidadania.', ordem: 75 },
  { code: 'governos-estaduais', nome: 'Governos Estaduais', descricao: 'Administrações estaduais, provinciais e regionais.', ordem: 80 },
  { code: 'governos-nacionais', nome: 'Governos Nacionais', descricao: 'Órgãos de âmbito nacional que não são ministérios.', ordem: 90 },
  { code: 'arquivos-historicos', nome: 'Arquivos Históricos', descricao: 'Acervos históricos de pesquisa documental.', ordem: 100 },
  { code: 'arquivos-distritais', nome: 'Arquivos Distritais', descricao: 'Arquivos de âmbito distrital (Portugal).', ordem: 110 },
  { code: 'arquivos-provinciais', nome: 'Arquivos Provinciais', descricao: 'Arquivos de âmbito provincial (Espanha, Itália).', ordem: 120 },
  { code: 'arquivos-nacionais', nome: 'Arquivos Nacionais', descricao: 'Arquivos de âmbito nacional.', ordem: 130 },
  { code: 'igrejas', nome: 'Igrejas', descricao: 'Instituições religiosas com acervo de registros.', ordem: 140 },
  { code: 'paroquias', nome: 'Paróquias', descricao: 'Livros paroquiais de batismo, casamento e óbito.', ordem: 150 },
  { code: 'dioceses', nome: 'Dioceses', descricao: 'Circunscrições eclesiásticas com arquivo próprio.', ordem: 160 },
  { code: 'curias', nome: 'Cúrias', descricao: 'Cúrias diocesanas — acesso a registros eclesiásticos.', ordem: 170 },
  { code: 'notarios', nome: 'Notários', descricao: 'Notariado (notaios, notarios, tabeliães).', ordem: 180 },
  { code: 'apostilamento', nome: 'Apostilamento', descricao: 'Autoridades competentes para a Apostila de Haia.', ordem: 190 },
  { code: 'traducao-juramentada', nome: 'Tradução Juramentada', descricao: 'Tradução pública com fé pública.', ordem: 200 },
  { code: 'policia', nome: 'Polícia', descricao: 'Órgãos policiais (identificação civil, imigração).', ordem: 210 },
  { code: 'receita-federal', nome: 'Receita Federal', descricao: 'Administração tributária.', ordem: 220 },
  { code: 'justica', nome: 'Justiça', descricao: 'Órgãos e conselhos do sistema de justiça.', ordem: 230 },
  { code: 'imigracao', nome: 'Imigração', descricao: 'Autoridades de migração e estrangeiros.', ordem: 240 },
  { code: 'universidades', nome: 'Universidades', descricao: 'Instituições de ensino superior (revalidação, apostila acadêmica).', ordem: 250 },
  { code: 'bancos', nome: 'Bancos', descricao: 'Instituições financeiras.', ordem: 260 },
  { code: 'correios', nome: 'Correios', descricao: 'Operadores postais oficiais.', ordem: 270 },
  { code: 'transportadoras', nome: 'Transportadoras', descricao: 'Courier e logística de documentos.', ordem: 280 },
  { code: 'fornecedores', nome: 'Fornecedores', descricao: 'Prestadores contratados pelo escritório.', ordem: 290 },
  { code: 'parceiros', nome: 'Parceiros', descricao: 'Parcerias comerciais e operacionais.', ordem: 300 },
  { code: 'correspondentes', nome: 'Correspondentes', descricao: 'Correspondentes locais que atuam em nome do escritório.', ordem: 310 },
  { code: 'despachantes', nome: 'Despachantes', descricao: 'Despachantes documentais.', ordem: 320 },
  { code: 'escritorios-juridicos', nome: 'Escritórios Jurídicos', descricao: 'Escritórios de assessoria jurídica.', ordem: 330 },
  { code: 'escritorios-advocacia', nome: 'Escritórios de Advocacia', descricao: 'Bancas de advocacia.', ordem: 340 },
  { code: 'escritorios-contabeis', nome: 'Escritórios Contábeis', descricao: 'Contabilidade e obrigações fiscais.', ordem: 350 },
  { code: 'tradutores', nome: 'Tradutores', descricao: 'Tradutores públicos e intérpretes comerciais.', ordem: 360 },
  { code: 'peritos', nome: 'Peritos', descricao: 'Peritos documentoscópicos e grafotécnicos.', ordem: 370 },
  { code: 'clientes-corporativos', nome: 'Clientes Corporativos', descricao: 'Empresas atendidas como cliente institucional.', ordem: 380 },
  { code: 'genealogistas', nome: 'Genealogistas', descricao: 'Pesquisa genealógica profissional.', ordem: 390 },
  { code: 'pesquisadores', nome: 'Pesquisadores', descricao: 'Pesquisa documental em arquivos.', ordem: 400 },
  { code: 'advogados', nome: 'Advogados', descricao: 'Advogados parceiros no exterior e no Brasil.', ordem: 410 },
  { code: 'contadores', nome: 'Contadores', descricao: 'Contadores parceiros.', ordem: 420 },
  { code: 'consultores', nome: 'Consultores', descricao: 'Consultoria especializada.', ordem: 430 },
  { code: 'certificacao-digital', nome: 'Certificação Digital', descricao: 'Autoridades certificadoras e assinatura eletrônica.', ordem: 440 },
  { code: 'digitalizacao', nome: 'Digitalização', descricao: 'Digitalização e tratamento de acervo.', ordem: 450 },
  { code: 'outros', nome: 'Outros', descricao: 'Entidades sem classificação específica.', ordem: 999 },
]

// ═════════════════════════════ ORGANIZAÇÕES ═════════════════════════════════
// Nome oficial na língua do país. `type` mantém o vocabulário legado da coluna.

export const ORGANIZACOES: OrganizacaoSeed[] = [
  // ───────────────────────────── ESPANHA ────────────────────────────────────
  { name: 'Ministerio de Asuntos Exteriores, Unión Europea y Cooperación', nomeFantasia: 'MAEC', type: 'ministerio', country: 'Espanha', city: 'Madrid', site: 'https://www.exteriores.gob.es', idioma: 'es', moeda: 'EUR', categorias: ['ministerios', 'apostilamento'], tags: ['espanha', 'apostila'] },
  { name: 'Ministerio de Justicia', type: 'ministerio', country: 'Espanha', city: 'Madrid', site: 'https://www.mjusticia.gob.es', idioma: 'es', moeda: 'EUR', categorias: ['ministerios', 'justica', 'apostilamento'], tags: ['espanha', 'nacionalidade'] },
  { name: 'Registro Civil Central', type: 'conservatoria', country: 'Espanha', city: 'Madrid', site: 'https://www.mjusticia.gob.es', idioma: 'es', moeda: 'EUR', observacoes: 'Inscrição de nascimentos, casamentos e óbitos de espanhóis ocorridos no estrangeiro.', categorias: ['registros-civis'], tags: ['espanha', 'registro-civil'] },
  { name: 'Registro Civil de Madrid', type: 'conservatoria', country: 'Espanha', state: 'Comunidad de Madrid', city: 'Madrid', idioma: 'es', moeda: 'EUR', categorias: ['registros-civis'], tags: ['espanha', 'registro-civil'] },
  { name: 'Registro Civil de Barcelona', type: 'conservatoria', country: 'Espanha', state: 'Cataluña', city: 'Barcelona', idioma: 'es', moeda: 'EUR', categorias: ['registros-civis'], tags: ['espanha', 'registro-civil'] },
  { name: 'Registro Civil de Valencia', type: 'conservatoria', country: 'Espanha', state: 'Comunitat Valenciana', city: 'Valencia', idioma: 'es', moeda: 'EUR', categorias: ['registros-civis'], tags: ['espanha', 'registro-civil'] },
  { name: 'Registro Civil de Sevilla', type: 'conservatoria', country: 'Espanha', state: 'Andalucía', city: 'Sevilla', idioma: 'es', moeda: 'EUR', categorias: ['registros-civis'], tags: ['espanha', 'registro-civil'] },
  { name: 'Registro Civil de Galicia — A Coruña', type: 'conservatoria', country: 'Espanha', state: 'Galicia', city: 'A Coruña', idioma: 'es', moeda: 'EUR', categorias: ['registros-civis'], tags: ['espanha', 'registro-civil'] },
  { name: 'Archivo General de la Administración', nomeFantasia: 'AGA', type: 'outro', country: 'Espanha', state: 'Comunidad de Madrid', city: 'Alcalá de Henares', site: 'https://www.cultura.gob.es/cultura/areas/archivos', idioma: 'es', moeda: 'EUR', categorias: ['arquivos-nacionais', 'arquivos-historicos'], tags: ['espanha', 'pesquisa'] },
  { name: 'Archivo Histórico Nacional', nomeFantasia: 'AHN', type: 'outro', country: 'Espanha', city: 'Madrid', site: 'https://www.cultura.gob.es/cultura/areas/archivos', idioma: 'es', moeda: 'EUR', categorias: ['arquivos-nacionais', 'arquivos-historicos'], tags: ['espanha', 'pesquisa'] },
  { name: 'Archivo General de Indias', type: 'outro', country: 'Espanha', state: 'Andalucía', city: 'Sevilla', site: 'https://www.cultura.gob.es/cultura/areas/archivos', idioma: 'es', moeda: 'EUR', categorias: ['arquivos-nacionais', 'arquivos-historicos'], tags: ['espanha', 'pesquisa'] },
  { name: 'Archivo Histórico Provincial de Pontevedra', type: 'outro', country: 'Espanha', state: 'Galicia', city: 'Pontevedra', idioma: 'es', moeda: 'EUR', categorias: ['arquivos-provinciais', 'arquivos-historicos'], tags: ['espanha', 'pesquisa'] },
  { name: 'Consulado General de España en São Paulo', type: 'consulado', country: 'Brasil', state: 'SP', city: 'São Paulo', site: 'https://www.exteriores.gob.es', idioma: 'es', moeda: 'BRL', categorias: ['consulados'], tags: ['espanha', 'protocolo'] },
  { name: 'Consulado General de España en Río de Janeiro', type: 'consulado', country: 'Brasil', state: 'RJ', city: 'Rio de Janeiro', site: 'https://www.exteriores.gob.es', idioma: 'es', moeda: 'BRL', categorias: ['consulados'], tags: ['espanha', 'protocolo'] },
  { name: 'Consulado General de España en Porto Alegre', type: 'consulado', country: 'Brasil', state: 'RS', city: 'Porto Alegre', site: 'https://www.exteriores.gob.es', idioma: 'es', moeda: 'BRL', categorias: ['consulados'], tags: ['espanha', 'protocolo'] },
  { name: 'Consulado General de España en Salvador de Bahía', type: 'consulado', country: 'Brasil', state: 'BA', city: 'Salvador', site: 'https://www.exteriores.gob.es', idioma: 'es', moeda: 'BRL', categorias: ['consulados'], tags: ['espanha', 'protocolo'] },
  { name: 'Embajada de España en Brasil', type: 'consulado', country: 'Brasil', state: 'DF', city: 'Brasília', site: 'https://www.exteriores.gob.es', idioma: 'es', moeda: 'BRL', categorias: ['embaixadas'], tags: ['espanha'] },

  // ──────────────────────────── PORTUGAL ────────────────────────────────────
  { name: 'Instituto dos Registos e do Notariado', nomeFantasia: 'IRN', type: 'conservatoria', country: 'Portugal', city: 'Lisboa', site: 'https://irn.justica.gov.pt', idioma: 'pt', moeda: 'EUR', categorias: ['registros-civis', 'notarios', 'governos-nacionais'], tags: ['portugal', 'nacionalidade'] },
  { name: 'Conservatória dos Registos Centrais', nomeFantasia: 'CRC', type: 'conservatoria', country: 'Portugal', city: 'Lisboa', site: 'https://irn.justica.gov.pt', idioma: 'pt', moeda: 'EUR', observacoes: 'Processos de atribuição e aquisição de nacionalidade portuguesa.', categorias: ['registros-civis'], tags: ['portugal', 'nacionalidade'] },
  { name: 'Arquivo Distrital do Porto', type: 'outro', country: 'Portugal', state: 'Porto', city: 'Porto', idioma: 'pt', moeda: 'EUR', categorias: ['arquivos-distritais', 'arquivos-historicos'], tags: ['portugal', 'pesquisa'] },
  { name: 'Arquivo Distrital de Braga', type: 'outro', country: 'Portugal', state: 'Braga', city: 'Braga', idioma: 'pt', moeda: 'EUR', categorias: ['arquivos-distritais', 'arquivos-historicos'], tags: ['portugal', 'pesquisa'] },
  { name: 'Arquivo Distrital de Viana do Castelo', type: 'outro', country: 'Portugal', state: 'Viana do Castelo', city: 'Viana do Castelo', idioma: 'pt', moeda: 'EUR', categorias: ['arquivos-distritais', 'arquivos-historicos'], tags: ['portugal', 'pesquisa'] },
  { name: 'Arquivo Nacional da Torre do Tombo', nomeFantasia: 'ANTT', type: 'outro', country: 'Portugal', city: 'Lisboa', site: 'https://antt.dglab.gov.pt', idioma: 'pt', moeda: 'EUR', categorias: ['arquivos-nacionais', 'arquivos-historicos'], tags: ['portugal', 'pesquisa'] },
  { name: 'Agência para a Integração, Migrações e Asilo', nomeFantasia: 'AIMA', type: 'outro', country: 'Portugal', city: 'Lisboa', site: 'https://aima.gov.pt', idioma: 'pt', moeda: 'EUR', observacoes: 'Sucedeu o SEF nas competências administrativas de estrangeiros.', categorias: ['imigracao', 'governos-nacionais'], tags: ['portugal', 'imigracao'] },
  { name: 'Embaixada de Portugal no Brasil', type: 'consulado', country: 'Brasil', state: 'DF', city: 'Brasília', site: 'https://brasilia.embaixadaportugal.mne.gov.pt', idioma: 'pt', moeda: 'BRL', categorias: ['embaixadas'], tags: ['portugal'] },
  { name: 'Consulado-Geral de Portugal em São Paulo', type: 'consulado', country: 'Brasil', state: 'SP', city: 'São Paulo', idioma: 'pt', moeda: 'BRL', categorias: ['consulados'], tags: ['portugal', 'protocolo'] },
  { name: 'Consulado-Geral de Portugal no Rio de Janeiro', type: 'consulado', country: 'Brasil', state: 'RJ', city: 'Rio de Janeiro', idioma: 'pt', moeda: 'BRL', categorias: ['consulados'], tags: ['portugal', 'protocolo'] },
  { name: 'Consulado-Geral de Portugal em Curitiba', type: 'consulado', country: 'Brasil', state: 'PR', city: 'Curitiba', idioma: 'pt', moeda: 'BRL', categorias: ['consulados'], tags: ['portugal', 'protocolo'] },
  { name: 'Consulado-Geral de Portugal em Porto Alegre', type: 'consulado', country: 'Brasil', state: 'RS', city: 'Porto Alegre', idioma: 'pt', moeda: 'BRL', categorias: ['consulados'], tags: ['portugal', 'protocolo'] },
  { name: 'Consulado-Geral de Portugal em Salvador', type: 'consulado', country: 'Brasil', state: 'BA', city: 'Salvador', idioma: 'pt', moeda: 'BRL', categorias: ['consulados'], tags: ['portugal', 'protocolo'] },
  { name: 'Consulado-Geral de Portugal em Recife', type: 'consulado', country: 'Brasil', state: 'PE', city: 'Recife', idioma: 'pt', moeda: 'BRL', categorias: ['consulados'], tags: ['portugal', 'protocolo'] },
  { name: 'Consulado-Geral de Portugal em Belo Horizonte', type: 'consulado', country: 'Brasil', state: 'MG', city: 'Belo Horizonte', idioma: 'pt', moeda: 'BRL', categorias: ['consulados'], tags: ['portugal', 'protocolo'] },

  // ───────────────────────────── ITÁLIA ─────────────────────────────────────
  { name: "Ministero dell'Interno", type: 'ministerio', country: 'Itália', city: 'Roma', site: 'https://www.interno.gov.it', idioma: 'it', moeda: 'EUR', categorias: ['ministerios'], tags: ['italia', 'cidadania'] },
  { name: 'Ministero degli Affari Esteri e della Cooperazione Internazionale', nomeFantasia: 'MAECI', type: 'ministerio', country: 'Itália', city: 'Roma', site: 'https://www.esteri.it', idioma: 'it', moeda: 'EUR', categorias: ['ministerios'], tags: ['italia', 'cidadania'] },
  { name: 'Ministero della Giustizia', type: 'ministerio', country: 'Itália', city: 'Roma', site: 'https://www.giustizia.it', idioma: 'it', moeda: 'EUR', categorias: ['ministerios', 'justica'], tags: ['italia'] },
  { name: 'Tribunale Ordinario di Roma', type: 'tribunal', country: 'Itália', state: 'Lazio', city: 'Roma', idioma: 'it', moeda: 'EUR', categorias: ['tribunais', 'justica'], tags: ['italia', 'judicial'] },
  { name: 'Tribunale Ordinario di Venezia', type: 'tribunal', country: 'Itália', state: 'Veneto', city: 'Venezia', idioma: 'it', moeda: 'EUR', categorias: ['tribunais', 'justica'], tags: ['italia', 'judicial'] },
  { name: 'Tribunale Ordinario di Milano', type: 'tribunal', country: 'Itália', state: 'Lombardia', city: 'Milano', idioma: 'it', moeda: 'EUR', categorias: ['tribunais', 'justica'], tags: ['italia', 'judicial'] },
  { name: 'Tribunale Ordinario di Napoli', type: 'tribunal', country: 'Itália', state: 'Campania', city: 'Napoli', idioma: 'it', moeda: 'EUR', categorias: ['tribunais', 'justica'], tags: ['italia', 'judicial'] },
  { name: 'Tribunale Ordinario di Torino', type: 'tribunal', country: 'Itália', state: 'Piemonte', city: 'Torino', idioma: 'it', moeda: 'EUR', categorias: ['tribunais', 'justica'], tags: ['italia', 'judicial'] },
  { name: 'Archivio Centrale dello Stato', type: 'outro', country: 'Itália', city: 'Roma', site: 'https://acs.cultura.gov.it', idioma: 'it', moeda: 'EUR', categorias: ['arquivos-nacionais', 'arquivos-historicos'], tags: ['italia', 'pesquisa'] },
  { name: 'Archivio di Stato di Venezia', type: 'outro', country: 'Itália', state: 'Veneto', city: 'Venezia', idioma: 'it', moeda: 'EUR', categorias: ['arquivos-provinciais', 'arquivos-historicos'], tags: ['italia', 'pesquisa'] },
  { name: 'Archivio di Stato di Napoli', type: 'outro', country: 'Itália', state: 'Campania', city: 'Napoli', idioma: 'it', moeda: 'EUR', categorias: ['arquivos-provinciais', 'arquivos-historicos'], tags: ['italia', 'pesquisa'] },
  { name: 'Consolato Generale d\'Italia a San Paolo', type: 'consulado', country: 'Brasil', state: 'SP', city: 'São Paulo', site: 'https://conssanpaolo.esteri.it', idioma: 'it', moeda: 'BRL', categorias: ['consulados'], tags: ['italia', 'protocolo'] },
  { name: 'Consolato Generale d\'Italia a Rio de Janeiro', type: 'consulado', country: 'Brasil', state: 'RJ', city: 'Rio de Janeiro', site: 'https://consriodejaneiro.esteri.it', idioma: 'it', moeda: 'BRL', categorias: ['consulados'], tags: ['italia', 'protocolo'] },
  { name: 'Consolato Generale d\'Italia a Porto Alegre', type: 'consulado', country: 'Brasil', state: 'RS', city: 'Porto Alegre', site: 'https://consportoalegre.esteri.it', idioma: 'it', moeda: 'BRL', categorias: ['consulados'], tags: ['italia', 'protocolo'] },
  { name: 'Consolato Generale d\'Italia a Curitiba', type: 'consulado', country: 'Brasil', state: 'PR', city: 'Curitiba', site: 'https://conscuritiba.esteri.it', idioma: 'it', moeda: 'BRL', categorias: ['consulados'], tags: ['italia', 'protocolo'] },
  { name: 'Consolato Generale d\'Italia a Recife', type: 'consulado', country: 'Brasil', state: 'PE', city: 'Recife', site: 'https://consrecife.esteri.it', idioma: 'it', moeda: 'BRL', categorias: ['consulados'], tags: ['italia', 'protocolo'] },
  { name: 'Consolato d\'Italia a Belo Horizonte', type: 'consulado', country: 'Brasil', state: 'MG', city: 'Belo Horizonte', site: 'https://consbelohorizonte.esteri.it', idioma: 'it', moeda: 'BRL', categorias: ['consulados'], tags: ['italia', 'protocolo'] },
  { name: 'Ambasciata d\'Italia a Brasilia', type: 'consulado', country: 'Brasil', state: 'DF', city: 'Brasília', site: 'https://ambbrasilia.esteri.it', idioma: 'it', moeda: 'BRL', categorias: ['embaixadas'], tags: ['italia'] },

  // ────────────────────────────── BRASIL ────────────────────────────────────
  { name: 'Conselho Nacional de Justiça', nomeFantasia: 'CNJ', type: 'outro', country: 'Brasil', state: 'DF', city: 'Brasília', site: 'https://www.cnj.jus.br', idioma: 'pt', moeda: 'BRL', observacoes: 'Mantém a Central de Informações do Registro Civil (CRC) e regula a Apostila de Haia no Brasil.', categorias: ['justica', 'governos-nacionais', 'apostilamento'], tags: ['brasil', 'apostila'] },
  { name: 'Secretaria Especial da Receita Federal do Brasil', nomeFantasia: 'Receita Federal', type: 'outro', country: 'Brasil', state: 'DF', city: 'Brasília', site: 'https://www.gov.br/receitafederal', idioma: 'pt', moeda: 'BRL', categorias: ['receita-federal', 'governos-nacionais'], tags: ['brasil', 'cpf'] },
  { name: 'Polícia Federal', nomeFantasia: 'PF', type: 'outro', country: 'Brasil', state: 'DF', city: 'Brasília', site: 'https://www.gov.br/pf', idioma: 'pt', moeda: 'BRL', observacoes: 'Passaporte, registro de estrangeiros e certidão de antecedentes.', categorias: ['policia', 'imigracao', 'governos-nacionais'], tags: ['brasil', 'passaporte'] },
  { name: 'Ministério das Relações Exteriores', nomeFantasia: 'Itamaraty', type: 'ministerio', country: 'Brasil', state: 'DF', city: 'Brasília', site: 'https://www.gov.br/mre', idioma: 'pt', moeda: 'BRL', categorias: ['ministerios'], tags: ['brasil', 'legalizacao'] },
  { name: 'Ministério da Justiça e Segurança Pública', type: 'ministerio', country: 'Brasil', state: 'DF', city: 'Brasília', site: 'https://www.gov.br/mj', idioma: 'pt', moeda: 'BRL', categorias: ['ministerios', 'justica'], tags: ['brasil'] },
  { name: 'Empresa Brasileira de Correios e Telégrafos', nomeFantasia: 'Correios', type: 'outro', country: 'Brasil', state: 'DF', city: 'Brasília', site: 'https://www.correios.com.br', idioma: 'pt', moeda: 'BRL', categorias: ['correios', 'fornecedores', 'transportadoras'], tags: ['brasil', 'logistica'] },
  { name: 'Tribunal de Justiça do Estado de São Paulo', nomeFantasia: 'TJSP', type: 'tribunal', country: 'Brasil', state: 'SP', city: 'São Paulo', site: 'https://www.tjsp.jus.br', idioma: 'pt', moeda: 'BRL', categorias: ['tribunais', 'justica'], tags: ['brasil', 'judicial'] },
  { name: 'Tribunal de Justiça do Estado do Rio de Janeiro', nomeFantasia: 'TJRJ', type: 'tribunal', country: 'Brasil', state: 'RJ', city: 'Rio de Janeiro', site: 'https://www.tjrj.jus.br', idioma: 'pt', moeda: 'BRL', categorias: ['tribunais', 'justica'], tags: ['brasil', 'judicial'] },
  { name: 'Tribunal de Justiça do Estado do Rio Grande do Sul', nomeFantasia: 'TJRS', type: 'tribunal', country: 'Brasil', state: 'RS', city: 'Porto Alegre', site: 'https://www.tjrs.jus.br', idioma: 'pt', moeda: 'BRL', categorias: ['tribunais', 'justica'], tags: ['brasil', 'judicial'] },
  { name: 'Tribunal de Justiça do Estado de Minas Gerais', nomeFantasia: 'TJMG', type: 'tribunal', country: 'Brasil', state: 'MG', city: 'Belo Horizonte', site: 'https://www.tjmg.jus.br', idioma: 'pt', moeda: 'BRL', categorias: ['tribunais', 'justica'], tags: ['brasil', 'judicial'] },
  { name: 'Tribunal de Justiça do Estado do Paraná', nomeFantasia: 'TJPR', type: 'tribunal', country: 'Brasil', state: 'PR', city: 'Curitiba', site: 'https://www.tjpr.jus.br', idioma: 'pt', moeda: 'BRL', categorias: ['tribunais', 'justica'], tags: ['brasil', 'judicial'] },
  { name: 'Tribunal de Justiça do Estado de Santa Catarina', nomeFantasia: 'TJSC', type: 'tribunal', country: 'Brasil', state: 'SC', city: 'Florianópolis', site: 'https://www.tjsc.jus.br', idioma: 'pt', moeda: 'BRL', categorias: ['tribunais', 'justica'], tags: ['brasil', 'judicial'] },
  { name: 'Junta Comercial do Estado de São Paulo', nomeFantasia: 'JUCESP', type: 'outro', country: 'Brasil', state: 'SP', city: 'São Paulo', idioma: 'pt', moeda: 'BRL', categorias: ['governos-estaduais'], tags: ['brasil', 'empresarial'] },
  { name: 'Arquivo Nacional', type: 'outro', country: 'Brasil', state: 'RJ', city: 'Rio de Janeiro', site: 'https://www.gov.br/arquivonacional', idioma: 'pt', moeda: 'BRL', observacoes: 'Acervo de imigração: listas de bordo, registros de entrada de estrangeiros.', categorias: ['arquivos-nacionais', 'arquivos-historicos'], tags: ['brasil', 'pesquisa', 'imigracao'] },
  { name: 'Arquivo Público do Estado de São Paulo', type: 'outro', country: 'Brasil', state: 'SP', city: 'São Paulo', site: 'https://www.arquivoestado.sp.gov.br', idioma: 'pt', moeda: 'BRL', observacoes: 'Registros de imigrantes (Hospedaria dos Imigrantes).', categorias: ['arquivos-historicos', 'governos-estaduais'], tags: ['brasil', 'pesquisa', 'imigracao'] },
  { name: 'Arquivo Público do Estado do Rio Grande do Sul', type: 'outro', country: 'Brasil', state: 'RS', city: 'Porto Alegre', idioma: 'pt', moeda: 'BRL', categorias: ['arquivos-historicos', 'governos-estaduais'], tags: ['brasil', 'pesquisa'] },
  { name: 'Arquivo Público do Estado do Espírito Santo', type: 'outro', country: 'Brasil', state: 'ES', city: 'Vitória', idioma: 'pt', moeda: 'BRL', categorias: ['arquivos-historicos', 'governos-estaduais'], tags: ['brasil', 'pesquisa'] },
  { name: 'Arquivo Público Mineiro', type: 'outro', country: 'Brasil', state: 'MG', city: 'Belo Horizonte', idioma: 'pt', moeda: 'BRL', categorias: ['arquivos-historicos', 'governos-estaduais'], tags: ['brasil', 'pesquisa'] },
  { name: 'Arquidiocese de São Paulo — Cúria Metropolitana', type: 'outro', country: 'Brasil', state: 'SP', city: 'São Paulo', idioma: 'pt', moeda: 'BRL', observacoes: 'Acesso a livros paroquiais de batismo, casamento e óbito.', categorias: ['curias', 'dioceses', 'igrejas'], tags: ['brasil', 'pesquisa'] },
  { name: 'Arquidiocese de Porto Alegre — Cúria Metropolitana', type: 'outro', country: 'Brasil', state: 'RS', city: 'Porto Alegre', idioma: 'pt', moeda: 'BRL', categorias: ['curias', 'dioceses', 'igrejas'], tags: ['brasil', 'pesquisa'] },

  // ──────────────────────────── PARAGUAI ────────────────────────────────────
  { name: 'Dirección General del Registro del Estado Civil', type: 'conservatoria', country: 'Paraguai', city: 'Asunción', idioma: 'es', moeda: 'PYG', categorias: ['registros-civis', 'governos-nacionais'], tags: ['paraguai', 'registro-civil'] },
  { name: 'Ministerio de Relaciones Exteriores del Paraguay', type: 'ministerio', country: 'Paraguai', city: 'Asunción', site: 'https://www.mre.gov.py', idioma: 'es', moeda: 'PYG', categorias: ['ministerios', 'apostilamento'], tags: ['paraguai', 'apostila'] },
  { name: 'Dirección General de Migraciones del Paraguay', type: 'outro', country: 'Paraguai', city: 'Asunción', idioma: 'es', moeda: 'PYG', categorias: ['imigracao', 'governos-nacionais'], tags: ['paraguai', 'imigracao'] },

  // ──────────────────────────── ARGENTINA ───────────────────────────────────
  { name: 'Registro Nacional de las Personas', nomeFantasia: 'RENAPER', type: 'outro', country: 'Argentina', city: 'Buenos Aires', site: 'https://www.argentina.gob.ar/interior/renaper', idioma: 'es', moeda: 'ARS', categorias: ['registros-civis', 'governos-nacionais'], tags: ['argentina', 'registro-civil'] },
  { name: 'Ministerio del Interior de la República Argentina', type: 'ministerio', country: 'Argentina', city: 'Buenos Aires', site: 'https://www.argentina.gob.ar/interior', idioma: 'es', moeda: 'ARS', categorias: ['ministerios'], tags: ['argentina'] },
  { name: 'Dirección Nacional de Migraciones', type: 'outro', country: 'Argentina', city: 'Buenos Aires', site: 'https://www.argentina.gob.ar/interior/migraciones', idioma: 'es', moeda: 'ARS', categorias: ['imigracao', 'governos-nacionais'], tags: ['argentina', 'imigracao'] },

  // ──────────────────────────── ALEMANHA ────────────────────────────────────
  { name: 'Standesamt I in Berlin', type: 'conservatoria', country: 'Alemanha', state: 'Berlin', city: 'Berlin', idioma: 'de', moeda: 'EUR', observacoes: 'Registro civil competente para atos de alemães ocorridos no exterior.', categorias: ['registros-civis'], tags: ['alemanha', 'registro-civil'] },
  { name: 'Bundesverwaltungsamt', nomeFantasia: 'BVA', type: 'outro', country: 'Alemanha', state: 'Nordrhein-Westfalen', city: 'Köln', site: 'https://www.bva.bund.de', idioma: 'de', moeda: 'EUR', observacoes: 'Autoridade federal para pedidos de nacionalidade alemã no exterior.', categorias: ['governos-nacionais'], tags: ['alemanha', 'cidadania'] },
  { name: 'Auswärtiges Amt', type: 'ministerio', country: 'Alemanha', state: 'Berlin', city: 'Berlin', site: 'https://www.auswaertiges-amt.de', idioma: 'de', moeda: 'EUR', categorias: ['ministerios'], tags: ['alemanha'] },

  // ───────────────────────────── FRANÇA ─────────────────────────────────────
  { name: "Service Central d'État Civil", nomeFantasia: 'SCEC', type: 'conservatoria', country: 'França', state: 'Loire-Atlantique', city: 'Nantes', site: 'https://www.service-public.fr', idioma: 'fr', moeda: 'EUR', observacoes: 'Atos de estado civil de franceses ocorridos no estrangeiro.', categorias: ['registros-civis'], tags: ['franca', 'registro-civil'] },
  { name: "Ministère de l'Europe et des Affaires étrangères", type: 'ministerio', country: 'França', city: 'Paris', site: 'https://www.diplomatie.gouv.fr', idioma: 'fr', moeda: 'EUR', categorias: ['ministerios'], tags: ['franca'] },

  // ─────────────────────────── ESTADOS UNIDOS ───────────────────────────────
  { name: 'U.S. Citizenship and Immigration Services', nomeFantasia: 'USCIS', type: 'outro', country: 'Estados Unidos', state: 'DC', city: 'Washington', site: 'https://www.uscis.gov', idioma: 'en', moeda: 'USD', categorias: ['imigracao', 'governos-nacionais'], tags: ['eua', 'imigracao'] },
  { name: 'U.S. Department of State', type: 'ministerio', country: 'Estados Unidos', state: 'DC', city: 'Washington', site: 'https://www.state.gov', idioma: 'en', moeda: 'USD', observacoes: 'Autoridade competente para apostila de documentos federais.', categorias: ['ministerios', 'apostilamento'], tags: ['eua', 'apostila'] },

  // ───────────────── INFRAESTRUTURA PÚBLICA (empresas reais) ────────────────
  { name: 'Instituto Nacional de Tecnologia da Informação', nomeFantasia: 'ITI', type: 'outro', country: 'Brasil', state: 'DF', city: 'Brasília', site: 'https://www.gov.br/iti', idioma: 'pt', moeda: 'BRL', observacoes: 'Autoridade Certificadora Raiz da ICP-Brasil.', categorias: ['certificacao-digital', 'governos-nacionais'], tags: ['brasil', 'assinatura-digital'] },
]



// ══════════════════════════ COMUNI ITALIANI ═════════════════════════════════
//
// Todos os 107 capoluoghi di provincia (que incluem, por definição, os 20
// capoluoghi di regione) + comuni de alta demanda em processos de cidadania —
// as áreas da grande emigração italiana para o Brasil (Veneto, Trentino, Friuli,
// Lombardia alpina). Nome oficial em italiano: "Comune di X".
//
// Cada comune é ÓRGÃO (Ufficio dello Stato Civile) e FORNECEDOR: emite atti
// mediante diritti di segreteria / marca da bollo, custo que o processo paga.
// Um cadastro, duas funções — nunca dois registros.

export interface ComuneSeed {
  /** nome do comune, sem o prefixo "Comune di" */
  nome: string
  regiao: string
  provincia: string
  /** sigla oficial da província (RM, VI, TN…) */
  sigla: string
  /** capoluogo di regione */
  capitalRegional?: boolean
  /** capoluogo di provincia */
  capitalProvincial?: boolean
  observacoes?: string
}

export const COMUNI: ComuneSeed[] = [
  // ── Abruzzo ──
  { nome: "L'Aquila", regiao: 'Abruzzo', provincia: "L'Aquila", sigla: 'AQ', capitalRegional: true, capitalProvincial: true },
  { nome: 'Chieti', regiao: 'Abruzzo', provincia: 'Chieti', sigla: 'CH', capitalProvincial: true },
  { nome: 'Pescara', regiao: 'Abruzzo', provincia: 'Pescara', sigla: 'PE', capitalProvincial: true },
  { nome: 'Teramo', regiao: 'Abruzzo', provincia: 'Teramo', sigla: 'TE', capitalProvincial: true },
  // ── Basilicata ──
  { nome: 'Potenza', regiao: 'Basilicata', provincia: 'Potenza', sigla: 'PZ', capitalRegional: true, capitalProvincial: true },
  { nome: 'Matera', regiao: 'Basilicata', provincia: 'Matera', sigla: 'MT', capitalProvincial: true },
  // ── Calabria ──
  { nome: 'Catanzaro', regiao: 'Calabria', provincia: 'Catanzaro', sigla: 'CZ', capitalRegional: true, capitalProvincial: true },
  { nome: 'Cosenza', regiao: 'Calabria', provincia: 'Cosenza', sigla: 'CS', capitalProvincial: true },
  { nome: 'Crotone', regiao: 'Calabria', provincia: 'Crotone', sigla: 'KR', capitalProvincial: true },
  { nome: 'Reggio di Calabria', regiao: 'Calabria', provincia: 'Reggio Calabria', sigla: 'RC', capitalProvincial: true },
  { nome: 'Vibo Valentia', regiao: 'Calabria', provincia: 'Vibo Valentia', sigla: 'VV', capitalProvincial: true },
  // ── Campania ──
  { nome: 'Napoli', regiao: 'Campania', provincia: 'Napoli', sigla: 'NA', capitalRegional: true, capitalProvincial: true },
  { nome: 'Avellino', regiao: 'Campania', provincia: 'Avellino', sigla: 'AV', capitalProvincial: true },
  { nome: 'Benevento', regiao: 'Campania', provincia: 'Benevento', sigla: 'BN', capitalProvincial: true },
  { nome: 'Caserta', regiao: 'Campania', provincia: 'Caserta', sigla: 'CE', capitalProvincial: true },
  { nome: 'Salerno', regiao: 'Campania', provincia: 'Salerno', sigla: 'SA', capitalProvincial: true },
  // ── Emilia-Romagna ──
  { nome: 'Bologna', regiao: 'Emilia-Romagna', provincia: 'Bologna', sigla: 'BO', capitalRegional: true, capitalProvincial: true },
  { nome: 'Ferrara', regiao: 'Emilia-Romagna', provincia: 'Ferrara', sigla: 'FE', capitalProvincial: true },
  { nome: 'Forlì', regiao: 'Emilia-Romagna', provincia: 'Forlì-Cesena', sigla: 'FC', capitalProvincial: true },
  { nome: 'Cesena', regiao: 'Emilia-Romagna', provincia: 'Forlì-Cesena', sigla: 'FC', capitalProvincial: true },
  { nome: 'Modena', regiao: 'Emilia-Romagna', provincia: 'Modena', sigla: 'MO', capitalProvincial: true },
  { nome: 'Parma', regiao: 'Emilia-Romagna', provincia: 'Parma', sigla: 'PR', capitalProvincial: true },
  { nome: 'Piacenza', regiao: 'Emilia-Romagna', provincia: 'Piacenza', sigla: 'PC', capitalProvincial: true },
  { nome: 'Ravenna', regiao: 'Emilia-Romagna', provincia: 'Ravenna', sigla: 'RA', capitalProvincial: true },
  { nome: "Reggio nell'Emilia", regiao: 'Emilia-Romagna', provincia: "Reggio nell'Emilia", sigla: 'RE', capitalProvincial: true },
  { nome: 'Rimini', regiao: 'Emilia-Romagna', provincia: 'Rimini', sigla: 'RN', capitalProvincial: true },
  // ── Friuli-Venezia Giulia ──
  { nome: 'Trieste', regiao: 'Friuli-Venezia Giulia', provincia: 'Trieste', sigla: 'TS', capitalRegional: true, capitalProvincial: true },
  { nome: 'Gorizia', regiao: 'Friuli-Venezia Giulia', provincia: 'Gorizia', sigla: 'GO', capitalProvincial: true },
  { nome: 'Pordenone', regiao: 'Friuli-Venezia Giulia', provincia: 'Pordenone', sigla: 'PN', capitalProvincial: true },
  { nome: 'Udine', regiao: 'Friuli-Venezia Giulia', provincia: 'Udine', sigla: 'UD', capitalProvincial: true },
  { nome: 'Spilimbergo', regiao: 'Friuli-Venezia Giulia', provincia: 'Pordenone', sigla: 'PN', observacoes: 'Alta demanda — região de forte emigração para o Brasil.' },
  { nome: 'Codroipo', regiao: 'Friuli-Venezia Giulia', provincia: 'Udine', sigla: 'UD', observacoes: 'Alta demanda — região de forte emigração para o Brasil.' },
  // ── Lazio ──
  { nome: 'Roma', regiao: 'Lazio', provincia: 'Roma', sigla: 'RM', capitalRegional: true, capitalProvincial: true },
  { nome: 'Frosinone', regiao: 'Lazio', provincia: 'Frosinone', sigla: 'FR', capitalProvincial: true },
  { nome: 'Latina', regiao: 'Lazio', provincia: 'Latina', sigla: 'LT', capitalProvincial: true },
  { nome: 'Rieti', regiao: 'Lazio', provincia: 'Rieti', sigla: 'RI', capitalProvincial: true },
  { nome: 'Viterbo', regiao: 'Lazio', provincia: 'Viterbo', sigla: 'VT', capitalProvincial: true },
  // ── Liguria ──
  { nome: 'Genova', regiao: 'Liguria', provincia: 'Genova', sigla: 'GE', capitalRegional: true, capitalProvincial: true },
  { nome: 'Imperia', regiao: 'Liguria', provincia: 'Imperia', sigla: 'IM', capitalProvincial: true },
  { nome: 'La Spezia', regiao: 'Liguria', provincia: 'La Spezia', sigla: 'SP', capitalProvincial: true },
  { nome: 'Savona', regiao: 'Liguria', provincia: 'Savona', sigla: 'SV', capitalProvincial: true },
  // ── Lombardia ──
  { nome: 'Milano', regiao: 'Lombardia', provincia: 'Milano', sigla: 'MI', capitalRegional: true, capitalProvincial: true },
  { nome: 'Bergamo', regiao: 'Lombardia', provincia: 'Bergamo', sigla: 'BG', capitalProvincial: true },
  { nome: 'Brescia', regiao: 'Lombardia', provincia: 'Brescia', sigla: 'BS', capitalProvincial: true },
  { nome: 'Como', regiao: 'Lombardia', provincia: 'Como', sigla: 'CO', capitalProvincial: true },
  { nome: 'Cremona', regiao: 'Lombardia', provincia: 'Cremona', sigla: 'CR', capitalProvincial: true },
  { nome: 'Lecco', regiao: 'Lombardia', provincia: 'Lecco', sigla: 'LC', capitalProvincial: true },
  { nome: 'Lodi', regiao: 'Lombardia', provincia: 'Lodi', sigla: 'LO', capitalProvincial: true },
  { nome: 'Mantova', regiao: 'Lombardia', provincia: 'Mantova', sigla: 'MN', capitalProvincial: true },
  { nome: 'Monza', regiao: 'Lombardia', provincia: 'Monza e della Brianza', sigla: 'MB', capitalProvincial: true },
  { nome: 'Pavia', regiao: 'Lombardia', provincia: 'Pavia', sigla: 'PV', capitalProvincial: true },
  { nome: 'Sondrio', regiao: 'Lombardia', provincia: 'Sondrio', sigla: 'SO', capitalProvincial: true },
  { nome: 'Varese', regiao: 'Lombardia', provincia: 'Varese', sigla: 'VA', capitalProvincial: true },
  { nome: 'Chiavenna', regiao: 'Lombardia', provincia: 'Sondrio', sigla: 'SO', observacoes: 'Alta demanda — região de forte emigração para o Brasil.' },
  // ── Marche ──
  { nome: 'Ancona', regiao: 'Marche', provincia: 'Ancona', sigla: 'AN', capitalRegional: true, capitalProvincial: true },
  { nome: 'Ascoli Piceno', regiao: 'Marche', provincia: 'Ascoli Piceno', sigla: 'AP', capitalProvincial: true },
  { nome: 'Fermo', regiao: 'Marche', provincia: 'Fermo', sigla: 'FM', capitalProvincial: true },
  { nome: 'Macerata', regiao: 'Marche', provincia: 'Macerata', sigla: 'MC', capitalProvincial: true },
  { nome: 'Pesaro', regiao: 'Marche', provincia: 'Pesaro e Urbino', sigla: 'PU', capitalProvincial: true },
  { nome: 'Urbino', regiao: 'Marche', provincia: 'Pesaro e Urbino', sigla: 'PU', capitalProvincial: true },
  // ── Molise ──
  { nome: 'Campobasso', regiao: 'Molise', provincia: 'Campobasso', sigla: 'CB', capitalRegional: true, capitalProvincial: true },
  { nome: 'Isernia', regiao: 'Molise', provincia: 'Isernia', sigla: 'IS', capitalProvincial: true },
  // ── Piemonte ──
  { nome: 'Torino', regiao: 'Piemonte', provincia: 'Torino', sigla: 'TO', capitalRegional: true, capitalProvincial: true },
  { nome: 'Alessandria', regiao: 'Piemonte', provincia: 'Alessandria', sigla: 'AL', capitalProvincial: true },
  { nome: 'Asti', regiao: 'Piemonte', provincia: 'Asti', sigla: 'AT', capitalProvincial: true },
  { nome: 'Biella', regiao: 'Piemonte', provincia: 'Biella', sigla: 'BI', capitalProvincial: true },
  { nome: 'Cuneo', regiao: 'Piemonte', provincia: 'Cuneo', sigla: 'CN', capitalProvincial: true },
  { nome: 'Novara', regiao: 'Piemonte', provincia: 'Novara', sigla: 'NO', capitalProvincial: true },
  { nome: 'Verbania', regiao: 'Piemonte', provincia: 'Verbano-Cusio-Ossola', sigla: 'VB', capitalProvincial: true },
  { nome: 'Vercelli', regiao: 'Piemonte', provincia: 'Vercelli', sigla: 'VC', capitalProvincial: true },
  // ── Puglia ──
  { nome: 'Bari', regiao: 'Puglia', provincia: 'Bari', sigla: 'BA', capitalRegional: true, capitalProvincial: true },
  { nome: 'Barletta', regiao: 'Puglia', provincia: 'Barletta-Andria-Trani', sigla: 'BT', capitalProvincial: true },
  { nome: 'Andria', regiao: 'Puglia', provincia: 'Barletta-Andria-Trani', sigla: 'BT', capitalProvincial: true },
  { nome: 'Trani', regiao: 'Puglia', provincia: 'Barletta-Andria-Trani', sigla: 'BT', capitalProvincial: true },
  { nome: 'Brindisi', regiao: 'Puglia', provincia: 'Brindisi', sigla: 'BR', capitalProvincial: true },
  { nome: 'Foggia', regiao: 'Puglia', provincia: 'Foggia', sigla: 'FG', capitalProvincial: true },
  { nome: 'Lecce', regiao: 'Puglia', provincia: 'Lecce', sigla: 'LE', capitalProvincial: true },
  { nome: 'Taranto', regiao: 'Puglia', provincia: 'Taranto', sigla: 'TA', capitalProvincial: true },
  // ── Sardegna ──
  { nome: 'Cagliari', regiao: 'Sardegna', provincia: 'Cagliari', sigla: 'CA', capitalRegional: true, capitalProvincial: true },
  { nome: 'Nuoro', regiao: 'Sardegna', provincia: 'Nuoro', sigla: 'NU', capitalProvincial: true },
  { nome: 'Oristano', regiao: 'Sardegna', provincia: 'Oristano', sigla: 'OR', capitalProvincial: true },
  { nome: 'Sassari', regiao: 'Sardegna', provincia: 'Sassari', sigla: 'SS', capitalProvincial: true },
  { nome: 'Carbonia', regiao: 'Sardegna', provincia: 'Sud Sardegna', sigla: 'SU', capitalProvincial: true },
  // ── Sicilia ──
  { nome: 'Palermo', regiao: 'Sicilia', provincia: 'Palermo', sigla: 'PA', capitalRegional: true, capitalProvincial: true },
  { nome: 'Agrigento', regiao: 'Sicilia', provincia: 'Agrigento', sigla: 'AG', capitalProvincial: true },
  { nome: 'Caltanissetta', regiao: 'Sicilia', provincia: 'Caltanissetta', sigla: 'CL', capitalProvincial: true },
  { nome: 'Catania', regiao: 'Sicilia', provincia: 'Catania', sigla: 'CT', capitalProvincial: true },
  { nome: 'Enna', regiao: 'Sicilia', provincia: 'Enna', sigla: 'EN', capitalProvincial: true },
  { nome: 'Messina', regiao: 'Sicilia', provincia: 'Messina', sigla: 'ME', capitalProvincial: true },
  { nome: 'Ragusa', regiao: 'Sicilia', provincia: 'Ragusa', sigla: 'RG', capitalProvincial: true },
  { nome: 'Siracusa', regiao: 'Sicilia', provincia: 'Siracusa', sigla: 'SR', capitalProvincial: true },
  { nome: 'Trapani', regiao: 'Sicilia', provincia: 'Trapani', sigla: 'TP', capitalProvincial: true },
  // ── Toscana ──
  { nome: 'Firenze', regiao: 'Toscana', provincia: 'Firenze', sigla: 'FI', capitalRegional: true, capitalProvincial: true },
  { nome: 'Arezzo', regiao: 'Toscana', provincia: 'Arezzo', sigla: 'AR', capitalProvincial: true },
  { nome: 'Grosseto', regiao: 'Toscana', provincia: 'Grosseto', sigla: 'GR', capitalProvincial: true },
  { nome: 'Livorno', regiao: 'Toscana', provincia: 'Livorno', sigla: 'LI', capitalProvincial: true },
  { nome: 'Lucca', regiao: 'Toscana', provincia: 'Lucca', sigla: 'LU', capitalProvincial: true },
  { nome: 'Massa', regiao: 'Toscana', provincia: 'Massa-Carrara', sigla: 'MS', capitalProvincial: true },
  { nome: 'Pisa', regiao: 'Toscana', provincia: 'Pisa', sigla: 'PI', capitalProvincial: true },
  { nome: 'Pistoia', regiao: 'Toscana', provincia: 'Pistoia', sigla: 'PT', capitalProvincial: true },
  { nome: 'Prato', regiao: 'Toscana', provincia: 'Prato', sigla: 'PO', capitalProvincial: true },
  { nome: 'Siena', regiao: 'Toscana', provincia: 'Siena', sigla: 'SI', capitalProvincial: true },
  // ── Trentino-Alto Adige ──
  { nome: 'Trento', regiao: 'Trentino-Alto Adige', provincia: 'Trento', sigla: 'TN', capitalRegional: true, capitalProvincial: true },
  { nome: 'Bolzano', regiao: 'Trentino-Alto Adige', provincia: 'Bolzano', sigla: 'BZ', capitalRegional: true, capitalProvincial: true, observacoes: 'Comune bilíngue (Stadtgemeinde Bozen).' },
  { nome: 'Rovereto', regiao: 'Trentino-Alto Adige', provincia: 'Trento', sigla: 'TN', observacoes: 'Alta demanda — região de forte emigração para o Brasil.' },
  { nome: 'Pergine Valsugana', regiao: 'Trentino-Alto Adige', provincia: 'Trento', sigla: 'TN', observacoes: 'Alta demanda — região de forte emigração para o Brasil.' },
  { nome: 'Borgo Valsugana', regiao: 'Trentino-Alto Adige', provincia: 'Trento', sigla: 'TN', observacoes: 'Alta demanda — região de forte emigração para o Brasil.' },
  // ── Umbria ──
  { nome: 'Perugia', regiao: 'Umbria', provincia: 'Perugia', sigla: 'PG', capitalRegional: true, capitalProvincial: true },
  { nome: 'Terni', regiao: 'Umbria', provincia: 'Terni', sigla: 'TR', capitalProvincial: true },
  // ── Valle d'Aosta ──
  { nome: 'Aosta', regiao: "Valle d'Aosta", provincia: 'Aosta', sigla: 'AO', capitalRegional: true, capitalProvincial: true, observacoes: "Comune bilíngue (Commune d'Aoste)." },
  // ── Veneto ──
  { nome: 'Venezia', regiao: 'Veneto', provincia: 'Venezia', sigla: 'VE', capitalRegional: true, capitalProvincial: true },
  { nome: 'Belluno', regiao: 'Veneto', provincia: 'Belluno', sigla: 'BL', capitalProvincial: true },
  { nome: 'Padova', regiao: 'Veneto', provincia: 'Padova', sigla: 'PD', capitalProvincial: true },
  { nome: 'Rovigo', regiao: 'Veneto', provincia: 'Rovigo', sigla: 'RO', capitalProvincial: true },
  { nome: 'Treviso', regiao: 'Veneto', provincia: 'Treviso', sigla: 'TV', capitalProvincial: true },
  { nome: 'Verona', regiao: 'Veneto', provincia: 'Verona', sigla: 'VR', capitalProvincial: true },
  { nome: 'Vicenza', regiao: 'Veneto', provincia: 'Vicenza', sigla: 'VI', capitalProvincial: true },
  { nome: 'Bassano del Grappa', regiao: 'Veneto', provincia: 'Vicenza', sigla: 'VI', observacoes: 'Alta demanda — região de forte emigração para o Brasil.' },
  { nome: 'Schio', regiao: 'Veneto', provincia: 'Vicenza', sigla: 'VI', observacoes: 'Alta demanda — região de forte emigração para o Brasil.' },
  { nome: 'Thiene', regiao: 'Veneto', provincia: 'Vicenza', sigla: 'VI', observacoes: 'Alta demanda — região de forte emigração para o Brasil.' },
  { nome: 'Valdagno', regiao: 'Veneto', provincia: 'Vicenza', sigla: 'VI', observacoes: 'Alta demanda — região de forte emigração para o Brasil.' },
  { nome: 'Asiago', regiao: 'Veneto', provincia: 'Vicenza', sigla: 'VI', observacoes: 'Alta demanda — região de forte emigração para o Brasil.' },
  { nome: 'Conegliano', regiao: 'Veneto', provincia: 'Treviso', sigla: 'TV', observacoes: 'Alta demanda — região de forte emigração para o Brasil.' },
  { nome: 'Castelfranco Veneto', regiao: 'Veneto', provincia: 'Treviso', sigla: 'TV', observacoes: 'Alta demanda — região de forte emigração para o Brasil.' },
  { nome: 'Montebelluna', regiao: 'Veneto', provincia: 'Treviso', sigla: 'TV', observacoes: 'Alta demanda — região de forte emigração para o Brasil.' },
  { nome: 'Vittorio Veneto', regiao: 'Veneto', provincia: 'Treviso', sigla: 'TV', observacoes: 'Alta demanda — região de forte emigração para o Brasil.' },
  { nome: 'Feltre', regiao: 'Veneto', provincia: 'Belluno', sigla: 'BL', observacoes: 'Alta demanda — região de forte emigração para o Brasil.' },
  { nome: 'Legnago', regiao: 'Veneto', provincia: 'Verona', sigla: 'VR', observacoes: 'Alta demanda — região de forte emigração para o Brasil.' },
]

/** Comune → registro do cadastro mestre (um só, com as duas funções). */
export function comuneParaOrganizacao(c: ComuneSeed): OrganizacaoSeed {
  const papel = c.capitalRegional ? 'capoluogo di regione' : c.capitalProvincial ? 'capoluogo di provincia' : 'comune'
  return {
    name: `Comune di ${c.nome}`,
    nomeFantasia: `${c.nome} (${c.sigla})`,
    type: 'comune',
    country: 'Itália',
    state: c.regiao,
    provincia: `${c.provincia} (${c.sigla})`,
    city: c.nome,
    idioma: 'it',
    moeda: 'EUR',
    observacoes: [`Ufficio dello Stato Civile e Anagrafe — ${papel}.`, c.observacoes].filter(Boolean).join(' '),
    tags: ['italia', 'comune', c.sigla.toLowerCase(), ...(c.capitalRegional ? ['capoluogo-regione'] : []), ...(c.capitalProvincial ? ['capoluogo-provincia'] : [])],
    categorias: ['comuni', 'registros-civis'],
    funcoes: ['ORGAO', 'FORNECEDOR'],
  }
}

// ═══════════════════════ FORNECEDORES REAIS ═════════════════════════════════
//
// Empresas REAIS com que a operação gasta. Entram no MESMO cadastro, com a
// função FORNECEDOR — não existe cadastro de fornecedor separado.
//
// CNPJ, dados bancários, chave PIX e contato financeiro NÃO são semeados: são
// dados que só o escritório conhece com segurança. Campo vazio > dado inventado.

export const FORNECEDORES: OrganizacaoSeed[] = [
  // ── transporte e logística ──
  { name: 'DHL Express', type: 'outro', country: 'Brasil', site: 'https://www.dhl.com', idioma: 'pt', moeda: 'BRL', categorias: ['transportadoras', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['logistica', 'internacional'] },
  { name: 'FedEx Express', nomeFantasia: 'FedEx', type: 'outro', country: 'Brasil', site: 'https://www.fedex.com', idioma: 'pt', moeda: 'BRL', categorias: ['transportadoras', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['logistica', 'internacional'] },
  { name: 'UPS — United Parcel Service', nomeFantasia: 'UPS', type: 'outro', country: 'Brasil', site: 'https://www.ups.com', idioma: 'pt', moeda: 'BRL', categorias: ['transportadoras', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['logistica', 'internacional'] },
  { name: 'Jadlog Logística', nomeFantasia: 'Jadlog', type: 'outro', country: 'Brasil', state: 'SP', city: 'São Paulo', site: 'https://www.jadlog.com.br', idioma: 'pt', moeda: 'BRL', categorias: ['transportadoras', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['logistica', 'nacional'] },
  { name: 'Azul Cargo Express', type: 'outro', country: 'Brasil', state: 'SP', city: 'Barueri', site: 'https://www.azulcargo.com.br', idioma: 'pt', moeda: 'BRL', categorias: ['transportadoras', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['logistica', 'nacional'] },
  { name: 'LATAM Cargo Brasil', type: 'outro', country: 'Brasil', state: 'SP', city: 'São Paulo', site: 'https://www.latamcargo.com', idioma: 'pt', moeda: 'BRL', categorias: ['transportadoras', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['logistica', 'nacional'] },

  // ── bancos e pagamentos ──
  { name: 'Banco do Brasil S.A.', nomeFantasia: 'Banco do Brasil', type: 'outro', country: 'Brasil', state: 'DF', city: 'Brasília', site: 'https://www.bb.com.br', idioma: 'pt', moeda: 'BRL', categorias: ['bancos', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['financeiro'] },
  { name: 'Caixa Econômica Federal', nomeFantasia: 'Caixa', type: 'outro', country: 'Brasil', state: 'DF', city: 'Brasília', site: 'https://www.caixa.gov.br', idioma: 'pt', moeda: 'BRL', categorias: ['bancos', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['financeiro'] },
  { name: 'Itaú Unibanco S.A.', nomeFantasia: 'Itaú', type: 'outro', country: 'Brasil', state: 'SP', city: 'São Paulo', site: 'https://www.itau.com.br', idioma: 'pt', moeda: 'BRL', categorias: ['bancos', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['financeiro'] },
  { name: 'Banco Bradesco S.A.', nomeFantasia: 'Bradesco', type: 'outro', country: 'Brasil', state: 'SP', city: 'Osasco', site: 'https://www.bradesco.com.br', idioma: 'pt', moeda: 'BRL', categorias: ['bancos', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['financeiro'] },
  { name: 'Banco Santander (Brasil) S.A.', nomeFantasia: 'Santander', type: 'outro', country: 'Brasil', state: 'SP', city: 'São Paulo', site: 'https://www.santander.com.br', idioma: 'pt', moeda: 'BRL', categorias: ['bancos', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['financeiro'] },
  { name: 'Nu Pagamentos S.A.', nomeFantasia: 'Nubank', type: 'outro', country: 'Brasil', state: 'SP', city: 'São Paulo', site: 'https://nubank.com.br', idioma: 'pt', moeda: 'BRL', categorias: ['bancos', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['financeiro'] },
  { name: 'Sicredi — Sistema de Crédito Cooperativo', nomeFantasia: 'Sicredi', type: 'outro', country: 'Brasil', state: 'RS', city: 'Porto Alegre', site: 'https://www.sicredi.com.br', idioma: 'pt', moeda: 'BRL', categorias: ['bancos', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['financeiro'] },
  { name: 'Sicoob — Sistema de Cooperativas de Crédito do Brasil', nomeFantasia: 'Sicoob', type: 'outro', country: 'Brasil', state: 'DF', city: 'Brasília', site: 'https://www.sicoob.com.br', idioma: 'pt', moeda: 'BRL', categorias: ['bancos', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['financeiro'] },
  { name: 'Wise Payments Limited', nomeFantasia: 'Wise', type: 'outro', country: 'Reino Unido', city: 'London', site: 'https://wise.com', idioma: 'en', moeda: 'EUR', observacoes: 'Câmbio e pagamentos internacionais — remessas para órgãos no exterior.', categorias: ['bancos', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['financeiro', 'cambio', 'internacional'] },
  { name: 'PayPal Holdings, Inc.', nomeFantasia: 'PayPal', type: 'outro', country: 'Estados Unidos', state: 'CA', city: 'San Jose', site: 'https://www.paypal.com', idioma: 'en', moeda: 'USD', categorias: ['bancos', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['financeiro', 'internacional'] },
  { name: 'Stripe, Inc.', nomeFantasia: 'Stripe', type: 'outro', country: 'Estados Unidos', state: 'CA', city: 'South San Francisco', site: 'https://stripe.com', idioma: 'en', moeda: 'USD', categorias: ['bancos', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['financeiro', 'internacional'] },
  { name: 'Mercado Pago', type: 'outro', country: 'Brasil', state: 'SP', city: 'São Paulo', site: 'https://www.mercadopago.com.br', idioma: 'pt', moeda: 'BRL', categorias: ['bancos', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['financeiro'] },
  { name: 'PagSeguro Internet S.A.', nomeFantasia: 'PagBank', type: 'outro', country: 'Brasil', state: 'SP', city: 'São Paulo', site: 'https://pagseguro.uol.com.br', idioma: 'pt', moeda: 'BRL', categorias: ['bancos', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['financeiro'] },

  // ── tecnologia e operação ──
  { name: 'Microsoft Corporation', nomeFantasia: 'Microsoft', type: 'outro', country: 'Estados Unidos', state: 'WA', city: 'Redmond', site: 'https://www.microsoft.com', idioma: 'en', moeda: 'USD', categorias: ['fornecedores'], funcoes: ['FORNECEDOR'], tags: ['tecnologia'] },
  { name: 'Google LLC', nomeFantasia: 'Google', type: 'outro', country: 'Estados Unidos', state: 'CA', city: 'Mountain View', site: 'https://www.google.com', idioma: 'en', moeda: 'USD', categorias: ['fornecedores'], funcoes: ['FORNECEDOR'], tags: ['tecnologia'] },
  { name: 'Amazon Web Services, Inc.', nomeFantasia: 'AWS', type: 'outro', country: 'Estados Unidos', state: 'WA', city: 'Seattle', site: 'https://aws.amazon.com', idioma: 'en', moeda: 'USD', categorias: ['fornecedores'], funcoes: ['FORNECEDOR'], tags: ['tecnologia', 'nuvem'] },
  { name: 'Cloudflare, Inc.', nomeFantasia: 'Cloudflare', type: 'outro', country: 'Estados Unidos', state: 'CA', city: 'San Francisco', site: 'https://www.cloudflare.com', idioma: 'en', moeda: 'USD', categorias: ['fornecedores'], funcoes: ['FORNECEDOR'], tags: ['tecnologia', 'nuvem'] },
  { name: 'Vercel, Inc.', nomeFantasia: 'Vercel', type: 'outro', country: 'Estados Unidos', state: 'CA', city: 'San Francisco', site: 'https://vercel.com', idioma: 'en', moeda: 'USD', categorias: ['fornecedores'], funcoes: ['FORNECEDOR'], tags: ['tecnologia', 'nuvem'] },
  { name: 'Adobe Inc.', nomeFantasia: 'Adobe', type: 'outro', country: 'Estados Unidos', state: 'CA', city: 'San Jose', site: 'https://www.adobe.com', idioma: 'en', moeda: 'USD', categorias: ['fornecedores'], funcoes: ['FORNECEDOR'], tags: ['tecnologia'] },
  { name: 'DocuSign, Inc.', nomeFantasia: 'DocuSign', type: 'outro', country: 'Estados Unidos', state: 'CA', city: 'San Francisco', site: 'https://www.docusign.com', idioma: 'en', moeda: 'USD', categorias: ['certificacao-digital', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['assinatura-digital'] },
  { name: 'Clicksign Gestão de Documentos S.A.', nomeFantasia: 'Clicksign', type: 'outro', country: 'Brasil', state: 'SP', city: 'São Paulo', site: 'https://www.clicksign.com', idioma: 'pt', moeda: 'BRL', categorias: ['certificacao-digital', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['assinatura-digital'] },
  { name: 'Certisign Certificadora Digital S.A.', nomeFantasia: 'Certisign', type: 'outro', country: 'Brasil', state: 'SP', city: 'São Paulo', site: 'https://www.certisign.com.br', idioma: 'pt', moeda: 'BRL', categorias: ['certificacao-digital', 'fornecedores'], funcoes: ['FORNECEDOR'], tags: ['assinatura-digital', 'icp-brasil'] },
  { name: 'Serasa Experian', type: 'outro', country: 'Brasil', state: 'SP', city: 'São Paulo', site: 'https://www.serasaexperian.com.br', idioma: 'pt', moeda: 'BRL', categorias: ['fornecedores'], funcoes: ['FORNECEDOR'], tags: ['dados', 'consulta'] },
]

/** Base completa: entidades oficiais + comuni italianos + fornecedores reais. */
export const BASE_COMPLETA: OrganizacaoSeed[] = [
  ...ORGANIZACOES,
  ...COMUNI.map(comuneParaOrganizacao),
  ...FORNECEDORES,
]

/**
 * Sanidade do próprio arquivo, sobre a BASE COMPLETA: nenhuma entidade declarada
 * duas vezes (nem entre blocos), nenhuma categoria órfã, nenhuma organização sem
 * classificação e nenhuma sem função.
 */
export function validarBase(): string[] {
  const problemas: string[] = []
  const codes = new Set<string>()
  for (const c of CATEGORIAS) {
    if (codes.has(c.code)) problemas.push(`categoria duplicada: ${c.code}`)
    codes.add(c.code)
  }
  const chaves = new Set<string>()
  for (const o of BASE_COMPLETA) {
    const chave = `${o.name}::${o.country}`
    if (chaves.has(chave)) problemas.push(`organização duplicada: ${chave}`)
    chaves.add(chave)
    if (!o.categorias.length) problemas.push(`organização sem categoria: ${o.name}`)
    if (!funcoesDe(o).length) problemas.push(`organização sem função: ${o.name}`)
    for (const c of o.categorias) if (!codes.has(c)) problemas.push(`categoria inexistente "${c}" em ${o.name}`)
  }
  // comuni: região e província obrigatórias — é o vínculo territorial do ato
  const siglas = /^[A-Z]{2}$/
  for (const c of COMUNI) {
    if (!c.regiao) problemas.push(`comune sem região: ${c.nome}`)
    if (!c.provincia) problemas.push(`comune sem província: ${c.nome}`)
    if (!siglas.test(c.sigla)) problemas.push(`sigla de província inválida em ${c.nome}: ${c.sigla}`)
  }
  return problemas
}
