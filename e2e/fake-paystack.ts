// A stand-in for Paystack during E2E runs: initialize → hosted checkout page →
// signed charge.success webhook to the app → redirect to the callback URL.
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";

type Init = { reference: string; amount: string; currency: string; callbackUrl: string };

export function startFakePaystack(opts: { port: number; secret: string; webhookUrl: string }): Promise<Server> {
  const inits = new Map<string, Init>();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${opts.port}`);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");

    if (req.method === "POST" && url.pathname === "/transaction/initialize") {
      if (req.headers.authorization !== `Bearer ${opts.secret}`) {
        res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ status: false, message: "Invalid key" }));
        return;
      }
      const input = JSON.parse(body) as { reference: string; amount: string; currency: string; callback_url: string };
      inits.set(input.reference, { reference: input.reference, amount: String(input.amount), currency: input.currency, callbackUrl: input.callback_url });
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ status: true, message: "Authorization URL created", data: { authorization_url: `http://localhost:${opts.port}/checkout/${input.reference}`, access_code: "fake", reference: input.reference } }),
      );
      return;
    }

    const match = url.pathname.match(/^\/checkout\/([^/]+)(\/pay)?$/);
    const init = match ? inits.get(decodeURIComponent(match[1]!)) : undefined;
    if (match && init && req.method === "GET" && !match[2]) {
      res.writeHead(200, { "content-type": "text/html" }).end(
        `<!doctype html><title>Fake Paystack</title><h1>Fake Paystack checkout</h1><p>Amount: ${init.amount} kobo</p>
         <form method="post" action="/checkout/${encodeURIComponent(init.reference)}/pay"><button>Pay now</button></form>`,
      );
      return;
    }
    if (match && init && req.method === "POST" && match[2]) {
      const event = JSON.stringify({
        event: "charge.success",
        data: { id: Date.now(), reference: init.reference, amount: Number(init.amount), currency: init.currency, channel: "card", paid_at: new Date().toISOString(), status: "success" },
      });
      await fetch(opts.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "x-paystack-signature": createHmac("sha512", opts.secret).update(event).digest("hex") },
        body: event,
      });
      res.writeHead(302, { location: init.callbackUrl }).end();
      return;
    }

    res.writeHead(404).end("not found");
  });

  return new Promise((resolve) => server.listen(opts.port, () => resolve(server)));
}
