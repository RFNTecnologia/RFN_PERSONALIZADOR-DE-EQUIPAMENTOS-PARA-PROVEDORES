/**
 * Gera um .zip (sem dependencias externas) com os arquivos do pacote de
 * instalacao.
 *
 * O Windows abre .zip nativamente (Expand-Archive / Explorer) e o tar.exe do
 * Windows recusou o .tar.gz em alguns ambientes, entao o pacote tambem e
 * oferecido no formato zip.
 *
 * Formato: entries com metodo "deflate" (zlib) e diretorio central no fim.
 */

import zlib from 'node:zlib'

const TABELA_CRC = (() => {
  const tabela = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    tabela[i] = c >>> 0
  }
  return tabela
})()

export function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    crc = TABELA_CRC[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dataHora(date) {
  const hora = date.getHours()
  const minuto = date.getMinutes()
  const segundo = Math.floor(date.getSeconds() / 2)
  return {
    hora: (hora << 11) | (minuto << 5) | segundo,
    data: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/**
 * Monta um zip a partir de uma lista de arquivos.
 * Espera: [{ nome, conteudo (Buffer|string), modo? }]
 */
export function criarZip(arquivos, data = new Date()) {
  const { hora, data: dia } = dataHora(data)
  const locais = []
  const central = []
  let deslocamento = 0

  for (const arquivo of arquivos) {
    const conteudo = Buffer.isBuffer(arquivo.conteudo)
      ? arquivo.conteudo
      : Buffer.from(arquivo.conteudo ?? '', 'utf8')
    const nome = String(arquivo.nome || 'arquivo').replace(/\\/g, '/')
    const nomeBuffer = Buffer.from(nome, 'utf8')
    const comprimido = zlib.deflateRawSync(conteudo, { level: 9 })
    const crc = crc32(conteudo)
    const modo = (arquivo.modo ?? 0o644) & 0o7777
    const externo = (modo & 0o111 ? 0o755 : 0o644) << 16

    const cabecalho = Buffer.alloc(30)
    cabecalho.writeUInt32LE(0x04034b50, 0)
    cabecalho.writeUInt16LE(20, 4)
    cabecalho.writeUInt16LE(0x0800, 6) // nomes em UTF-8
    cabecalho.writeUInt16LE(8, 8) // deflate
    cabecalho.writeUInt16LE(hora, 10)
    cabecalho.writeUInt16LE(dia, 12)
    cabecalho.writeUInt32LE(crc, 14)
    cabecalho.writeUInt32LE(comprimido.length, 18)
    cabecalho.writeUInt32LE(conteudo.length, 22)
    cabecalho.writeUInt16LE(nomeBuffer.length, 26)
    cabecalho.writeUInt16LE(0, 28)

    locais.push(cabecalho, nomeBuffer, comprimido)

    const entrada = Buffer.alloc(46)
    entrada.writeUInt32LE(0x02014b50, 0)
    entrada.writeUInt16LE(0x031e, 4) // criado por UNIX, versao 3.0
    entrada.writeUInt16LE(20, 6)
    entrada.writeUInt16LE(0x0800, 8)
    entrada.writeUInt16LE(8, 10)
    entrada.writeUInt16LE(hora, 12)
    entrada.writeUInt16LE(dia, 14)
    entrada.writeUInt32LE(crc, 16)
    entrada.writeUInt32LE(comprimido.length, 20)
    entrada.writeUInt32LE(conteudo.length, 24)
    entrada.writeUInt16LE(nomeBuffer.length, 28)
    entrada.writeUInt16LE(0, 30)
    entrada.writeUInt16LE(0, 32)
    entrada.writeUInt16LE(0, 34)
    entrada.writeUInt16LE(0, 36)
    entrada.writeUInt32LE(externo, 38)
    entrada.writeUInt32LE(deslocamento, 42)
    central.push(entrada, nomeBuffer)

    deslocamento += cabecalho.length + nomeBuffer.length + comprimido.length
  }

  const conteudoCentral = Buffer.concat(central)
  const fim = Buffer.alloc(22)
  fim.writeUInt32LE(0x06054b50, 0)
  fim.writeUInt16LE(0, 4)
  fim.writeUInt16LE(0, 6)
  fim.writeUInt16LE(arquivos.length, 8)
  fim.writeUInt16LE(arquivos.length, 10)
  fim.writeUInt32LE(conteudoCentral.length, 12)
  fim.writeUInt32LE(deslocamento, 16)
  fim.writeUInt16LE(0, 20)

  return Buffer.concat([...locais, conteudoCentral, fim])
}
