import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="px-4 py-6 sm:px-10 lg:px-16">
      <Wordmark />
      <div className="mt-16 max-w-md sm:mt-24">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-semibold">We couldn&rsquo;t find that page</h1>
        <p className="mt-2 text-sm text-muted-foreground">The link may be old, or the order belongs to a different account.</p>
        <Button asChild variant="secondary" className="mt-6">
          <Link href="/">Go to the shop</Link>
        </Button>
      </div>
    </div>
  );
}
