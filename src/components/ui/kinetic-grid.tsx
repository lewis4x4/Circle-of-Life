import { cn } from "@/lib/utils";
import React from "react";

interface KineticGridProps extends React.HTMLAttributes<HTMLDivElement> {
  staggerMs?: number;
  baseDelayMs?: number;
}

export function KineticGrid({
  children,
  className,
  staggerMs = 50,
  baseDelayMs = 0,
  ...props
}: KineticGridProps) {
  const arrayChildren = React.Children.toArray(children);
  
  return (
    <div className={cn("grid", className)} {...props}>
      {arrayChildren.map((child, i) => (
        <div 
          key={i} 
          className="h-full w-full animate-in fade-in slide-in-from-bottom-4"
          style={{ 
            animationDelay: `${baseDelayMs + (i * staggerMs)}ms`, 
            animationDuration: '600ms',
            animationFillMode: 'both' 
          }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
