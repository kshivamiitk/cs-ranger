import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest globals are disabled, so React Testing Library can't auto-register
// its cleanup hook — do it explicitly to keep tests isolated.
afterEach(() => cleanup());
