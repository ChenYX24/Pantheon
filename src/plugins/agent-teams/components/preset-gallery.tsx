"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Users, Castle, FlaskConical, Layers, Brain, Plus,
} from "lucide-react";
import type { TeamPreset } from "../types";
import { TEAM_PRESETS } from "../team-data";

const ICON_MAP: Record<string, typeof Users> = {
  castle: Castle,
  users: Users,
  "flask-conical": FlaskConical,
  layers: Layers,
  brain: Brain,
};

interface PresetGalleryProps {
  onUsePreset: (preset: TeamPreset) => void;
  locale?: string;
}

export function PresetGallery({ onUsePreset, locale }: PresetGalleryProps) {
  const isZh = locale?.startsWith("zh");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">
          {isZh ? "预设模板" : "Preset Templates"}
        </h3>
        <Badge variant="secondary" className="text-[10px]">
          {TEAM_PRESETS.length}
        </Badge>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {TEAM_PRESETS.map((preset) => {
          const Icon = ICON_MAP[preset.icon] || Users;
          return (
            <Card key={preset.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="text-sm truncate">
                      {isZh ? preset.nameZh : preset.name}
                    </CardTitle>
                    <div className="text-[10px] text-muted-foreground">
                      {preset.members.length} members / {preset.workflow}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {isZh ? preset.descriptionZh : preset.description}
                </p>

                {/* Member preview */}
                <div className="flex flex-wrap gap-1">
                  {preset.members.slice(0, 4).map((m, i) => (
                    <Badge key={i} variant="outline" className="text-[9px] px-1 py-0">
                      {m.name}
                    </Badge>
                  ))}
                  {preset.members.length > 4 && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0">
                      +{preset.members.length - 4}
                    </Badge>
                  )}
                </div>

                {/* Provider mix */}
                <div className="flex items-center gap-1">
                  {Array.from(new Set(preset.members.map((m) => m.provider))).map((p) => (
                    <Badge key={p} variant="secondary" className="text-[9px] px-1 py-0">
                      {p}
                    </Badge>
                  ))}
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs h-7"
                  onClick={() => onUsePreset(preset)}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {isZh ? "使用此模板" : "Use Template"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
