# Prompt para a nova conversa Cursor

Cria um **novo Cloud Agent / conversa**, separado da Mesa de Operação (trading).

Opção A (ficheiros já estão aqui): repo **`rpcarvalho8/App_trade`**, branch **`cursor/plano-negocio-condominios-95f1`**, pasta `docs-condominio/`. Só documentação — não mexer em `trading-os/`.

Opção B (casa certa do código): copia `docs-condominio/` para `rpcarvalho8/condominio` em `docs/negocio/` e abre o agente nesse repo.

Não continues a conversa da Mesa de Operação (XAUUSD/SOLUSD) para este trabalho.

---

Copia a partir daqui (Opção A):

```
Lê docs-condominio/README.md, docs-condominio/dossie-produto-e-negocio.md e docs-condominio/NOTAS.md.

O dossiê descreve o estado real do código (piloto Urb. da Fonte / Condomínio 7663) e um plano para transformar isto num produto de mercado.

Objectivo de produto (inegociável até eu alterar NOTAS.md):
- servir TODOS os tipos de condomínio em Portugal (habitação, misto, lojas, garagens, urbanizações, prédios pequenos e grandes);
- ser simples e eficaz para um administrador-condómino sem formação de contabilista;
- reduzir ao máximo a dependência de terceiros (administradora, Excel, reconciliação manual, lock-in de vendors).

Regras:
1. NOTAS.md tem prioridade sobre o dossiê.
2. Não misturar com trading-os / Mesa / XAUUSD. Esta conversa é só condomínios.
3. Não commitar segredos nem dados pessoais de condóminos (nomes, NIF, IBAN).
4. Não implementar a app de condomínios dentro de App_trade. Código novo pertence a rpcarvalho8/condominio.
5. Qualquer plano de código deve aproximar o piloto de um produto configurável — não aprofundar hardcodes da Urb. da Fonte.
6. Quando eu colar notas, actualiza docs-condominio/NOTAS.md e só depois o dossiê.

Começa por confirmar que leste os três ficheiros e espera pelas minhas notas, a menos que eu peça já um ajuste concreto.
```
