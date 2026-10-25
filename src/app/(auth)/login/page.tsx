import type { Metadata } from "next";
import { Wordmark } from "@/components/brand/wordmark";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: { searchParams: { next?: string } }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="flex flex-col px-4 py-6 sm:px-10 lg:px-16">
        <Wordmark />

        <div className="mt-16 w-full max-w-sm sm:mt-24">
          <h1 className="text-2xl font-semibold sm:text-3xl">Sign in or create an account</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We will send a one-time code. New here? The same code sets up your account.
          </p>
          <LoginForm next={searchParams.next} />
        </div>

        <p className="mt-auto pt-12 text-xs text-muted-foreground">
          By continuing you agree to receive order and shipping updates by SMS, WhatsApp or email.
        </p>
      </div>

      <aside className="relative hidden overflow-hidden border-l border-border bg-surface lg:block">
        <div className="absolute inset-y-0 right-0 w-2/3 bg-[radial-gradient(ellipse_at_top_right,rgb(91_61_245/0.08),transparent_60%)]" />
        <div className="relative ml-16 mt-40 max-w-md">
          <p className="text-sm font-medium text-primary">How a preorder works</p>
          <ol className="mt-6 space-y-6 text-sm">
            <li className="grid grid-cols-[2rem_1fr] gap-x-3">
              <span className="tabular text-muted-foreground">01</span>
              <span>
                <span className="font-medium">Pay the product price.</span>{" "}
                <span className="text-muted-foreground">That is the buying price in China, nothing added.</span>
              </span>
            </li>
            <li className="grid grid-cols-[2rem_1fr] gap-x-3">
              <span className="tabular text-muted-foreground">02</span>
              <span>
                <span className="font-medium">We measure your items.</span>{" "}
                <span className="text-muted-foreground">Every parcel in the batch is weighed before shipping.</span>
              </span>
            </li>
            <li className="grid grid-cols-[2rem_1fr] gap-x-3">
              <span className="tabular text-muted-foreground">03</span>
              <span>
                <span className="font-medium">Shipping is split and invoiced.</span>{" "}
                <span className="text-muted-foreground">
                  You see the batch quote, your share and how it was calculated.
                </span>
              </span>
            </li>
          </ol>
        </div>
      </aside>
    </div>
  );
}
