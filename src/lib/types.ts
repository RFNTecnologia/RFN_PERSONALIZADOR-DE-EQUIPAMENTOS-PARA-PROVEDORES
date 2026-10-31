export type TipoEquipamento = 'roteador' | 'ont' | 'modem' | 'mesh' | 'switch'

export type StatusCPE =
  | 'online'
  | 'offline'
  | 'provisionando'
  | 'atualizando'
  | 'em-recuperacao'

export interface Cliente {
  id: string
  nome: string
  contrato: string
  plano: string
  cidade: string
}

export interface CampoExtra {
  id: string
  rotulo: string
  tipo: 'texto' | 'cpf' | 'contrato' | 'telefone'
  placeholder: string
  obrigatorio: boolean
}

export interface Branding {
  id: string
  nome: string
  marca: string
  logoUrl: string
  corPrimaria: string
  corPrimariaTexto: string
  corFundo: string
  corPainel: string
  corTexto: string
  corBorda: string
  raio: number
  tema: 'claro' | 'escuro'
  titulo: string
  subtitulo: string
  rotuloBotao: string
  rodape: string
  camposExtras: CampoExtra[]
  mostrarTermos: boolean
  textoTermos: string
  mostrarWifi: boolean
  mostrarVelocidade: boolean
  linkAjuda: string
}

export interface WanConfig {
  modo: 'pppoe' | 'ip-estatico' | 'dhcp'
  usuario: string
  senha: string
  vlan: number
  mtu: number
}

export interface LanConfig {
  gateway: string
  faixa: string
  dns: string[]
  dnsSecundario: string
}

export interface WifiConfig {
  ssid: string
  banda: '2.4GHz' | '5GHz' | 'dual-band'
  senha: string
  canal: string
  larguraCanal: '20MHz' | '40MHz' | '80MHz' | '160MHz'
  oculta: boolean
}

export type MetodoRestore = 'tr069-acs' | 'url-bootstrap' | 'token-nuvem'

export interface GestaoConfig {
  acsUrl: string
  intervaloMin: number
  metodoRestore: MetodoRestore
  urlBootstrap: string
  dhcpOption43: string
  dhcpOption60: string
  aplicarBranding: boolean
  aplicarFirmware: boolean
  forcarAtualizacao: boolean
  /** URL publica do firmware hospedado no servidor do provedor. */
  firmwareUrl?: string
  /** Versao alvo do firmware. */
  firmwareVersao?: string
}

export interface Perfil {
  id: string
  nome: string
  tipo: TipoEquipamento
  modelos: string[]
  descricao: string
  wan: WanConfig
  lan: LanConfig
  wifi: WifiConfig
  gestao: GestaoConfig
}

export interface Equipamento {
  id: string
  serial: string
  mac: string
  modelo: string
  fabricante: string
  tipo: TipoEquipamento
  clienteId: string
  perfilId: string
  status: StatusCPE
  ip: string
  firmware: string
  firmwareAlvo: string
  ultimoContato: string
  sincronizadoEm: string | null
  configHash: string
  restaurado: boolean
  tokenRecuperacao: string
  /** Identificador de provisionamento do provedor (grupo::modelo-carimbo-uid). */
  identificador?: string
  /** Grupo logico do equipamento (filial, lote, regional). */
  grupo?: string
  /** Como o equipamento entrou no cadastro. */
  origem?: string
}

export type TipoEvento =
  | 'provisionamento'
  | 'reset'
  | 'restauracao'
  | 'branding'
  | 'firmware'
  | 'alerta'

export interface EventoLog {
  id: string
  em: string
  tipo: TipoEvento
  equipamentoId: string | null
  mensagem: string
  detalhe: string
  resultado: 'sucesso' | 'falha' | 'pendente'
}

export interface PoliticaRestore {
  ativa: boolean
  metodoPadrao: MetodoRestore
  bloqueiaAcessoLocal: boolean
  senhaAdminPadrao: string
  bloqueiaResetFisico: boolean
  esperaBootSegundos: number
  notificaCliente: boolean
  mensagemCliente: string
  fallbackOffline: boolean
  intervaloTentativasMin: number
}

export interface EstadoApp {
  branding: Branding
  perfis: Perfil[]
  clientes: Cliente[]
  equipamentos: Equipamento[]
  logs: EventoLog[]
  politica: PoliticaRestore
}
