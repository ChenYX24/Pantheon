"use client";

import { useCallback, type DragEvent, type Dispatch, type SetStateAction } from "react";
import type { Node } from "@xyflow/react";

import type { AgentNodeData, AgentNodeStatus } from "./agent-node";

// ---- Helpers ----

function generateMemberId(): string {
  return `member-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---- Public interface ----

export interface CanvasDndHandlers {
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}

export interface UseCanvasDndDeps {
  isZh: boolean;
  setNodes: Dispatch<SetStateAction<Node[]>>;
  screenToFlowPosition: (pos: { x: number; y: number }) => { x: number; y: number };
}

// ---- Hook ----

export function useCanvasDnd({
  isZh,
  setNodes,
  screenToFlowPosition,
}: UseCanvasDndDeps): CanvasDndHandlers {
  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/agent-team-template");
    if (!raw) return;

    let tpl: {
      id: string;
      name: string;
      nameZh: string;
      role: string;
      roleZh: string;
      provider: string;
      model: string;
      category: string;
    };
    try {
      tpl = JSON.parse(raw);
    } catch {
      return;
    }

    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });

    // Skip utility nodes (decision/aggregator) — not yet wired to execution
    if (tpl.category === "utilities") return;

    // Agent node
    const memberId = generateMemberId();
    setNodes((nds) => [...nds, {
      id: memberId,
      type: "agent",
      position,
      data: {
        memberId,
        name: isZh ? tpl.nameZh : tpl.name,
        role: isZh ? tpl.roleZh ?? tpl.role : tpl.role,
        provider: tpl.provider,
        model: tpl.model,
        status: "idle" as AgentNodeStatus,
        tokens: undefined,
        isZh,
      } satisfies AgentNodeData,
    }]);
  }, [screenToFlowPosition, setNodes, isZh]);

  return { onDragOver, onDrop };
}
