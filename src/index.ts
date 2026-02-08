import "dotenv/config";
import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { controlRouter } from "./routes/control.js";
import { buildingsRouter } from "./routes/buildings.js";
import { unitsRouter } from "./routes/units.js";
import { invitesRouter } from "./routes/invites.js";
import { announcementsRouter } from "./routes/announcements.js";
import { ticketsRouter } from "./routes/tickets.js";
import { documentsRouter } from "./routes/documents.js";
import { dashboardRouter } from "./routes/dashboard.js";

const app = express();
const port = process.env.PORT ?? 4000;

app.use(cors({ origin: process.env.CORS_ORIGIN ?? "*", credentials: true }));
app.use(express.json());

app.use("/auth", authRouter);
app.use("/control", controlRouter);
app.use("/invites", invitesRouter);
app.use("/buildings", buildingsRouter);
app.use("/units", unitsRouter);
app.use("/announcements", announcementsRouter);
app.use("/tickets", ticketsRouter);
app.use("/documents", documentsRouter);
app.use("/dashboard", dashboardRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(port, () => {
  console.log(`komun-api listening on http://localhost:${port}`);
});
