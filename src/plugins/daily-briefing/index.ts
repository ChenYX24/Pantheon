/**
 * Daily Briefing Plugin
 *
 * AI-driven personalized information radar.
 * User defines interests -> AI generates search strategies -> daily aggregation.
 */

import type { PluginModule } from "@/plugins/_system/plugin-types";
import { DailyBriefingPage } from "./pages";
import { Newspaper } from "lucide-react";

export const plugin: PluginModule = {
  manifest: {
    id: "daily-briefing",
    name: "Daily Briefing",
    version: "2.0.0",
    description: "AI-driven personalized information radar — track what matters to you",
    author: "SCC",
    icon: Newspaper,
    routes: [
      { path: "", title: "Daily Briefing" },
    ],
    sidebarItems: [
      {
        path: "",
        label: "Daily Briefing",
        icon: Newspaper,
        order: 5,
      },
    ],
  },

  pages: {
    "": DailyBriefingPage,
  },

  onLoad: async () => {
    if (process.env.NODE_ENV === "development") {
      console.log("[Plugin] Daily Briefing v2 loaded");
    }
  },

  onUnload: async () => {
    if (process.env.NODE_ENV === "development") {
      console.log("[Plugin] Daily Briefing v2 unloaded");
    }
  },
};
