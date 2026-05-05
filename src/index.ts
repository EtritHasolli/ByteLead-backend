import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { authRouter } from "./routes/auth.js";
import { scrapeRouter } from "./routes/scrape.js";
import { leadsRouter } from "./routes/leads.js";
import { aiChatRouter } from "./routes/ai-chat.js";
import { friendsRouter } from "./routes/friends.js";
import { profileRouter } from "./routes/profile.js";
import { settingsRouter } from "./routes/settings.js";
import { adminRouter } from "./routes/admin.js";

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Routes
app.use("/api/auth", authRouter);
app.use("/api/scrape", scrapeRouter);
app.use("/api/leads", leadsRouter);
app.use("/api/ai-chat", aiChatRouter);
app.use("/api/friends", friendsRouter);
app.use("/api/profile", profileRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/admin", adminRouter);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`✅ ByteLead Backend running on http://localhost:${PORT}`);
});
