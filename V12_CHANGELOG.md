# V12 — Laboratório MR60X / Reset Recovery

- Removida a lógica de recuperação baseada em `Device.User.1/2`.
- `flattenDevice()` agora preserva `writable` como metadado do parâmetro, sem transformar `_writable` em caminho.
- Catálogo determinístico do MERCUSYS MR60X.
- Novo laboratório com RefreshObject, leitura e write-probe seguro.
- Histórico persistente em `lab_runs`.
- Provisionamento genérico passa a preferir caminhos exatos conhecidos no MR60X.
- Endpoint legado de recuperação retorna HTTP 410.
