/**
 * Gera a pagina de login do cliente como artefato autonomouso (HTML + CSS inline).
 * O arquivo gerado pode ser publicado no CPE (web server local, tema LuCI,
 * captive portal) sem depender do painel.
 */

function escapar(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function gerarPaginaLogin({ branding, perfil, opcoes = {} }) {
  const escuro = branding.tema === 'escuro'
  const texto = escuro ? '#f8fafc' : branding.corTexto
  const painel = escuro ? '#111827' : branding.corPainel
  const borda = escuro ? '#1f2937' : branding.corBorda
  const campo = escuro ? '#0b1220' : '#ffffff'
  const fundo = escuro ? '#020617' : branding.corFundo
  const destino = opcoes.destino || ''
  const nomeCli = opcoes.nomeCliente || branding.marca

  const camposExtras = (branding.camposExtras || [])
    .map(
      (c) => `
      <label class="campo">
        <span>${escapar(c.rotulo)}${c.obrigatorio ? ' *' : ''}</span>
        <input type="${c.tipo === 'senha' ? 'password' : 'text'}" name="${escapar(c.id)}" placeholder="${escapar(
          c.placeholder,
        )}" autocomplete="off" />
      </label>`,
    )
    .join('')

  const blocoRede = branding.mostrarWifi
    ? `
      <div class="rede">
        <div><span>Rede</span><strong>${escapar(perfil?.wifi?.ssid || branding.marca)}</strong></div>
        ${
          branding.mostrarVelocidade
            ? `<div><span>Plano</span><strong>${escapar(opcoes.plano || 'Fibra')}</strong></div>`
            : ''
        }
      </div>`
    : ''

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapar(branding.titulo)}</title>
<style>
  :root { --primaria:${escapar(branding.corPrimaria)}; --primaria-texto:${escapar(
    branding.corPrimariaTexto,
  )}; --fundo:${escapar(fundo)}; --painel:${escapar(painel)}; --texto:${escapar(
    texto,
  )}; --borda:${escapar(borda)}; --campo:${escapar(campo)}; --raio:${Number(branding.raio) || 0}px; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:${escapar(fundo)}; color:${escapar(texto)}; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .painel { width:100%; max-width:380px; background:${escapar(painel)}; border:1px solid ${escapar(
    borda,
  )}; border-radius:var(--raio); padding:28px; box-shadow:0 10px 30px rgba(0,0,0,.08); }
  .marca { display:flex; align-items:center; justify-content:center; gap:12px; margin-bottom:18px; }
  .marca img { height:40px; }
  .marca .sigla { width:44px; height:44px; border-radius:8px; background:var(--primaria); color:var(--primaria-texto);
    display:grid; place-items:center; font-weight:700; }
  h1 { font-size:18px; margin:0 0 4px; text-align:center; }
  p.sub { font-size:13px; opacity:.75; margin:0 0 20px; text-align:center; }
  label.campo { display:block; margin-bottom:12px; }
  label.campo span { display:block; font-size:12px; margin-bottom:6px; opacity:.85; }
  input { width:100%; height:38px; padding:0 12px; border-radius:8px; border:1px solid ${escapar(
    borda,
  )}; background:var(--campo); color:inherit; font-size:14px; }
  button { width:100%; height:38px; border:0; border-radius:8px; background:var(--primaria); color:var(--primaria-texto);
    font-weight:600; font-size:14px; cursor:pointer; }
  .erro { display:none; background:rgba(220,38,38,.1); color:#b91c1c; font-size:12px; padding:10px 12px;
    border-radius:8px; margin-bottom:12px; }
  .erro.visivel { display:block; }
  .rede { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:16px; }
  .rede div { border:1px solid ${escapar(borda)}; border-radius:8px; padding:10px; font-size:12px; }
  .rede span { display:block; opacity:.6; }
  .termos { display:flex; gap:8px; align-items:flex-start; font-size:12px; opacity:.8; margin:16px 0 0; }
  footer { text-align:center; font-size:11px; opacity:.6; margin-top:18px; }
</style>
</head>
<body>
  <main class="painel">
    <div class="marca">
      ${
        branding.logoUrl
          ? `<img src="${escapar(branding.logoUrl)}" alt="${escapar(branding.marca)}" />`
          : `<span class="sigla">${escapar(branding.marca.slice(0, 2).toUpperCase())}</span>`
      }
    </div>
    <h1>${escapar(branding.titulo)}</h1>
    <p class="sub">${escapar(branding.subtitulo)}</p>
    <div class="erro" id="erro">Credenciais inválidas. Se o problema persistir, contate o suporte do provedor.</div>
    <form method="post" action="${escapar(destino)}" onsubmit="return validar(this)">
      <label class="campo"><span>Usuário</span><input name="username" value="admin" autocomplete="username" /></label>
      <label class="campo"><span>Senha</span><input type="password" name="password" autocomplete="current-password" /></label>
      ${camposExtras}
      <button type="submit">${escapar(branding.rotuloBotao)}</button>
    </form>
    ${blocoRede}
    ${
      branding.mostrarTermos
        ? `<p class="termos"><input type="checkbox" name="termos" /> <span>${escapar(branding.textoTermos)}</span></p>`
        : ''
    }
    <footer>${escapar(branding.rodape)}</footer>
  </main>
<script>
  function validar(form) {
    var erro = document.getElementById('erro');
    if (!form.password.value) { erro.classList.add('visivel'); return false; }
    erro.classList.remove('visivel');
    return true;
  }
</script>
</body>
</html>`
}

/** Pacote com a pagina + metadados, pronto para publicacao no CPE. */
export function gerarPacoteLogin(contexto) {
  return {
    geradoEm: new Date().toISOString(),
    arquivos: [
      {
        nome: 'login.html',
        tipo: 'text/html; charset=utf-8',
        conteudo: gerarPaginaLogin(contexto),
      },
    ],
  }
}
