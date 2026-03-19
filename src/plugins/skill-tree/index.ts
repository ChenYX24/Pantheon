/**
 * Skill Tree Plugin
 *
 * Game-style skill tree visualization showing all SCC capabilities.
 * Users can view, configure, plan, and disable skills.
 */

import type { PluginModule } from "@/plugins/_system/plugin-types";
import { SkillTreePage } from "./pages";
import { TreePine } from "lucide-react";

export const plugin: PluginModule = {
  manifest: {
    id: "skill-tree",
    name: "Skill Tree",
    version: "1.0.0",
    description: "Game-style skill tree — full capability map of your AI workstation",
    author: "SCC",
    icon: TreePine,
    routes: [
      { path: "", title: "Skill Tree" },
    ],
    sidebarItems: [
      {
        path: "",
        label: "Skill Tree",
        icon: TreePine,
        order: 4,
      },
    ],
  },

  pages: {
    "": SkillTreePage,
  },

  onLoad: async () => {
    if (process.env.NODE_ENV === "development") {
      console.log("[Plugin] Skill Tree loaded");
    }
  },

  onUnload: async () => {
    if (process.env.NODE_ENV === "development") {
      console.log("[Plugin] Skill Tree unloaded");
    }
  },
};
