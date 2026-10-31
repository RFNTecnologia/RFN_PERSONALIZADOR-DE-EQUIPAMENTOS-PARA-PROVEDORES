/**
 * Identificador de provisionamento do provedor.
 *
 * Formato: <grupo>::<modelo>-<carimbo_ms>-<uid>
 *   grupo    agrupamento logico (filial, lote ou campanha de troca)
 *   modelo   codigo do modelo do CPE (cx588, g140wc, ...)
 *   carimbo  epoch em milissegundos (quando o registro foi gerado)
 *   uid      identificador unico do equipamento dentro do grupo
 *
 * Exemplo: gru1::cx588-1793224550476-38f3d149b1ba
 *
 * O identificador e o vinculo estavel entre o equipamento (que pode ter o
 * serial apagado por um reset de fabrica) e a configuracao do provedor.
 */

const REGEX = /^([a-z0-9_-]{1,16})::([a-z0-9._-]{1,32})-(\d{10,13})-([a-z0-9]{6,32})$/i

export function parseIdentificador(valor) {
  const bruto = String(valor ?? '').trim()
  if (!bruto) {
    return { valido: false, bruto, motivo: 'identificador vazio' }
  }
  const achado = REGEX.exec(bruto)
  if (!achado) {
    return {
      valido: false,
      bruto,
      motivo: 'formato esperado: grupo::modelo-carimbo-uid',
    }
  }
  const [, grupo, modelo, carimboTexto, uid] = achado
  let carimbo = Number(carimboTexto)
  // Epoch em segundos (10 digitos) e convertido para milissegundos.
  if (carimbo < 1e12) carimbo *= 1000
  const data = new Date(carimbo)
  return {
    valido: true,
    bruto,
    grupo: grupo.toLowerCase(),
    modelo: modelo.toLowerCase(),
    carimbo,
    criadoEm: Number.isNaN(data.getTime()) ? null : data.toISOString(),
    uid: uid.toLowerCase(),
  }
}

export function identificadorValido(valor) {
  return parseIdentificador(valor).valido
}

/** Gera um identificador novo no formato padrao do provedor. */
export function formatarIdentificador({ grupo = 'gru1', modelo = 'cpe', uid, carimbo } = {}) {
  const modeloLimpo = String(modelo || 'cpe')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'cpe'
  const grupoLimpo = String(grupo || 'gru1')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'gru1'
  const momento = carimbo ?? Date.now()
  const sufixo =
    String(uid || Math.random().toString(16).slice(2, 14).padEnd(12, '0'))
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 32) || '000000000000'
  return `${grupoLimpo}::${modeloLimpo}-${momento}-${sufixo}`
}
