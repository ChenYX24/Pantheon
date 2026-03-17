/**
 * Skill Tree Plugin — Type Definitions
 *
 * Game-style skill tree for visualizing and managing all SCC capabilities.
 */

/** Skill status in the tree */
export type SkillStatus =
  | "active"       // Installed and working
  | "configurable" // Can be enabled, needs setup
  | "planned"      // Roadmap item, not yet built
  | "disabled";    // User temporarily disabled

/** Skill category */
export type SkillCategory =
  | "foundation"   // Core infrastructure
  | "coding"       // Development skills
  | "research"     // ARIS research pipeline
  | "management"   // API, agents, settings
  | "creative"     // Content creation, design
  | "integration"  // External services, bots
  | "advanced";    // Power user, experimental

/** Implementation type — what backs this skill */
export type ImplType =
  | "cli"          // CLI tool (claude, codex, git)
  | "skill"        // Claude Code skill (SKILL.md)
  | "mcp"          // MCP server
  | "plugin"       // SCC dashboard plugin
  | "api"          // API integration
  | "manual"       // Manual / external setup
  | "planned";     // Not yet implemented

/** A single skill node in the tree */
export interface SkillTreeNode {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  category: SkillCategory;
  /** Default status (can be overridden by user) */
  defaultStatus: SkillStatus;
  /** Icon name from lucide-react */
  icon: string;
  /** What implements this skill */
  implType: ImplType;
  /** Implementation details (file paths, commands, URLs) */
  implDetail?: string;
  /** IDs of skills this depends on */
  dependencies: string[];
  /** IDs of skills that this unlocks (reverse deps, for visual) */
  unlocks?: string[];
  /** Tier level (1=root, 2=basic, 3=intermediate, 4=advanced, 5=expert) */
  tier: number;
  /** Tags for cross-category search */
  tags?: string[];
  /** Setup instructions or link */
  setupGuide?: string;
  /** Related SCC page route */
  pageRoute?: string;
}

/** User-level overrides for skill status */
export interface SkillStatusOverride {
  skillId: string;
  status: SkillStatus;
  /** When user marked as "wanted" (for planned skills) */
  wantedAt?: string;
  /** User notes */
  notes?: string;
}

/** User-added custom skill */
export interface CustomSkill extends SkillTreeNode {
  /** Always true for user-created skills */
  isCustom: true;
  createdAt: string;
}

/** Persisted skill tree state */
export interface SkillTreeState {
  overrides: SkillStatusOverride[];
  customSkills: CustomSkill[];
  /** Layout positions (nodeId -> {x, y}) */
  positions?: Record<string, { x: number; y: number }>;
  /** Collapsed categories */
  collapsedCategories?: string[];
}

/** Category metadata for display */
export interface CategoryMeta {
  id: SkillCategory;
  name: string;
  nameZh: string;
  icon: string;
  color: string;        // Tailwind color class
  glowColor: string;    // CSS color for glow effect
  bgGradient: string;   // CSS gradient for node background
}
