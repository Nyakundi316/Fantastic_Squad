import { vi } from "vitest";

// The console SMS/WhatsApp/email drivers log every message; keep test output readable.
vi.spyOn(console, "info").mockImplementation(() => {});
