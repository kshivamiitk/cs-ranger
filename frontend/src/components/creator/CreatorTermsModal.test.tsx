import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CreatorTermsModal } from "./CreatorTermsModal";
import type { CreatorTermsStatus } from "@/lib/api";

const status: CreatorTermsStatus = {
  currentVersion: "2026-05-01",
  commissionRate: 0.15,
  acceptedVersion: null,
  acceptedAt: null,
  accepted: false,
};

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CreatorTermsModal status={status} onAccepted={vi.fn()} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("CreatorTermsModal", () => {
  it("shows the current version and the commission percentage from settings", () => {
    renderModal();
    expect(screen.getByText(/Version 2026-05-01/)).toBeInTheDocument();
    expect(screen.getAllByText(/15%/).length).toBeGreaterThan(0);
  });

  it("keeps the accept button disabled until the checkbox is ticked", () => {
    renderModal();
    const acceptButton = screen.getByRole("button", { name: /accept terms/i });
    expect(acceptButton).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(acceptButton).not.toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(acceptButton).toBeDisabled();
  });
});
