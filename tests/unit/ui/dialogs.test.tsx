// @vitest-environment jsdom
import "@/tests/support/dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "@/components/dialogs/confirm-dialog";
import { ReasonDialog } from "@/components/dialogs/reason-dialog";
import { ApiRequestError } from "@/lib/client/api";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

beforeEach(() => vi.mocked(toast.error).mockClear());

describe("ConfirmDialog", () => {
  it("runs the action, then closes", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Reopen this assessment?"
        description="Students will be able to upload again."
        confirmLabel="Reopen"
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Reopen this assessment?" })).toBeTruthy();
    expect(screen.getByText("Students will be able to upload again.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reopen" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("cancels without running the action", async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="Sure?" onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("stays open and toasts when the action fails", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Close assessment?"
        onConfirm={() =>
          Promise.reject(
            new ApiRequestError({ status: 422, code: "BUSINESS_RULE", message: "Already closed." }),
          )
        }
      />,
    );

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Already closed."));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("button", { name: "Confirm" }).hasAttribute("disabled")).toBe(false);
  });

  it("disables both buttons while the action runs", async () => {
    let finish: () => void = () => {};
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Void?"
        destructive
        onConfirm={() => new Promise<void>((resolve) => (finish = resolve))}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(screen.getByRole("button", { name: "Confirm" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    finish();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(false),
    );
  });
});

describe("ReasonDialog", () => {
  const field = () => screen.getByRole("textbox", { name: /Reason/ });

  it("will not submit without a reason, and says why", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ReasonDialog open onOpenChange={vi.fn()} title="Void payment" onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Enter a reason.")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(field(), "   ");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Enter a reason.")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the trimmed reason, then closes", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ReasonDialog
        open
        onOpenChange={onOpenChange}
        title="Withdraw student"
        confirmLabel="Withdraw"
        onSubmit={onSubmit}
      />,
    );

    await user.type(field(), "  Moved abroad  ");
    await user.click(screen.getByRole("button", { name: "Withdraw" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Moved abroad"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("rejects a reason that is too long", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ReasonDialog open onOpenChange={vi.fn()} title="Why?" onSubmit={onSubmit} />);

    await user.click(field());
    await user.paste("x".repeat(501));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText("Keep the reason under 500 characters.")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("puts a server-side field error on the reason field and stays open", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ReasonDialog
        open
        onOpenChange={onOpenChange}
        title="Unpublish"
        onSubmit={() =>
          Promise.reject(
            new ApiRequestError({
              status: 400,
              code: "VALIDATION_ERROR",
              message: "Some fields are invalid.",
              details: { fieldErrors: { reason: ["That reason is not allowed."] } },
            }),
          )
        }
      />,
    );

    await user.type(field(), "because");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText("That reason is not allowed.")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(toast.error).not.toHaveBeenCalled();
    expect(field().getAttribute("aria-invalid")).toBe("true");
  });

  it("toasts other API errors", async () => {
    const user = userEvent.setup();
    render(
      <ReasonDialog
        open
        onOpenChange={vi.fn()}
        title="Void"
        onSubmit={() =>
          Promise.reject(
            new ApiRequestError({ status: 422, code: "BUSINESS_RULE", message: "Already voided." }),
          )
        }
      />,
    );

    await user.type(field(), "duplicate entry");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Already voided."));
  });

  it("starts empty each time it is opened", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ReasonDialog open onOpenChange={vi.fn()} title="Why?" onSubmit={vi.fn()} />,
    );
    await user.type(field(), "first attempt");

    rerender(<ReasonDialog open={false} onOpenChange={vi.fn()} title="Why?" onSubmit={vi.fn()} />);
    rerender(<ReasonDialog open onOpenChange={vi.fn()} title="Why?" onSubmit={vi.fn()} />);
    expect((field() as HTMLTextAreaElement).value).toBe("");
  });

  it("shows the hint under the field", () => {
    render(
      <ReasonDialog
        open
        onOpenChange={vi.fn()}
        title="Withhold"
        reasonLabel="Reason for withholding"
        reasonHint="Students never see this."
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Reason for withholding")).toBeTruthy();
    expect(screen.getByText("Students never see this.")).toBeTruthy();
  });
});
