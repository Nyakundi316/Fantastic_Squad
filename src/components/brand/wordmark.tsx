import Link from "next/link";
import { cn } from "@/lib/utils";

export function Wordmark({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-baseline gap-0.5 text-[15px] font-bold tracking-tight", className)}>
      <span>FANTASTIC</span>
      <span className="text-primary">ZONE</span>
    </Link>
  );
}
