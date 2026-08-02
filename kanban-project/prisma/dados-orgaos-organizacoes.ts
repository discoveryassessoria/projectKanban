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

export interface OrganizacaoSeed {
  /** Nome OFICIAL — na língua e grafia da entidade. */
  name: string
  /** Sigla ou nome usual. */
  nomeFantasia?: string
  /** type legado (consulado|comune|tribunal|conservatoria|cartorio|ministerio|prefeitura|tradutor|apostilamento|outro) */
  type?: string
  country: string
  state?: string
  city?: string
  site?: string
  idioma?: string
  moeda?: string
  observacoes?: string
  tags?: string[]
  /** codes de CategoriaOrganizacao */
  categorias: string[]
}

// ══════════════════════════════ CATEGORIAS ══════════════════════════════════
export const CATEGORIAS: CategoriaSeed[] = [
  { code: 'consulados', nome: 'Consulados', descricao: 'Repartições consulares que recebem pedidos de nacionalidade e emitem documentos.', ordem: 10 },
  { code: 'embaixadas', nome: 'Embaixadas', descricao: 'Representações diplomáticas junto ao governo do país anfitrião.', ordem: 20 },
  { code: 'cartorios', nome: 'Cartórios', descricao: 'Serventias extrajudiciais brasileiras.', ordem: 30 },
  { code: 'registros-civis', nome: 'Registros Civis', descricao: 'Órgãos de registro civil de nascimento, casamento e óbito.', ordem: 40 },
  { code: 'tribunais', nome: 'Tribunais', descricao: 'Órgãos do Poder Judiciário.', ordem: 50 },
  { code: 'ministerios', nome: 'Ministérios', descricao: 'Pastas do governo central.', ordem: 60 },
  { code: 'prefeituras', nome: 'Prefeituras', descricao: 'Administrações municipais (inclui Comuni italianos e Ayuntamientos).', ordem: 70 },
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
  { name: 'Comune di Roma', type: 'comune', country: 'Itália', state: 'Lazio', city: 'Roma', site: 'https://www.comune.roma.it', idioma: 'it', moeda: 'EUR', categorias: ['prefeituras', 'registros-civis'], tags: ['italia', 'comune'] },
  { name: 'Comune di Milano', type: 'comune', country: 'Itália', state: 'Lombardia', city: 'Milano', site: 'https://www.comune.milano.it', idioma: 'it', moeda: 'EUR', categorias: ['prefeituras', 'registros-civis'], tags: ['italia', 'comune'] },
  { name: 'Comune di Napoli', type: 'comune', country: 'Itália', state: 'Campania', city: 'Napoli', idioma: 'it', moeda: 'EUR', categorias: ['prefeituras', 'registros-civis'], tags: ['italia', 'comune'] },
  { name: 'Comune di Torino', type: 'comune', country: 'Itália', state: 'Piemonte', city: 'Torino', idioma: 'it', moeda: 'EUR', categorias: ['prefeituras', 'registros-civis'], tags: ['italia', 'comune'] },
  { name: 'Comune di Venezia', type: 'comune', country: 'Itália', state: 'Veneto', city: 'Venezia', idioma: 'it', moeda: 'EUR', categorias: ['prefeituras', 'registros-civis'], tags: ['italia', 'comune'] },
  { name: 'Comune di Firenze', type: 'comune', country: 'Itália', state: 'Toscana', city: 'Firenze', idioma: 'it', moeda: 'EUR', categorias: ['prefeituras', 'registros-civis'], tags: ['italia', 'comune'] },
  { name: 'Comune di Bologna', type: 'comune', country: 'Itália', state: 'Emilia-Romagna', city: 'Bologna', idioma: 'it', moeda: 'EUR', categorias: ['prefeituras', 'registros-civis'], tags: ['italia', 'comune'] },
  { name: 'Comune di Genova', type: 'comune', country: 'Itália', state: 'Liguria', city: 'Genova', idioma: 'it', moeda: 'EUR', categorias: ['prefeituras', 'registros-civis'], tags: ['italia', 'comune'] },
  { name: 'Comune di Palermo', type: 'comune', country: 'Itália', state: 'Sicilia', city: 'Palermo', idioma: 'it', moeda: 'EUR', categorias: ['prefeituras', 'registros-civis'], tags: ['italia', 'comune'] },
  { name: 'Comune di Bari', type: 'comune', country: 'Itália', state: 'Puglia', city: 'Bari', idioma: 'it', moeda: 'EUR', categorias: ['prefeituras', 'registros-civis'], tags: ['italia', 'comune'] },
  { name: 'Comune di Trento', type: 'comune', country: 'Itália', state: 'Trentino-Alto Adige', city: 'Trento', idioma: 'it', moeda: 'EUR', categorias: ['prefeituras', 'registros-civis'], tags: ['italia', 'comune'] },
  { name: 'Comune di Vicenza', type: 'comune', country: 'Itália', state: 'Veneto', city: 'Vicenza', idioma: 'it', moeda: 'EUR', categorias: ['prefeituras', 'registros-civis'], tags: ['italia', 'comune'] },
  { name: 'Comune di Treviso', type: 'comune', country: 'Itália', state: 'Veneto', city: 'Treviso', idioma: 'it', moeda: 'EUR', categorias: ['prefeituras', 'registros-civis'], tags: ['italia', 'comune'] },
  { name: 'Comune di Belluno', type: 'comune', country: 'Itália', state: 'Veneto', city: 'Belluno', idioma: 'it', moeda: 'EUR', categorias: ['prefeituras', 'registros-civis'], tags: ['italia', 'comune'] },
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

  // ───────────────── LOGÍSTICA E SERVIÇOS (empresas reais) ──────────────────
  { name: 'DHL Express', type: 'outro', country: 'Brasil', site: 'https://www.dhl.com', idioma: 'pt', moeda: 'BRL', categorias: ['transportadoras', 'fornecedores'], tags: ['logistica', 'internacional'] },
  { name: 'FedEx Express', type: 'outro', country: 'Brasil', site: 'https://www.fedex.com', idioma: 'pt', moeda: 'BRL', categorias: ['transportadoras', 'fornecedores'], tags: ['logistica', 'internacional'] },
  { name: 'UPS — United Parcel Service', type: 'outro', country: 'Brasil', site: 'https://www.ups.com', idioma: 'pt', moeda: 'BRL', categorias: ['transportadoras', 'fornecedores'], tags: ['logistica', 'internacional'] },
  { name: 'Jadlog Logística', type: 'outro', country: 'Brasil', state: 'SP', city: 'São Paulo', site: 'https://www.jadlog.com.br', idioma: 'pt', moeda: 'BRL', categorias: ['transportadoras', 'fornecedores'], tags: ['logistica', 'nacional'] },
  { name: 'Azul Cargo Express', type: 'outro', country: 'Brasil', state: 'SP', city: 'Barueri', site: 'https://www.azulcargo.com.br', idioma: 'pt', moeda: 'BRL', categorias: ['transportadoras', 'fornecedores'], tags: ['logistica', 'nacional'] },
  { name: 'LATAM Cargo Brasil', type: 'outro', country: 'Brasil', state: 'SP', city: 'São Paulo', site: 'https://www.latamcargo.com', idioma: 'pt', moeda: 'BRL', categorias: ['transportadoras', 'fornecedores'], tags: ['logistica', 'nacional'] },
  { name: 'Instituto Nacional de Tecnologia da Informação', nomeFantasia: 'ITI', type: 'outro', country: 'Brasil', state: 'DF', city: 'Brasília', site: 'https://www.gov.br/iti', idioma: 'pt', moeda: 'BRL', observacoes: 'Autoridade Certificadora Raiz da ICP-Brasil.', categorias: ['certificacao-digital', 'governos-nacionais'], tags: ['brasil', 'assinatura-digital'] },
]

/** Sanidade do próprio arquivo: sem duplicidade e sem categoria inexistente. */
export function validarBase(): string[] {
  const problemas: string[] = []
  const codes = new Set<string>()
  for (const c of CATEGORIAS) {
    if (codes.has(c.code)) problemas.push(`categoria duplicada: ${c.code}`)
    codes.add(c.code)
  }
  const chaves = new Set<string>()
  for (const o of ORGANIZACOES) {
    const chave = `${o.name}::${o.country}`
    if (chaves.has(chave)) problemas.push(`organização duplicada: ${chave}`)
    chaves.add(chave)
    if (!o.categorias.length) problemas.push(`organização sem categoria: ${o.name}`)
    for (const c of o.categorias) if (!codes.has(c)) problemas.push(`categoria inexistente "${c}" em ${o.name}`)
  }
  return problemas
}
