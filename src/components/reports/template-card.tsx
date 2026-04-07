import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{props.name}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
        <p>
          <span className="font-medium text-slate-900 dark:text-slate-100">Category:</span> {props.category}
        </p>
        <p>
          <span className="font-medium text-slate-900 dark:text-slate-100">Audience:</span> {props.audience}
        </p>
        <p>
          <span className="font-medium text-slate-900 dark:text-slate-100">Default range:</span> {props.defaultRange}
        </p>
        <div className="flex flex-wrap gap-2">
          {props.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      </CardContent>
      <CardFooter className="flex gap-2">
        <Link href={`/admin/reports/templates/${props.slug}`} className={cn(buttonVariants({ size: "sm" }))}>
          Preview
        </Link>
        <Link href={`/admin/reports/run/template/${props.slug}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Run now
        </Link>
      </CardFooter>
    </Card>
  );
}
