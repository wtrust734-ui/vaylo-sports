import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BottomSheet from "./bottom-sheet";

/**
 * The sheet in this test is used exactly the way PurchasesRefunds uses it: the
 * caller passes an inline `onClose`, so its identity changes on every render of
 * the caller — and typing a letter in the sheet's textarea is a render of the
 * caller. The setup/teardown effect used to re-run on that new identity, and its
 * cleanup restored focus to whatever was focused before the sheet opened. The
 * result on a phone was a textarea that lost the caret after every character.
 */
function Harness({ onClosed }: { onClosed?: () => void }) {
  // Starts closed with a real opener on screen, because that is the state the
  // bug needed: the opener is what had focus when the sheet opened, and it is
  // what the old cleanup restored focus to on every keystroke.
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState("");
  const [clicks, setClicks] = useState(0);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Request refund
      </button>
      <BottomSheet
        open={open}
        title="Refund request"
        onClose={() => {
          setOpen(false);
          onClosed?.();
        }}
        footer={
          <button type="button" onClick={() => setClicks((n) => n + 1)}>
            Submit request
          </button>
        }
      >
        <textarea
          aria-label="Anything else we should know?"
          value={details}
          onChange={(event) => setDetails(event.target.value.slice(0, 2000))}
        />
        <span data-testid="renders">{clicks}</span>
      </BottomSheet>
    </>
  );
}

const openSheet = () => {
  const opener = screen.getByRole("button", { name: "Request refund" });
  opener.focus();
  fireEvent.click(opener);
};

describe("BottomSheet", () => {
  it("keeps the caret in a field while the caller re-renders on every keystroke", () => {
    render(<Harness />);
    openSheet();
    const field = screen.getByLabelText("Anything else we should know?") as HTMLTextAreaElement;

    field.focus();
    expect(document.activeElement).toBe(field);

    for (const value of ["W", "Wo", "Won", "Wont"]) {
      fireEvent.change(field, { target: { value } });
      expect(document.activeElement).toBe(field);
    }

    expect(field.value).toBe("Wont");
  });

  it("still closes from the close button and hands focus back", () => {
    const onClosed = vi.fn();
    render(<Harness onClosed={onClosed} />);
    openSheet();
    const field = screen.getByLabelText("Anything else we should know?") as HTMLTextAreaElement;
    field.focus();

    fireEvent.click(screen.getByLabelText("Close"));

    // The exit animation keeps the panel in the DOM for a frame, so the state
    // change and the focus hand-back are what this asserts, not the node count.
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Request refund" }));
  });
});
