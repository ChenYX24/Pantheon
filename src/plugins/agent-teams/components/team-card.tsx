"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Users, Copy, Trash2, Edit3, ChevronDown, ChevronUp,
  Play, Castle, FlaskConical, Layers, Brain, GitBranch,
  ArrowRight, ArrowDownRight, PencilRuler, History,
} from "lucide-react";
import type { AgentTeam, TeamMember } from "../types";

const WORKFLOW_LABELS: Record<string, { label: string; color: string }> = {
  sequential: { label: "Sequential", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  parallel: { label: "Parallel", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
  hierarchical: { label: "Hierarchical", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" },
};

const PROVIDER_COLORS: Record<string, string> = {
  claude: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  codex: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  api: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
};

const ICON_MAP: Record<string, typeof Users> = {
  castle: Castle,
  users: Users,
  "flask-conical": FlaskConical,
  layers: Layers,
  brain: Brain,
};

function getTeamIcon(icon: string) {
  return ICON_MAP[icon] || Users;
}

function MemberRow({ member }: { member: TeamMember }) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-muted/50 hover:bg-muted transition-colors">
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {member.tier > 1 && (
          <ArrowDownRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        )}
        <span className="text-sm font-medium truncate">{member.name}</span>
        <span className="text-xs text-muted-foreground truncate hidden sm:inline">
          {member.role}
        </span>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <Badge variant="secondary" className={`text-[9px] px-1 py-0 ${PROVIDER_COLORS[member.provider] || ""}`}>
          {member.provider}
        </Badge>
        <Badge variant="outline" className="text-[9px] px-1 py-0 font-mono">
          {member.model.length > 16 ? member.model.slice(0, 16) + "..." : member.model}
        </Badge>
      </div>
    </div>
  );
}

interface TeamCardProps {
  team: AgentTeam;
  onEdit: () => void;
  onClone: () => void;
  onDelete: () => void;
  onRun?: () => void;
  onOpenCanvas?: () => void;
  onOpenHistory?: () => void;
}

export function TeamCard({ team, onEdit, onClone, onDelete, onRun, onOpenCanvas, onOpenHistory }: TeamCardProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = getTeamIcon(team.icon);
  const wf = WORKFLOW_LABELS[team.workflow] || WORKFLOW_LABELS.sequential;

  const tierGroups = useMemo(() => {
    const groups: Record<number, TeamMember[]> = {};
    for (const m of team.members) {
      const t = m.tier || 1;
      if (!groups[t]) groups[t] = [];
      groups[t].push(m);
    }
    return Object.entries(groups)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([tier, members]) => ({
        tier: Number(tier),
        members: members.sort((a, b) => a.order - b.order),
      }));
  }, [team.members]);

  const providerSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of team.members) {
      counts[m.provider] = (counts[m.provider] || 0) + 1;
    }
    return Object.entries(counts).map(([p, c]) => `${c} ${p}`).join(" + ");
  }, [team.members]);

  return (
    <Card className="transition-all hover:shadow-md">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base truncate">{team.name}</CardTitle>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Badge variant="secondary" className={`text-[10px] ${wf.color}`}>
                  {wf.label}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  {team.members.length} members
                </span>
                {team.isPreset && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0">Preset</Badge>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-0.5 flex-shrink-0">
            {onOpenCanvas && (
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-indigo-600" onClick={onOpenCanvas} title="Visual Editor">
                <PencilRuler className="h-3.5 w-3.5" />
              </Button>
            )}
            {onOpenHistory && (
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-600" onClick={onOpenHistory} title="History">
                <History className="h-3.5 w-3.5" />
              </Button>
            )}
            {onRun && (
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-green-600" onClick={onRun} title="Run team">
                <Play className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onEdit} title="Edit">
              <Edit3 className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClone} title="Clone">
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={onDelete} title="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground line-clamp-2">{team.description}</p>

        <div className="text-[10px] text-muted-foreground flex items-center gap-2">
          <GitBranch className="h-3 w-3" />
          {providerSummary}
        </div>

        {/* Expand to show members */}
        <button
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? "Hide members" : "Show members"}
        </button>

        {expanded && (
          <div className="space-y-2 pt-1">
            {tierGroups.map(({ tier, members }) => (
              <div key={tier}>
                {tierGroups.length > 1 && (
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Tier {tier}
                  </div>
                )}
                <div className="space-y-1">
                  {members.map((m) => (
                    <MemberRow key={m.id} member={m} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tags */}
        {team.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {team.tags.map((tag) => (
              <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
