import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FileUpload } from "./FileUpload";

function pickFile(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("FileUpload validation states", () => {
  it("shows a size error and never calls onUpload when the file is too large", async () => {
    const onUpload = vi.fn();
    const { container } = render(<FileUpload maxBytes={5} onUpload={onUpload} />);
    pickFile(container, new File([new Uint8Array(64)], "big.png", { type: "image/png" }));

    expect(await screen.findByText(/too large/i)).toBeInTheDocument();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("shows a type error for files outside the accept list", async () => {
    const onUpload = vi.fn();
    const { container } = render(
      <FileUpload maxBytes={1024 * 1024} accept="image/png,image/jpeg" onUpload={onUpload} />,
    );
    pickFile(container, new File(["hello"], "notes.txt", { type: "text/plain" }));

    expect(await screen.findByText(/isn't allowed/i)).toBeInTheDocument();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("calls onUpload for a valid file and shows the success state", async () => {
    const onUpload = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <FileUpload maxBytes={1024 * 1024} accept="image/png" onUpload={onUpload} />,
    );
    pickFile(container, new File([new Uint8Array(10)], "avatar.png", { type: "image/png" }));

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Uploaded avatar\.png/i)).toBeInTheDocument();
  });

  it("surfaces upload failures from the onUpload callback", async () => {
    const onUpload = vi.fn().mockRejectedValue(new Error("Storage unreachable"));
    const { container } = render(<FileUpload maxBytes={1024 * 1024} onUpload={onUpload} />);
    pickFile(container, new File([new Uint8Array(10)], "doc.pdf", { type: "application/pdf" }));

    expect(await screen.findByText(/Storage unreachable/)).toBeInTheDocument();
  });
});
