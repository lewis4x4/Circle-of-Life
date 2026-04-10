import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  slug: string;
  name: string;
  category: string;
  description: string;
  audience: string;
  defaultRange: string;
  tags: string[];
};

export function TemplateCard(props: Props) {
  return (
    <div className="glass-panel p-6 rounded-[2rem] border border-slate-200 dark:border-white/5 bg-white/40 dark:bg-black/20 flex flex-col gap-5 backdrop-blur-3xl shadow-sm hover:shadow-xl hover:border-slate-300 dark:hover:border-white/10 transition-all duration-300 group hover:-translate-y-1">
      <div>
        <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mb-2">{props.name}</h3>
        <p className="text-sm font-mono text-slate-500 dark:text-slate-400 leading-relaxed">{props.description}</p>
      </div>

      <div className="space-y-1.5 text-[11px] uppercase tracking-widest font-mono text-slate-600 dark:text-slate-300">
        <p className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
          <span className="font-bold text-slate-900 dark:text-white shrink-0">Category:</span>
          <span className="text-slate-500 dark:text-slate-400">{props.category}</span>
        </p>
        <p className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
          <span className="font-bold text-slate-900 dark:text-white shrink-0">Audience:</span>
          <span className="text-slate-500 dark:text-slate-400">{props.audience}</span>
        </p>
        <p className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
          <span className="font-bold text-slate-900 dark:text-white shrink-0">Default range:</span>
          <span className="text-slate-500 dark:text-slate-400">{props.defaultRange}</span>
        </p>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        {props.tags.map((tag) => (
          <Badge key={tag} className="bg-slate-100 text-slate-700 dark:bg-white/5 dark:text-slate-300 uppercase tracking-widest font-mono text-[9px] font-bold border border-slate-200 dark:border-white/10 shadow-sm px-2">
            {tag}
          </Badge>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 pt-4 border-t border-slate-200 dark:border-white/5 mt-auto">
        <Link href={`/admin/reports/templates/${props.slug}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "bg-white/50 dark:bg-white/5 font-mono uppercase tracking-widest text-[10px] w-full border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white")}>
          Preview
        </Link>
        <Link href={`/admin/reports/run/template/${props.slug}`} className={cn(buttonVariants({ variant: "default", size: "sm" }), "font-mono uppercase tracking-widest text-[10px] w-full shadow-lg")}>
          Run now
        </Link>
      </div>
    </div>
  );
}
