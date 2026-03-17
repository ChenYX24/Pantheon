/**
 * Agent Teams Plugin
 *
 * Create and manage multi-agent teams where each member
 * can use a different model/provider/API key combination.
 * Includes preset templates like "Three Departments & Six Ministries".
 */

import type { PluginModule } from "@/plugins/_system/plugin-types";
import { AgentTeamsPage } from "./pages";
import { Users } from "lucide-react";

export const plugin: PluginModule = {
  manifest: {
    id: "agent-teams",
    name: "Agent Teams",
    version: "1.0.0",
    description: "Multi-agent teams with per-member model/provider configuration",
    author: "SCC Team",
    icon: Users,
    routes: [
      { path: "", title: "Agent Teams" },
    ],
    sidebarItems: [
      {
        path: "",
        label: "Agent Teams",
        icon: Users,
        order: 2,
      },
    ],
  },

  pages: {
    "": AgentTeamsPage,
  },

  onLoad: async () => {
    console.log("[Plugin] Agent Teams loaded");
  },

  onUnload: async () => {
    console.log("[Plugin] Agent Teams unloaded");
  },
};
