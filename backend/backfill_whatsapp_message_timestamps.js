require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase environment variables.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const HISTORY_MESSAGES_FILE = "hist_messages.json";
const DEFAULT_AUTH_ROOT = path.join(__dirname, "baileys_auth");
const CHUNK_SIZE = 250;

function extractMessageTimestampSeconds(timestampValue) {
  if (typeof timestampValue === "number" && Number.isFinite(timestampValue)) {
    return timestampValue;
  }

  if (typeof timestampValue === "bigint") {
    return Number(timestampValue);
  }

  if (timestampValue && typeof timestampValue === "object") {
    if (typeof timestampValue.low === "number") {
      return timestampValue.low;
    }

    if (typeof timestampValue.toNumber === "function") {
      const numericValue = timestampValue.toNumber();
      if (Number.isFinite(numericValue)) {
        return numericValue;
      }
    }
  }

  const parsedValue = Number(timestampValue);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

function normalizeStoredAuthDir(configuredDir, accountId) {
  const rawValue = String(configuredDir || "").trim();

  const pathTokens = rawValue.split(/[\\/]+/).filter(Boolean);
  const accountDirToken =
    [...pathTokens]
      .reverse()
      .find((token) => /^account-[0-9a-f-]{36}$/i.test(token) || /^[0-9a-f-]{36}$/i.test(token)) ||
    "";

  if (!rawValue) {
    return path.join(DEFAULT_AUTH_ROOT, `account-${accountId}`);
  }

  if (accountDirToken) {
    return path.join(DEFAULT_AUTH_ROOT, accountDirToken);
  }

  if (path.isAbsolute(rawValue) || /^[a-z]:[\\/]/i.test(rawValue) || rawValue.startsWith("\\\\")) {
    return rawValue;
  }

  return path.join(DEFAULT_AUTH_ROOT, rawValue);
}

async function readHistoryMessages(authDir) {
  const filePath = path.join(authDir, HISTORY_MESSAGES_FILE);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      console.warn(`Failed to read ${filePath}:`, error.message || error);
    }

    return [];
  }
}

function buildTimestampMap(messages) {
  const map = new Map();

  for (const message of messages) {
    const messageId = String(message?.key?.id || "").trim();
    const timestampSeconds = extractMessageTimestampSeconds(message?.messageTimestamp);

    if (!messageId || timestampSeconds <= 0) {
      continue;
    }

    map.set(messageId, {
      createdAt: new Date(timestampSeconds * 1000).toISOString(),
      remoteJid: String(message?.key?.remoteJid || "").trim() || null
    });
  }

  return map;
}

async function getWhatsAppAccounts() {
  const { data, error } = await supabase
    .from("whatsapp_accounts")
    .select("id, owner_user_id, auth_dir")
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

async function getMessagesForChunk(ownerUserId, messageIds) {
  const { data, error } = await supabase
    .from("messages")
    .select("id, owner_user_id, whatsapp_account_id, chat_jid, wa_message_id, created_at")
    .eq("owner_user_id", ownerUserId)
    .in("wa_message_id", messageIds);

  if (error) {
    throw error;
  }

  return data || [];
}

async function updateMessageTimestamp(messageId, createdAt) {
  const { error } = await supabase
    .from("messages")
    .update({ created_at: createdAt })
    .eq("id", messageId);

  if (error) {
    throw error;
  }
}

async function backfillAccount(account) {
  const authDir = normalizeStoredAuthDir(account.auth_dir, account.id);
  const historyMessages = await readHistoryMessages(authDir);
  const timestampMap = buildTimestampMap(historyMessages);
  const messageIds = Array.from(timestampMap.keys());

  const stats = {
    accountId: account.id,
    ownerUserId: account.owner_user_id,
    authDir,
    cachedMessages: historyMessages.length,
    matchedMessages: 0,
    updatedMessages: 0,
    unchangedMessages: 0,
    skippedWrongAccount: 0,
    skippedChatMismatch: 0
  };

  if (!messageIds.length) {
    return stats;
  }

  for (let index = 0; index < messageIds.length; index += CHUNK_SIZE) {
    const chunk = messageIds.slice(index, index + CHUNK_SIZE);
    const dbRows = await getMessagesForChunk(account.owner_user_id, chunk);

    for (const row of dbRows) {
      const matched = timestampMap.get(String(row.wa_message_id || "").trim());

      if (!matched) {
        continue;
      }

      const rowAccountId = row.whatsapp_account_id || null;
      if (rowAccountId && rowAccountId !== account.id) {
        stats.skippedWrongAccount += 1;
        continue;
      }

      const rowChatJid = String(row.chat_jid || "").trim() || null;
      if (rowChatJid && matched.remoteJid && rowChatJid !== matched.remoteJid) {
        stats.skippedChatMismatch += 1;
        continue;
      }

      stats.matchedMessages += 1;

      if (String(row.created_at || "") === matched.createdAt) {
        stats.unchangedMessages += 1;
        continue;
      }

      await updateMessageTimestamp(row.id, matched.createdAt);
      stats.updatedMessages += 1;
    }
  }

  return stats;
}

async function main() {
  const accounts = await getWhatsAppAccounts();
  const results = [];

  for (const account of accounts) {
    const result = await backfillAccount(account);
    results.push(result);
    console.log(
      [
        `account=${result.accountId}`,
        `cached=${result.cachedMessages}`,
        `matched=${result.matchedMessages}`,
        `updated=${result.updatedMessages}`,
        `unchanged=${result.unchangedMessages}`,
        `skip_account=${result.skippedWrongAccount}`,
        `skip_chat=${result.skippedChatMismatch}`
      ].join(" ")
    );
  }

  const totals = results.reduce(
    (summary, result) => {
      summary.cachedMessages += result.cachedMessages;
      summary.matchedMessages += result.matchedMessages;
      summary.updatedMessages += result.updatedMessages;
      summary.unchangedMessages += result.unchangedMessages;
      summary.skippedWrongAccount += result.skippedWrongAccount;
      summary.skippedChatMismatch += result.skippedChatMismatch;
      return summary;
    },
    {
      cachedMessages: 0,
      matchedMessages: 0,
      updatedMessages: 0,
      unchangedMessages: 0,
      skippedWrongAccount: 0,
      skippedChatMismatch: 0
    }
  );

  console.log("----");
  console.log(
    [
      `accounts=${results.length}`,
      `cached=${totals.cachedMessages}`,
      `matched=${totals.matchedMessages}`,
      `updated=${totals.updatedMessages}`,
      `unchanged=${totals.unchangedMessages}`,
      `skip_account=${totals.skippedWrongAccount}`,
      `skip_chat=${totals.skippedChatMismatch}`
    ].join(" ")
  );
}

main().catch((error) => {
  console.error("Failed to backfill WhatsApp message timestamps:", error);
  process.exitCode = 1;
});
