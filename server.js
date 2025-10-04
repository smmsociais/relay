// relay.js
import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ⚠️ coloque sua API Key do Asaas aqui (use variável de ambiente em produção)
const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_URL = "https://www.asaas.com/api/v3/transfers";

// Rota de saúde (para o Vercel checar se o relay está ativo)
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    outboundIp: req.ip, // mostra o IP que vai sair para o Asaas
    message: "Relay ativo"
  });
});

// Rota que recebe requisição de saque do backend (Vercel)
app.post("/transfer", async (req, res) => {
  try {
    const {
      value,
      pixAddressKey,
      pixAddressKeyType,
      externalReference
    } = req.body;

    if (!value || !pixAddressKey || !pixAddressKeyType) {
      return res.status(400).json({ error: "Dados obrigatórios ausentes" });
    }

    // Monta payload para o Asaas
    const payload = {
      value,
      operationType: "PIX",
      pixAddressKey,
      pixAddressKeyType,
      externalReference
    };

    console.log("[Relay] Enviando payload para Asaas:", payload);

    // Faz chamada real ao Asaas
    const response = await fetch(ASAAS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "access_token": ASAAS_API_KEY
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("[Relay] Erro Asaas:", data);
      return res.status(response.status).json({ error: data });
    }

    console.log("[Relay] Transferência criada:", data);

    // Retorna o resultado para o backend (Vercel)
    return res.json({
      success: true,
      asaasId: data.id,
      status: data.status,
      value: data.value,
      externalReference: data.externalReference
    });
  } catch (err) {
    console.error("[Relay] Erro inesperado:", err);
    return res.status(500).json({ error: "Erro no relay" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Relay rodando na porta ${PORT}`);
});
