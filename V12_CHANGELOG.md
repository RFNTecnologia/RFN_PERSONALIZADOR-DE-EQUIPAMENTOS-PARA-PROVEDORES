# V12.3 — atualização

Veja `V12.3_CHANGELOG.md` para o fluxo de provisionamento RESIDENCIAL.

---

# V12 — Laboratório MR60X / Reset Recovery

- Removida a lógica de recuperação baseada em `Device.User.1/2`.
- `flattenDevice()` agora preserva `writable` como metadado do parâmetro, sem transformar `_writable` em caminho.
- Catálogo determinístico do MERCUSYS MR60X.
- Novo laboratório com RefreshObject, leitura e write-probe seguro.
- Histórico persistente em `lab_runs`.
- Provisionamento genérico passa a preferir caminhos exatos conhecidos no MR60X.
- Endpoint legado de recuperação retorna HTTP 410.

- V12.1: laboratório passou a usar timeout+connection_request do NBI e distinguir 200=executado de 202=enfileirado.
- V12.1: leituras executadas registram valor observado imediatamente após a tarefa.
- V12.1: write-probe envia também o tipo XSD quando conhecido.


## V12.2 — fechamento do ciclo do laboratório
- Corrigida a interpretação do histórico: tarefa `queued` não é tratada como resultado de leitura em cache.
- O laboratório reconcilia automaticamente leituras, refresh e write-probe após um novo Inform do CPE.
- Leituras e write-probes duplicados enquanto uma tarefa equivalente estiver enfileirada não criam novos registros.
- Novos testes de leitura/write-probe exigem Inform recente do CPE.
- O painel exibe o estado de conectividade do CPE a partir do último Inform.
