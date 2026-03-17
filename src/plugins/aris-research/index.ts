/**
 * ARIS Research Plugin
 *
 * Autonomous ML Research Pipeline (Auto-claude-code-research-in-sleep).
 * Provides 27 Claude Code skills for end-to-end research workflows:
 * idea discovery, experiments, review loops, and paper writing.
 */

import type { PluginModule } from "@/plugins/_system/plugin-types";
import { ArisResearchPage } from "./pages";
import { FlaskConical } from "lucide-react";

export const plugin: PluginModule = {
  manifest: {
    id: "aris-research",
    name: "ARIS Research",
    version: "1.0.0",
    description: "Autonomous ML Research Pipeline (Auto-claude-code-research-in-sleep)",
    author: "ARIS / SCC",
    icon: FlaskConical,
    routes: [
      { path: "", title: "ARIS Research" },
    ],
    sidebarItems: [
      {
        path: "",
        label: "ARIS Research",
        icon: FlaskConical,
        order: 3,
      },
    ],
  },

  pages: {
    "": ArisResearchPage,
  },

  onLoad: async () => {
    console.log("[Plugin] ARIS Research loaded");
  },

  onUnload: async () => {
    console.log("[Plugin] ARIS Research unloaded");
  },
};
