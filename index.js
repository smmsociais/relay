import express from "express";
import cors from "cors";
import bodyParser from "body-parser";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Rota de health check
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    message: "Relay ativo",
    timestamp: new Date().toISOString(),
    outboundIp: req.headers['x-forwarded-for'] || req.socket.remoteAddress
  });
});

// Rota de saque
app.post("/relay/withdraw", async (req, res) => {
  try {
    const payload = req.body;
    
    // Aqui você integraria com Asaas
    // Exemplo simulado:
    console.log("[RELAY] Recebido saque:", payload);

    // Simula retorno de sucesso
    res.json({
      message: "Saque recebido no relay (simulado)",
      data: {
        ...payload,
        id: `asaas_${Date.now()}`
      }
    });
  } catch (err) {
    console.error("[RELAY] Erro ao processar saque:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Inicializa servidor
app.listen(PORT, () => {
  console.log(`[RELAY] Servidor rodando na porta ${PORT}`);
});
