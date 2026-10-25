import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/brand/wordmark";

export const metadata = { title: "No access" };

export default function ForbiddenPage() {
  return (
    <div className="px-4 py-6 sm:px-10 lg:px-16">
      <Wordmark />
      <div className="mt-16 max-w-md sm:mt-24">
        <p className="text-sm font-medium text-danger">403</p>
        <h1 className="mt-2 text-2xl font-semibold">You do not have access to this page</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account role does not include this area. If you think that is wrong, ask an admin to check your role.
        </p>
        <Button asChild variant="secondary" className="mt-6">
          <Link href="/">Go to the shop</Link>
        </Button>
      </div>
    </div>
  );
}
