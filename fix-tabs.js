const fs = require('fs');
const path = require('path');

const dir = 'src/components/admin/facilities/tabs';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.tsx'));

const containerRegex = /className="([^"]*(?:rounded-lg|rounded-xl|bg-white|border-gray-200|border-gray-100|bg-gray-50|text-gray-900|text-muted-foreground)[^"]*)"/g;

function convertClasses(cls) {
  let mapped = cls;
  
  // Containers
  mapped = mapped.replace(/\brounded-lg\b/g, 'rounded-[1.5rem]');
  mapped = mapped.replace(/\border border-gray-200 bg-white\b/g, 'border border-slate-200/50 dark:border-white/5 bg-white/40 dark:bg-black/20 shadow-sm backdrop-blur-2xl');
  mapped = mapped.replace(/\bbg-white\b/g, 'bg-white/80 dark:bg-white/[0.04] backdrop-blur-2xl');
  
  // Borders
  mapped = mapped.replace(/\bborder-gray-200\b/g, 'border-slate-200/50 dark:border-white/10');
  mapped = mapped.replace(/\bborder-gray-100\b/g, 'border-slate-200/40 dark:border-white/5');
  mapped = mapped.replace(/\border border-dashed border-gray-300\b/g, 'border border-dashed border-slate-300/60 dark:border-white/20');
  
  // Backgrounds
  mapped = mapped.replace(/\bbg-gray-50\b/g, 'bg-slate-50/50 dark:bg-white/5');
  
  // Text
  mapped = mapped.replace(/\btext-gray-900\b/g, 'text-slate-900 dark:text-slate-100');
  mapped = mapped.replace(/\btext-gray-800\b/g, 'text-slate-800 dark:text-slate-200');
  mapped = mapped.replace(/\btext-gray-700\b/g, 'text-slate-700 dark:text-slate-300');
  mapped = mapped.replace(/\btext-gray-500\b/g, 'text-slate-500 dark:text-slate-400');
  mapped = mapped.replace(/\btext-muted-foreground\b/g, 'text-slate-500 dark:text-slate-400');
  
  return mapped;
}

for (const file of files) {
  if (file === 'OverviewTab.tsx') continue; 
  const fp = path.join(dir, file);
  let content = fs.readFileSync(fp, 'utf8');
  
  // 1. Process classes
  content = content.replace(containerRegex, (match, p1) => {
    return 'className="' + convertClasses(p1) + '"';
  });
  
  // 2. Headings specific to these tabs
  content = content.replace(/className="([^"]*)text-lg font-semibold([^"]*)"/g, 'className="$1font-display text-lg font-semibold text-slate-900 dark:text-white$2"');
  
  // 3. Key value pairs usually have `<p className="text-muted-foreground">Label</p>`
  content = content.replace(/<p className="([^"]*)\btext-slate-500 dark:text-slate-400\b([^"]*)">([^<]+)<\/p>\s*<p className="([^"]*)font-medium([^"]*)">/g, 
    '<p className="$1text-[10px] font-mono uppercase tracking-widest font-semibold text-slate-500 dark:text-slate-400$2">$3</p>\n            <p className="$4font-mono text-sm font-semibold text-slate-900 dark:text-slate-100$5">');
    
  fs.writeFileSync(fp, content);
}
console.log('Updated components');
