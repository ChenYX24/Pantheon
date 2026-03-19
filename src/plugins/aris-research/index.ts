/**
 * SAGE Plugin
 *
 * Smart Autonomous Generation Engine — autonomous ML research pipeline
 * with 27 Claude Code skills for end-to-end research workflows:
 * idea discovery, experiments, review loops, and paper writing.
 */

import type { PluginModule } from "@/plugins/_system/plugin-types";
import { ArisResearchPage } from "./pages";
import { FlaskConical } from "lucide-react";

export const plugin: PluginModule = {
  manifest: {
    id: "aris-research",
    name: "SAGE",
    version: "1.0.0",
    description: "Smart Autonomous Generation Engine — autonomous ML research pipeline with 27 Claude Code skills",
    author: "Pantheon Team",
    icon: FlaskConical,
    routes: [
      { path: "", title: "SAGE" },
    ],
    sidebarItems: [
      {
        path: "",
        label: "SAGE",
        icon: FlaskConical,
        order: 3,
      },
    ],
  },

  pages: {
    "": ArisResearchPage,
  },

  onLoad: async () => {
    if (process.env.NODE_ENV === "development") {
      console.log("[Plugin] SAGE loaded");
    }
  },

  onUnload: async () => {
    if (process.env.NODE_ENV === "development") {
      console.log("[Plugin] SAGE unloaded");
    }
  },
};
