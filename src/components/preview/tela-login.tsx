import type { Branding } from '@/lib/types'

export function TelaLogin({
  branding,
  modo = 'idle',
}: {
  branding: Branding
  modo?: 'idle' | 'erro'
}) {
  const escuro = branding.tema === 'escuro'
  const texto = escuro ? '#f8fafc' : branding.corTexto
  const painel = escuro ? '#111827' : branding.corPainel
  const borda = escuro ? '#1f2937' : branding.corBorda
  const campoFundo = escuro ? '#0b1220' : '#ffffff'

  return (
    <div
      className="w-full overflow-hidden rounded-xl border shadow-sm"
      style={{ background: branding.corFundo, borderColor: borda }}
    >
      <div
        className="flex items-center gap-1.5 border-b px-3 py-2"
        style={{ background: painel, borderColor: borda }}
      >
        <span className="size-2.5 rounded-full bg-red-400" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-amber-400" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-emerald-400" aria-hidden="true" />
        <span className="ml-3 truncate text-xs opacity-60">192.168.15.1 — login</span>
      </div>

      <div className="flex justify-center px-4 py-8">
        <div
          className="w-full max-w-sm space-y-4 border p-6 text-center"
          style={{ background: painel, borderColor: borda, borderRadius: branding.raio, color: texto }}
        >
          {branding.logoUrl ? (
            <img
              src={branding.logoUrl}
              alt={`Logo ${branding.marca}`}
              className="mx-auto h-10 w-auto object-contain"
            />
          ) : (
            <div
              className="mx-auto grid size-11 place-items-center text-sm font-bold"
              style={{
                background: branding.corPrimaria,
                color: branding.corPrimariaTexto,
                borderRadius: Math.max(6, branding.raio - 4),
              }}
            >
              {branding.marca.slice(0, 2).toUpperCase()}
            </div>
          )}

          <div>
            <p className="text-lg font-semibold">{branding.titulo}</p>
            <p className="mt-1 text-sm opacity-70">{branding.subtitulo}</p>
          </div>

          <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
            <div className="space-y-1.5 text-left">
              <label className="text-xs font-medium opacity-80">Usuário</label>
              <input
                readOnly
                placeholder="admin"
                className="h-9 w-full rounded-md border px-3 text-sm outline-none"
                style={{ background: campoFundo, borderColor: borda, color: texto }}
              />
            </div>

            <div className="space-y-1.5 text-left">
              <label className="text-xs font-medium opacity-80">Senha</label>
              <input
                readOnly
                type="password"
                placeholder="••••••••"
                className="h-9 w-full rounded-md border px-3 text-sm outline-none"
                style={{ background: campoFundo, borderColor: borda, color: texto }}
              />
            </div>

            {branding.camposExtras.map((campo) => (
              <div key={campo.id} className="space-y-1.5 text-left">
                <label className="text-xs font-medium opacity-80">
                  {campo.rotulo}
                  {campo.obrigatorio && <span aria-hidden="true"> *</span>}
                </label>
                <input
                  readOnly
                  placeholder={campo.placeholder}
                  className="h-9 w-full rounded-md border px-3 text-sm outline-none"
                  style={{ background: campoFundo, borderColor: borda, color: texto }}
                />
              </div>
            ))}

            {modo === 'erro' && (
              <p
                className="rounded-md px-3 py-2 text-left text-xs"
                style={{ background: 'rgba(220,38,38,0.1)', color: '#b91c1c' }}
              >
                Credenciais inválidas. Em caso de dúvida, contate o suporte do provedor.
              </p>
            )}

            <button
              type="submit"
              className="h-9 w-full rounded-md text-sm font-medium transition-opacity hover:opacity-90"
              style={{ background: branding.corPrimaria, color: branding.corPrimariaTexto }}
            >
              {branding.rotuloBotao}
            </button>
          </form>

          {branding.mostrarTermos && (
            <p className="text-left text-xs opacity-70">
              <span className="mr-1 inline-block size-3 rounded-sm border align-middle" aria-hidden="true" />
              {branding.textoTermos}
            </p>
          )}

          {branding.mostrarWifi && (
            <div
              className="grid grid-cols-2 gap-2 text-left text-xs"
              style={{ borderColor: borda }}
            >
              <div className="rounded-md border p-2" style={{ borderColor: borda }}>
                <p className="opacity-60">Rede</p>
                <p className="font-medium">FibraSul</p>
              </div>
              {branding.mostrarVelocidade && (
                <div className="rounded-md border p-2" style={{ borderColor: borda }}>
                  <p className="opacity-60">Plano</p>
                  <p className="font-medium">600 Mbps</p>
                </div>
              )}
            </div>
          )}

          <p className="text-xs opacity-60">{branding.rodape}</p>
        </div>
      </div>
    </div>
  )
}
