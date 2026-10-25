const STEPS = [
  { title: "You place a preorder", body: "Pay the product price only. That is the buying price in China." },
  { title: "The batch closes", body: "On the cutoff date we place one combined order with the supplier." },
  { title: "Items are measured in China", body: "Every item is weighed, and sized where volume matters." },
  { title: "Your shipping invoice arrives", body: "Your share of the batch quote, with the full calculation shown." },
  { title: "You pay for shipping", body: "Sea or air, whichever you chose at checkout." },
  { title: "Shipped and delivered", body: "We ship the batch and deliver to your address." },
];

export function AfterOrderSteps() {
  return (
    <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div>
        <h2 className="text-xl font-semibold">What happens after you order?</h2>
        <p className="mt-2 max-w-xs text-sm text-muted-foreground">
          Six steps from preorder to your door. We message you on WhatsApp at each one.
        </p>
      </div>
      <ol className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        {STEPS.map((step, i) => (
          <li key={step.title} className="grid grid-cols-[2rem_1fr] gap-x-2">
            <span className="tabular flex size-7 items-center justify-center rounded-full border border-border bg-surface text-xs font-medium">
              {i + 1}
            </span>
            <div>
              <p className="text-sm font-medium">{step.title}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
