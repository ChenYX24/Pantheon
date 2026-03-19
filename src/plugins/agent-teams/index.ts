/**
 * Workflow Studio Plugin
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
    name: "Workflow Studio",
    version: "1.0.0",
    description: "Multi-agent teams with per-member model/provider configuration",
    author: "Pantheon Team",
    icon: Users,
    routes: [
      { path: "", title: "Workflow Studio" },
    ],
    sidebarItems: [
      {
        path: "",
        label: "Workflow Studio",
        icon: Users,
        order: 2,
      },
    ],
  },

  pages: {
    "": AgentTeamsPage,
  },

  onLoad: async () => {
    if (process.env.NODE_ENV === "development") {
      console.log("[Plugin] Workflow Studio loaded");
    }
  },

  onUnload: async () => {
    if (process.env.NODE_ENV === "development") {
      console.log("[Plugin] Workflow Studio unloaded");
    }
  },
};
