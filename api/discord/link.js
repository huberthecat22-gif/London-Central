const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://lcfms.vercel.app",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin"
};

function send(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json");
  return res.json(body);
}

function getBearer(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function signState(userId) {
  const issued = Date.now().toString();
  const nonce = crypto.randomBytes(24).toString("hex");
  const payload = Buffer.from(userId + ":" + issued + ":" + nonce).toString("base64url");
  const signature = crypto.createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY).update(payload).digest("base64url");
  return payload + "." + signature;
}

function verifyState(state, userId) {
  if (typeof state !== "string" || !state.includes(".")) return false;
  const [payload, supplied] = state.split(".");
  if (!payload || !supplied) return false;
  const expected = crypto.createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY).update(payload).digest();
  let actual;
  try { actual = Buffer.from(supplied, "base64url"); } catch { return false; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
  let decoded;
  try { decoded = Buffer.from(payload, "base64url").toString("utf8").split(":"); } catch { return false; }
  if (decoded.length !== 3 || decoded[0] !== userId) return false;
  const issued = Number(decoded[1]);
  return Number.isFinite(issued) && Date.now() - issued >= 0 && Date.now() - issued <= 10 * 60 * 1000;
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && origin !== "https://lcfms.vercel.app") return send(res, 403, { error: "Origin not allowed." });
  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed." });

  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_GUILD_ID", "DISCORD_REDIRECT_URI"];
  for (const key of required) if (!process.env[key]) return send(res, 500, { error: "Server setup is incomplete: " + key + " is missing." });

  try {
    const jwt = getBearer(req);
    if (!jwt) return send(res, 401, { error: "Please sign in to LCFMS first." });

    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: authData, error: authError } = await admin.auth.getUser(jwt);
    if (authError || !authData.user) return send(res, 401, { error: "Your LCFMS session has expired. Please sign in again." });
    const userId = authData.user.id;

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (body.action === "state") {
      return send(res, 200, { state: signState(userId), client_id: process.env.DISCORD_CLIENT_ID, redirect_uri: process.env.DISCORD_REDIRECT_URI });
    }
    if (body.action !== "link" || !body.code || !verifyState(body.state, userId)) {
      return send(res, 400, { error: "Discord connection could not be verified. Please try again." });
    }

    const redirectUri = process.env.DISCORD_REDIRECT_URI;
    const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: body.code,
        redirect_uri: redirectUri
      })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) return send(res, 400, { error: "Discord could not verify the authorisation. Please try again." });

    const discordHeaders = { Authorization: "Bearer " + tokenData.access_token };
    const [discordUserResponse, guildMemberResponse] = await Promise.all([
      fetch("https://discord.com/api/v10/users/@me", { headers: discordHeaders }),
      fetch("https://discord.com/api/v10/users/@me/guilds/" + encodeURIComponent(process.env.DISCORD_GUILD_ID) + "/member", { headers: discordHeaders })
    ]);
    const discordUser = await discordUserResponse.json();
    const guildMember = await guildMemberResponse.json();
    if (!discordUserResponse.ok || !discordUser.id) return send(res, 400, { error: "Discord did not return your account details." });
    if (!guildMemberResponse.ok || !Array.isArray(guildMember.roles)) return send(res, 403, { error: "Join the LCFMS Discord server before connecting your account." });
    // Link identity once; the bot's live role roster controls review permission.
    // This lets the Owner add or remove the reviewer role at any time in Discord.
    const { error: updateError } = await admin.from("profiles").update({ discord_user_id: discordUser.id }).eq("id", userId);
    if (updateError) {
      if (updateError.code === "23505") return send(res, 409, { error: "This Discord account is already connected to another LCFMS account. Contact the Owner." });
      throw updateError;
    }
    return send(res, 200, { success: true, discord_user_id: discordUser.id });
  } catch (error) {
    console.error("Discord reviewer linking failed:", error);
    return send(res, 500, { error: "Discord connection failed. Please try again or contact the LCFMS Owner." });
  }
};
