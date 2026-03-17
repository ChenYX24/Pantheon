/**
 * Plugin Loader
 *
 * Discovers and dynamically loads plugins from the src/plugins/ directory.
 * Each plugin is a folder (not starting with _) that exports a PluginModule
 * from its index.ts/tsx file.
 *
 * Since Next.js does not support fully dynamic imports at runtime from
 * arbitrary directories, plugins must be statically registered here.
 * New plugins add a single import + register call.
 */

import { pluginRegistry } from "./plugin-registry";
import type { PluginModule } from "./plugin-types";

// ---- Static plugin imports ----
// Add new plugin imports here:
import { plugin as apiManagementPlugin } from "@/plugins/api-management";
import { plugin as agentTeamsPlugin } from "@/plugins/agent-teams";
import { plugin as arisPlugin } from "@/plugins/aris-research";
import { plugin as skillTreePlugin } from "@/plugins/skill-tree";

// ---- All known plugins ----
const PLUGINS: PluginModule[] = [
  apiManagementPlugin,
  agentTeamsPlugin,
  arisPlugin,
  skillTreePlugin,
];

// ---- Loader ----

let loaded = false;

/**
 * Load all registered plugins into the registry.
 * Safe to call multiple times; only loads once.
 */
export async function loadAllPlugins(): Promise<void> {
  if (loaded) return;
  loaded = true;

  for (const plugin of PLUGINS) {
    try {
      await pluginRegistry.register(plugin);
      console.log(`[PluginLoader] Registered: ${plugin.manifest.id}`);
    } catch (err) {
      console.error(`[PluginLoader] Failed to register plugin:`, err);
    }
  }
}

/**
 * Register a single plugin dynamically (for hot-loading or testing).
 */
export async function loadPlugin(plugin: PluginModule): Promise<void> {
  await pluginRegistry.register(plugin);
}
