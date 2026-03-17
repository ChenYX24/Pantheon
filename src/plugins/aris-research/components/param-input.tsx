"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ArisParam } from "../types";

interface ParamInputProps {
  param: ArisParam;
  value: string;
  onChange: (val: string) => void;
  hasError?: boolean;
}

export function ParamInput({ param, value, onChange, hasError }: ParamInputProps) {
  const type = param.type ?? "text";
  const baseClass = hasError ? "border-red-500" : "";

  if (type === "select" && param.options) {
    return (
      <Select value={value || param.default} onValueChange={onChange}>
        <SelectTrigger className={`h-8 text-xs ${baseClass}`}>
          <SelectValue placeholder={param.placeholder || `Select ${param.name}`} />
        </SelectTrigger>
        <SelectContent>
          {param.options.map((opt) => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (type === "textarea") {
    return (
      <textarea
        className={`flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y ${baseClass}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={param.placeholder || param.description}
        rows={3}
      />
    );
  }

  if (type === "number") {
    return (
      <Input
        type="number"
        className={`h-8 text-xs ${baseClass}`}
        value={value || param.default}
        onChange={(e) => onChange(e.target.value)}
        placeholder={param.placeholder || param.default}
      />
    );
  }

  return (
    <Input
      className={`h-8 text-xs ${baseClass}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={param.placeholder || param.description}
    />
  );
}
