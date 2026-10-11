import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/client/api";
import { handleApiError } from "@/lib/client/api-errors";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const toastError = vi.mocked(toast.error);

function apiError(
  code: ApiRequestError["code"],
  message: string,
  details?: Record<string, unknown>,
  status = 400,
) {
  return new ApiRequestError({ status, code, message, details });
}

beforeEach(() => toastError.mockClear());

describe("handleApiError: validation errors", () => {
  it("puts each field's messages on that field, focusing the first", () => {
    const setError = vi.fn();
    const outcome = handleApiError(
      apiError("VALIDATION_ERROR", "Some fields are invalid.", {
        fieldErrors: {
          email: ["Enter a valid email address."],
          fullName: ["Required", "Too short"],
        },
      }),
      { setError },
    );

    expect(outcome).toBe("fields");
    expect(setError).toHaveBeenCalledTimes(2);
    expect(setError).toHaveBeenNthCalledWith(
      1,
      "email",
      { type: "server", message: "Enter a valid email address." },
      { shouldFocus: true },
    );
    expect(setError).toHaveBeenNthCalledWith(
      2,
      "fullName",
      { type: "server", message: "Required Too short" },
      { shouldFocus: false },
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it("maps nested dotted paths unchanged", () => {
    const setError = vi.fn();
    handleApiError(
      apiError("VALIDATION_ERROR", "Invalid.", {
        fieldErrors: { "instalments.0.amount": ["Enter an amount."] },
      }),
      { setError },
    );
    expect(setError).toHaveBeenCalledWith(
      "instalments.0.amount",
      { type: "server", message: "Enter an amount." },
      { shouldFocus: true },
    );
  });

  it("toasts the errors for fields the form does not show", () => {
    const setError = vi.fn();
    const outcome = handleApiError(
      apiError("VALIDATION_ERROR", "Invalid.", {
        fieldErrors: { reason: ["Enter a reason."], version: ["Required."] },
      }),
      { setError, fields: ["reason"] },
    );

    expect(outcome).toBe("fields");
    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError.mock.calls[0]![0]).toBe("reason");
    expect(toastError).toHaveBeenCalledWith("Required.");
  });

  it("toasts form-level problems such as a body that was not JSON", () => {
    const outcome = handleApiError(
      apiError("VALIDATION_ERROR", "Invalid.", {
        fieldErrors: {},
        formErrors: ["Body must be JSON."],
      }),
      { setError: vi.fn() },
    );
    expect(outcome).toBe("toast");
    expect(toastError).toHaveBeenCalledWith("Body must be JSON.");
  });

  it("toasts everything when there is no form to put field errors on", () => {
    const outcome = handleApiError(
      apiError("VALIDATION_ERROR", "Invalid.", {
        fieldErrors: { email: ["Enter a valid email."] },
      }),
    );
    expect(outcome).toBe("toast");
    expect(toastError).toHaveBeenCalledWith("Enter a valid email.");
  });

  it("falls back to the message when a validation error names no fields", () => {
    const outcome = handleApiError(apiError("VALIDATION_ERROR", "Some fields are invalid."), {
      setError: vi.fn(),
    });
    expect(outcome).toBe("toast");
    expect(toastError).toHaveBeenCalledWith("Some fields are invalid.");
  });
});

describe("handleApiError: other errors", () => {
  it.each([
    ["NOT_FOUND", "Student not found.", 404],
    ["FORBIDDEN", "This is only available to staff.", 403],
    ["BUSINESS_RULE", "That status change is not allowed.", 422],
    ["CONFLICT", "That email is already in use.", 409],
    ["NETWORK_ERROR", "Could not reach the server.", 0],
  ] as const)("toasts the server's message for %s", (code, message, status) => {
    expect(handleApiError(apiError(code, message, undefined, status))).toBe("toast");
    expect(toastError).toHaveBeenCalledWith(message);
  });

  it("explains an ended session", () => {
    handleApiError(apiError("UNAUTHENTICATED", "Choose who you are viewing as.", undefined, 401));
    expect(toastError).toHaveBeenCalledWith("Your session has ended.", {
      description: "Choose who you are viewing as to continue.",
    });
  });

  it("shows the request id of a server error so it can be quoted", () => {
    handleApiError(
      apiError("INTERNAL_ERROR", "Something went wrong.", { requestId: "req-42" }, 500),
    );
    expect(toastError).toHaveBeenCalledWith("Something went wrong.", {
      description: "Reference: req-42",
    });
  });

  it("leaves passthrough codes to the caller and shows nothing", () => {
    const outcome = handleApiError(
      apiError("VERSION_CONFLICT", "Changed by someone else.", { currentVersion: 4 }, 409),
      { passthrough: ["VERSION_CONFLICT", "DUPLICATE_WARNING"] },
    );
    expect(outcome).toBe("passthrough");
    expect(toastError).not.toHaveBeenCalled();
  });

  it("toasts the same code when it is not passed through", () => {
    handleApiError(apiError("VERSION_CONFLICT", "Changed by someone else.", undefined, 409), {
      passthrough: ["DUPLICATE_WARNING"],
    });
    expect(toastError).toHaveBeenCalledWith("Changed by someone else.");
  });

  it("shows a generic message for an error that is not from the API", () => {
    expect(handleApiError(new Error("boom"))).toBe("toast");
    expect(toastError).toHaveBeenCalledWith("Something went wrong. Try again.");
  });

  it("uses a custom fallback message", () => {
    handleApiError("nope", { fallbackMessage: "Could not save." });
    expect(toastError).toHaveBeenCalledWith("Could not save.");
  });
});
