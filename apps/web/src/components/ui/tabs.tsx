import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import type * as React from "react";

import { cn } from "@/lib/cn";

const Tabs = BaseTabs.Root;

function TabsList({ className, ...props }: React.ComponentProps<typeof BaseTabs.List>) {
  return (
    <BaseTabs.List
      className={cn(
        "inline-flex h-10 items-center gap-1 rounded-md border border-border bg-muted p-1 text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof BaseTabs.Tab>) {
  return (
    <BaseTabs.Tab
      className={({ active }) =>
        cn(
          "inline-flex h-8 items-center justify-center rounded-sm px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
          active ? "bg-background text-foreground shadow-sm" : "hover:bg-background/50",
          className
        )
      }
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof BaseTabs.Panel>) {
  return (
    <BaseTabs.Panel
      className={cn("mt-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
