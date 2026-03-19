/**
 * Daily Briefing — Push Notifications Route
 *
 * GET  /api/plugins/daily-briefing/push — Return current push config
 * POST /api/plugins/daily-briefing/push — Push briefing to configured channels
 * PUT  /api/plugins/daily-briefing/push — Save push config
 */

import { NextRequest, NextResponse } from "next/server";
import { getBriefing, getPushConfig, savePushConfig } from "@/plugins/daily-briefing/lib/briefing-store";
import { formatForTelegram, formatForFeishu } from "@/plugins/daily-briefing/lib/briefing-formatter";
import { getTelegramBot } from "@/lib/bot/telegram-bot";
import { getFeishuBot } from "@/lib/bot/feishu-bot";
import type { PushConfig, PushResult } from "@/plugins/daily-briefing/types";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET() {
  try {
    const config = getPushConfig();
    return NextResponse.json({ config });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const config = getPushConfig();
    const briefing = getBriefing(todayStr());

    if (!briefing || briefing.items.length === 0) {
      return NextResponse.json(
        { error: "No briefing data for today. Fetch content first." },
        { status: 404 },
      );
    }

    const enabledChannels = config.channels.filter((ch) => ch.enabled);
    if (enabledChannels.length === 0) {
      return NextResponse.json(
        { error: "No enabled push channels configured." },
        { status: 400 },
      );
    }

    const results: PushResult[] = [];

    for (const channel of enabledChannels) {
      try {
        if (channel.platform === "telegram") {
          const bot = getTelegramBot();
          if (!bot) {
            results.push({
              platform: "telegram",
              chatId: channel.chatId,
              success: false,
              error: "Telegram bot not configured",
            });
            continue;
          }
          const text = formatForTelegram(briefing, config);
          await bot.sendMessage(channel.chatId, {
            text,
            parseMode: "markdown",
          });
          results.push({
            platform: "telegram",
            chatId: channel.chatId,
            success: true,
          });
        } else if (channel.platform === "feishu") {
          const bot = getFeishuBot();
          if (!bot) {
            results.push({
              platform: "feishu",
              chatId: channel.chatId,
              success: false,
              error: "Feishu bot not configured",
            });
            continue;
          }
          const card = formatForFeishu(briefing, config);
          await bot.sendMessage(channel.chatId, {
            text: JSON.stringify(card),
            parseMode: "plain",
          });
          results.push({
            platform: "feishu",
            chatId: channel.chatId,
            success: true,
          });
        }
      } catch (err) {
        results.push({
          platform: channel.platform,
          chatId: channel.chatId,
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return NextResponse.json({ results, successCount, failCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as PushConfig;
    savePushConfig(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
