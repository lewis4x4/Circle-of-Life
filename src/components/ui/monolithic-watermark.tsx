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
        "font-black tracking-tighter leading-none text-slate-800 dark:text-white pb-32", // large bottom padding ensures it scales correctly within tight flex cards
        className || "text-[160px] translate-x-12"
      )}>
        {value}
      </span>
    </div>
  );
}
