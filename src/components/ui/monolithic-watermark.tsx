import { cn } from "@/lib/utils";

interface MonolithicWatermarkProps {
  value: string | number;
  className?: string;
  containerClassName?: string;
}

export function MonolithicWatermark({ value, className, containerClassName }: MonolithicWatermarkProps) {
  return (
    <div className={cn("absolute inset-y-0 right-0 flex items-center overflow-hidden pointer-events-none mix-blend-overlay opacity-40 dark:opacity-20 z-0", containerClassName)}>
      <span className={cn(
        "font-black tracking-tighter leading-none text-slate-800 dark:text-white pb-16 md:pb-24 lg:pb-32 translate-x-4 md:translate-x-8 lg:translate-x-12", 
        className || "text-7xl sm:text-8xl md:text-9xl lg:text-[160px]"
      )}>
        {value}
      </span>
    </div>
  );
}
