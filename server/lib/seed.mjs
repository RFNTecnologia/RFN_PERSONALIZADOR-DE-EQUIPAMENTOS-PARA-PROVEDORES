/**
 * Estado padrao do servidor do provedor.
 *
 * Um servidor recem-instalado ja precisa entregar um perfil aplicavel: sem
 * perfil nao existe pacote de configuracao e, portanto, nao existe
 * restauracao pos-reset. Por isso o seed traz um perfil de referencia para
 * cada familia de equipamento e um equipamento de exemplo ja vinculado ao
 * identificador de provisionamento do provedor.
 *
 * O operador substitui tudo pela tela "Perfis" do painel; este arquivo e
 * apenas o ponto de partida.
 */

export const ESTADO_PADRAO = {
  branding: {
    id: 'br-default',
    nome: 'Identidade padrão do provedor',
    marca: 'FibraSul',
    logoUrl: '',
    corPrimaria: '#1d4ed8',
    corPrimariaTexto: '#ffffff',
    corFundo: '#f1f5f9',
    corPainel: '#ffffff',
    corTexto: '#0f172a',
    corBorda: '#e2e8f0',
    raio: 12,
    tema: 'claro',
    titulo: 'Conecte-se à sua internet',
    subtitulo: 'Informe suas credenciais para acessar o equipamento.',
    rotuloBotao: 'Entrar',
    rodape: 'Gerenciado pelo seu provedor',
    camposExtras: [],
    mostrarTermos: true,
    textoTermos: 'Ao acessar, você concorda com os Termos de Uso.',
    mostrarWifi: true,
    mostrarVelocidade: true,
    linkAjuda: '',
  },
  perfis: [
    {
      id: 'p-cx588',
      nome: 'CPE residencial CX588',
      tipo: 'roteador',
      modelos: ['cx588', 'CX588'],
      descricao:
        'Perfil de referência para CPE residencial com restoring pos-reset via ACS (TR-069) e bootstrap por URL.',
      wan: { modo: 'pppoe', usuario: 'cliente@isp', senha: '', vlan: 100, mtu: 1492 },
      lan: {
        gateway: '192.168.15.1',
        faixa: '192.168.15.0/24',
        dns: ['1.1.1.1', '8.8.8.8'],
        dnsSecundario: '9.9.9.9',
      },
      wifi: {
        ssid: 'FibraSul',
        banda: 'dual-band',
        senha: '',
        canal: 'auto',
        larguraCanal: '40MHz',
        oculta: false,
      },
      gestao: {
        acsUrl: '',
        intervaloMin: 60,
        metodoRestore: 'tr069-acs',
        urlBootstrap: '',
        dhcpOption43: '',
        dhcpOption60: 'FibraSul-CPE',
        aplicarBranding: true,
        aplicarFirmware: false,
        forcarAtualizacao: false,
        firmwareUrl: '',
        firmwareVersao: '',
      },
    },
    {
      id: 'p-ont',
      nome: 'ONT GPON — enterprise',
      tipo: 'ont',
      modelos: ['Nokia G-140W-C', 'Fiberhome HG8145V5'],
      descricao: 'ONT com bridge, VLAN de Triple Play e restauracao via ACS.',
      wan: { modo: 'ip-estatico', usuario: '', senha: '', vlan: 200, mtu: 1500 },
      lan: {
        gateway: '10.30.0.1',
        faixa: '10.30.0.0/24',
        dns: ['9.9.9.9'],
        dnsSecundario: '1.0.0.1',
      },
      wifi: {
        ssid: 'FibraSul',
        banda: '5GHz',
        senha: '',
        canal: 'auto',
        larguraCanal: '80MHz',
        oculta: false,
      },
      gestao: {
        acsUrl: '',
        intervaloMin: 30,
        metodoRestore: 'tr069-acs',
        urlBootstrap: '',
        dhcpOption43: '',
        dhcpOption60: 'FibraSul-ONT',
        aplicarBranding: true,
        aplicarFirmware: false,
        forcarAtualizacao: false,
        firmwareUrl: '',
        firmwareVersao: '',
      },
    },
  ],
  clientes: [],
  equipamentos: [
    {
      id: 'eq-38f3d149b1ba',
      serial: '38F3D149B1BA',
      mac: '',
      modelo: 'cx588',
      fabricante: '',
      tipo: 'roteador',
      clienteId: '',
      perfilId: 'p-cx588',
      status: 'em-recuperacao',
      ip: '',
      firmware: '',
      firmwareAlvo: '',
      ultimoContato: null,
      sincronizadoEm: null,
      configHash: '—',
      restaurado: true,
      tokenRecuperacao: 'rcv_38f3d149',
      identificador: 'gru1::cx588-1793224550476-38f3d149b1ba',
      grupo: 'gru1',
      origem: 'importação manual',
    },
  ],
  logs: [],
  politica: {
    ativa: true,
    metodoPadrao: 'tr069-acs',
    bloqueiaAcessoLocal: true,
    senhaAdminPadrao: '',
    bloqueiaResetFisico: false,
    esperaBootSegundos: 90,
    notificaCliente: true,
    mensagemCliente: 'Seu equipamento foi restaurado com as configurações do provedor.',
    fallbackOffline: true,
    intervaloTentativasMin: 5,
  },
  versao: 1,
}

export function estadoPadrao() {
  return structuredClone(ESTADO_PADRAO)
}
