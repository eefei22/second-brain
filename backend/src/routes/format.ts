import { Router } from "express";
import { formatText } from "../services/formatting.js";

export const formatRouter = Router();

// POST /format — inline AI reformatter for the capture canvas: instructions
// + raw draft text in, reformatted markdown out. Doesn't touch the DB.
formatRouter.post("/", async (req, res) => {
  const { text, instructions } = req.body as { text: string; instructions?: string };
  if (!text?.trim()) return res.status(400).json({ error: "text required" });

  const formatted = await formatText(text, instructions);
  res.json({ formatted });
});
