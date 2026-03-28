import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("."));

const PORT = process.env.PORT ?? 8080;

const VIDEOS_URL =
  process.env.VIDEOS_URL ||
  "https://raw.githubusercontent.com/myvfc/video-db/main/videos.json";

const VIDEOS_OSU_URL =
  process.env.VIDEOS_OSU_URL ||
  "https://raw.githubusercontent.com/Peak-Platforms/video-db/refs/heads/main/videos-okstate.json";

const PLAYER_BASE = process.env.XSEN_PLAYER_URL || "https://player.xsen.fun";

let videoDBOU = [];
let videoDBOSU = [];

async function loadVideos() {
  console.log("📡 Fetching OU videos.json…");
  try {
    const res = await fetch(VIDEOS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    videoDBOU = await res.json();
    console.log(`✅ Loaded ${videoDBOU.length} OU videos`);
  } catch (err) {
    console.error("❌ Failed to load OU videos:", err.message);
  }

  console.log("📡 Fetching OSU videos.json…");
  try {
    const res = await fetch(VIDEOS_OSU_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    videoDBOSU = await res.json();
    console.log(`✅ Loaded ${videoDBOSU.length} OSU videos`);
  } catch (err) {
    console.error("❌ Failed to load OSU videos:", err.message);
  }
}

function getDB(school) {
  if (!school) return videoDBOU;
  const s = school.toLowerCase();
  if (s === 'okstate' || s === 'osu' || s === 'cowboys') return videoDBOSU;
  return videoDBOU;
}

function getTitleField(school) {
  const s = (school || '').toLowerCase();
  if (s === 'okstate' || s === 'osu' || s === 'cowboys') return 'Title';
  return 'OU Sooners videos';
}

function searchVideos(query, school, limit) {
  const db = getDB(school);
  const titleField = getTitleField(school);

  if (!Array.isArray(db) || db.length === 0) return null;

  const q = query.toLowerCase();
  const qWords = q.split(" ").filter(Boolean);

  return db
    .map((v) => {
      const title = (v[titleField] || v["Title"] || "").toLowerCase();
      const desc = (v["Description"] || "").toLowerCase();
      let score = 0;
      for (const word of qWords) {
        if (title.includes(word)) score += 2;
        if (desc.includes(word)) score += 1;
      }
      return { ...v, _score: score };
    })
    .filter((v) => v._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map((v) => {
      const url = v["URL"] || "";
      const title = v[titleField] || v["Title"] || "Video";
      const desc = v["Description"] || "";
      let videoId = "";
      if (url.includes("v=")) videoId = url.split("v=")[1].split("&")[0];
      else if (url.includes("youtu.be/")) videoId = url.split("youtu.be/")[1];
      return {
        title,
        thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        duration: "—",
        url: `${PLAYER_BASE}?v=${videoId}`,
        description: desc
      };
    });
}

async function handleXsenSearch(args) {
  const query = args.query || "";
  const school = args.school || "sooners";
  const limit = args.limit || 3;

  if (!query) return "No query provided.";

  const results = searchVideos(query, school, limit);

  if (!results) return "Video library is still loading. Please try again in a moment.";
  if (results.length === 0) return `No videos found for "${query}".`;

  return results
    .map((v) => `${v.title}\n${v.url}`)
    .join("\n\n");
}

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "XSEN Video MCP",
    videos_ou: videoDBOU.length,
    videos_osu: videoDBOSU.length,
    uptime: process.uptime(),
  });
});

app.get("/health", (req, res) => res.status(200).send("OK"));

app.get("/videos", (req, res) => {
  const query = (req.query.query || "").toLowerCase();
  const school = req.query.school || "sooners";
  const limit = Number(req.query.limit) || 3;

  if (!query) return res.json({ results: [] });

  const results = searchVideos(query, school, limit);

  if (!results) {
    return res.status(503).json({ error: "Video library still loading" });
  }

  res.json({ results });
});

setInterval(async () => {
  try {
    const response = await fetch(`http://localhost:${PORT}/health`);
    console.log("💓 Keep-alive ping:", response.ok ? "OK" : "FAILED");
  } catch (err) {
    console.log("💓 Keep-alive ping failed (server might be starting)");
  }
}, 5 * 60 * 1000);

app.post("/mcp", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const expectedAuth = `Bearer ${process.env.MCP_AUTH_KEY}`;

    if (!authHeader || authHeader !== expectedAuth) {
      return res.status(401).json({
        jsonrpc: "2.0",
        id: req.body?.id || null,
        error: { code: -32600, message: "Unauthorized" }
      });
    }

    const { jsonrpc, method, id, params } = req.body || {};
    console.log(`🔧 MCP: ${method}`);

    if (jsonrpc !== "2.0") {
      return res.json({ jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid JSON-RPC version" } });
    }

    if (method === "initialize") {
      return res.json({
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "XSEN Video MCP", version: "2.0.0" },
          capabilities: { tools: {} },
        },
      });
    }

    if (method === "notifications/initialized") return res.status(200).end();

    if (method === "tools/list") {
      return res.json({
        jsonrpc: "2.0", id,
        result: {
          tools: [
            {
              name: "xsen_search",
              description: "Search XSEN video highlights for OU Sooners or OSU Cowboys and return embedded players.",
              inputSchema: {
                type: "object",
                properties: {
                  query: { type: "string", description: "Search query for videos" },
                  school: { type: "string", description: "School slug: 'sooners' for OU, 'okstate' for OSU", enum: ["sooners", "okstate"] }
                },
                required: ["query"]
              }
            }
          ]
        }
      });
    }

    if (method === "tools/call") {
      const args = params?.arguments || {};
      const text = await handleXsenSearch(args);
      return res.json({
        jsonrpc: "2.0", id,
        result: { content: [{ type: "text", text }] },
      });
    }

    return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } });

  } catch (err) {
    console.error("❌ MCP Error:", err.message);
    return res.json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 XSEN Video MCP running on port ${PORT}`);
  setTimeout(() => {
    loadVideos().then(() => {
      console.log("📊 Video DB ready");
      setInterval(loadVideos, 15 * 60 * 1000);
    });
  }, 2500);
});
